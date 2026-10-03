-- Build 80 (EXP-01) proof: run after replay + seed78 + lib + 20261212 (see runall80.sh).
-- Users (seed78): 013 Pili cashier (sales preparer), 014 Pili sales approver,
-- 015 Pili finance (preparer + approver), 021 Aton cashier.
\set ON_ERROR_STOP 1
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('sales', (select id::text from sections where code = 'sales'));
insert into months(business_id, year, month, label)
select proof.get('pili')::uuid, extract(year from now())::int, extract(month from now())::int, to_char(now(), 'FMMonth YYYY')
on conflict do nothing;
select proof.set('month', (select id::text from months where business_id = proof.get('pili')::uuid and year = extract(year from now())::int and month = extract(month from now())::int));
select proof.set('y0', to_char(date_trunc('year', now()), 'YYYY-MM-DD'));
select proof.set('cash', (select id::text from finance_bank_accounts where business_id = proof.get('pili')::uuid and account_code = 'SF-CASH'));
create or replace function proof.gl(p_code text) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0) from finance_journal_lines l join finance_journal_entries j on j.id = l.journal_entry_id
   join finance_chart_of_accounts a on a.id = l.account_id
   where j.business_id = (select id from businesses where code = 'PILI') and j.status = 'posted' and a.account_code = p_code $$;
create or replace function proof.exp_mapped(p uuid, c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select suggested_category is null and category_id = c from expenses where id = p $$;
create or replace function proof.exp_status(p uuid) returns text language sql stable security definer set search_path = public as $$
  select status::text from expenses where id = p $$;
grant execute on all functions in schema proof to public;

\echo == A. Categories are Finance's
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.set('cat_permit', public.expense_category_save(null, null, 'Permits and Licenses', 'Business permits', '5200', true)::text);
select proof.set('cat_audit', public.expense_category_save(null, null, 'Professional Fees', null, '5200', true)::text);
select proof.ok((select gl_account_code from admin_expense_categories where id = proof.get('cat_permit')::uuid) = '5200', 'Finance creates a category with its expense account');
select proof.fails($$select public.expense_category_save(null, null, 'permits and licenses', null, '5200', true)$$, 'already exists', 'duplicate category name refused');
select proof.fails($$select public.expense_category_save(null, null, 'Bad account', null, '1000', true)$$, 'not an active expense account', 'category must point to an expense account');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.expense_category_save(null, null, 'Snacks', null, '5200', true)$$, 'Finance access', 'a Sales user cannot add categories');

\echo == B. Department expense with a suggested category goes through the department's steps
select proof.as_user('00000000-0000-0000-0000-000000000013');
insert into expenses(business_id, section_id, month_id, description, amount, status, prepared_by, expense_date, suggested_category, vendor)
values (proof.get('pili')::uuid, proof.get('sales')::uuid, proof.get('month')::uuid, 'Delivery tolls', 500, 'draft', auth.uid(), current_date, 'Tolls and Parking', 'NLEX');
select proof.set('e1', (select id::text from expenses where description = 'Delivery tolls'));
update expenses set status = 'prepared', prepared_at = now() where id = proof.get('e1')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000014');
update expenses set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now() where id = proof.get('e1')::uuid;
update expenses set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = proof.get('e1')::uuid;
select proof.ok(proof.exp_status(proof.get('e1')::uuid) = 'approved', 'Sales approver approves the Sales expense');
select proof.fails($$select public.expense_post(proof.get('e1')::uuid, null, 1, null, null)$$, 'Finance approver posts', 'a department approver cannot post');
update expenses set status = 'posted' where id = proof.get('e1')::uuid;
select proof.ok(proof.exp_status(proof.get('e1')::uuid) = 'approved', 'a direct status change to posted does nothing (no update rights)');
select proof.fails($$select * from public.expense_register(current_date - 30, current_date)$$, 'Finance access', 'Sales cannot open the all-expenses register');

\echo == C. Finance register, mapping, posting into the ledger, paying
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok((select count(*) from public.expense_register(current_date - 30, current_date) r where r.id = proof.get('e1')::uuid and r.section_code = 'sales'
                 and r.suggested_category = 'Tolls and Parking') = 1, 'Finance sees the Sales expense with its suggestion in the register');
select proof.ok((select count(*) from expenses where id = proof.get('e1')::uuid) = 1, 'Finance reads every department''s expenses of its store');
select proof.fails($$select public.expense_post(proof.get('e1')::uuid, null, 1, null, null)$$, 'Choose a category before posting (suggested: Tolls and Parking)', 'posting needs a category; the suggestion is shown');
select proof.set('cat_tolls', public.expense_category_save(null, null, 'Tolls and Parking', null, '5200', true)::text);
select public.expense_set_category(proof.get('e1')::uuid, proof.get('cat_tolls')::uuid);
select proof.ok(proof.exp_mapped(proof.get('e1')::uuid, proof.get('cat_tolls')::uuid), 'Finance adds the suggested category and maps the expense');
select proof.set('g5200a', proof.gl('5200')::text);
select public.expense_post(proof.get('e1')::uuid, null, 1, null, null);
select proof.ok(proof.exp_status(proof.get('e1')::uuid) = 'posted', 'Finance posts the expense');
select proof.ok(proof.gl('5200') - proof.get('g5200a')::numeric = 500 and proof.gl('2000') = -500, 'posting books Dr Operating Expenses 500 / Cr Accounts Payable 500');
select proof.ok((select sum(expenses) from public.dashboard_period(current_date - 1, current_date + 1)) >= 500, 'the expense now reaches the dashboard figures');
select proof.fails($$select public.expense_post(proof.get('e1')::uuid, null, 1, null, null)$$, 'Only approved', 'an expense is posted once');
select public.expense_pay(proof.get('e1')::uuid, proof.get('cash')::uuid, current_date);
select proof.ok(proof.exp_status(proof.get('e1')::uuid) = 'paid' and proof.gl('2000') = 0, 'paying clears Accounts Payable');
select proof.ok((select count(*) from finance_cash_transactions where source_module = 'expenses' and source_record_id = proof.get('e1')::uuid and status = 'posted' and direction = 'out') = 1,
                'the payment is a posted cash-out from the chosen account');
select proof.fails($$select public.expense_set_category(proof.get('e1')::uuid, proof.get('cat_permit')::uuid)$$, 'keeps its category', 'a posted expense keeps its category');

\echo == D. Prepaid: a yearly permit spread over 12 months
select proof.as_user('00000000-0000-0000-0000-000000000016');   -- Logistics preparer
insert into expenses(business_id, section_id, month_id, description, amount, status, prepared_by, expense_date, category_id, is_yearly, spread_months)
values (proof.get('pili')::uuid, (select id from sections where code = 'logistics'), proof.get('month')::uuid, 'Mayor''s permit', 12000, 'draft', auth.uid(),
        proof.get('y0')::date, proof.get('cat_permit')::uuid, true, 12);
select proof.set('e2', (select id::text from expenses where description = 'Mayor''s permit'));
update expenses set status = 'prepared', prepared_at = now() where id = proof.get('e2')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000017');
update expenses set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now() where id = proof.get('e2')::uuid;
update expenses set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = proof.get('e2')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.set('g5200b', proof.gl('5200')::text);
select public.expense_post(proof.get('e2')::uuid, null, 12, proof.get('y0')::date, null);
select proof.ok(proof.gl('1300') = 12000 and proof.gl('5200') = proof.get('g5200b')::numeric, 'a spread expense goes to Prepaid Expenses, not straight to expense');
select proof.ok((select count(*) from public.expense_schedules() s where s.kind = 'prepaid' and s.total_amount = 12000 and s.months = 12 and s.booked = 0) = 1, 'a 12-month prepaid schedule is listed');

\echo == E. Accrual: annual audit fee set aside monthly
select proof.set('acc', public.expense_accrual_create('Annual audit fee', proof.get('cat_audit')::uuid, 24000, 12, proof.get('y0')::date)::text);
select proof.as_user('00000000-0000-0000-0000-000000000014');
select proof.fails($$select public.expense_accrual_create('x', proof.get('cat_audit')::uuid, 100, 12, current_date)$$, 'Finance approver', 'only Finance sets up accruals');
select proof.fails($$select * from public.expense_month_run(current_date)$$, 'Finance approver', 'only Finance runs the month-end');

\echo == F. 13th month from payroll
select proof.as_owner();
insert into employees(id, employee_no, first_name, last_name, business_id) values ('00000000-0000-0000-0000-0000000e0001', 'E-1', 'Ana', 'Reyes', proof.get('pili')::uuid);
insert into payroll_periods(id, period_name, start_date, end_date, business_id)
values ('00000000-0000-0000-0000-0000000e0101', 'Sept', date_trunc('month', now() - interval '1 month')::date, (date_trunc('month', now()) - interval '1 day')::date, proof.get('pili')::uuid);
insert into payroll_runs(id, run_number, period_id, status, business_id) values ('00000000-0000-0000-0000-0000000e0201', 'PR-T-1', '00000000-0000-0000-0000-0000000e0101', 'posted', proof.get('pili')::uuid);
insert into payroll_entries(payroll_run_id, employee_id, base_pay, business_id) values ('00000000-0000-0000-0000-0000000e0201', '00000000-0000-0000-0000-0000000e0001', 24000, proof.get('pili')::uuid);

\echo == G. Month-end run books every due month once
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.set('m', (extract(month from now()))::text);
create temp table run1 as select * from public.expense_month_run(current_date);
select proof.ok((select count(*) from run1 where schedule = 'Mayor''s permit') = proof.get('m')::int and (select sum(amount) from run1 where schedule = 'Mayor''s permit') = 1000 * proof.get('m')::int,
                'prepaid: one month (1,000) booked for each month from January to now');
select proof.ok((select sum(amount) from run1 where schedule = 'Annual audit fee') = 2000 * proof.get('m')::int, 'accrual: 2,000 set aside for each month so far');
select proof.ok((select sum(amount) from run1 where schedule like '13th month pay%') = 2000, '13th month: 1/12 of September basic pay (24,000) set aside');
select proof.ok(proof.gl('1300') = 12000 - 1000 * proof.get('m')::int and proof.gl('2120') = -2000 * proof.get('m')::int and proof.gl('2110') = -2000,
                'balances: prepaid used up, accruals set aside');
select proof.ok((select count(*) from public.expense_month_run(current_date)) = 0, 'running the month-end again books nothing twice');
select proof.fails($$select * from public.expense_month_run((current_date + interval '1 month')::date)$$, 'current or a past month', 'a future month cannot be run');
select proof.as_owner();
insert into employees(id, employee_no, first_name, last_name, business_id) values ('00000000-0000-0000-0000-0000000e0002', 'E-2', 'Ben', 'Cruz', proof.get('pili')::uuid);
insert into payroll_entries(payroll_run_id, employee_id, base_pay, business_id) values ('00000000-0000-0000-0000-0000000e0201', '00000000-0000-0000-0000-0000000e0002', 12000, proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000015');
create temp table run2 as select * from public.expense_month_run(current_date);
select proof.ok((select sum(amount) from run2 where schedule like '13th month pay%') = 1000 and proof.gl('2110') = -3000,
                '13th month catches up when payroll changes (only the 1,000 difference)');

\echo == H. The actual bill clears the accrual with a true-up
select proof.as_user('00000000-0000-0000-0000-000000000013');
insert into expenses(business_id, section_id, month_id, description, amount, status, prepared_by, expense_date, category_id)
values (proof.get('pili')::uuid, proof.get('sales')::uuid, proof.get('month')::uuid, 'Audit fee invoice', 2000 * proof.get('m')::int + 5000, 'draft', auth.uid(), current_date, proof.get('cat_audit')::uuid);
select proof.set('e3', (select id::text from expenses where description = 'Audit fee invoice'));
update expenses set status = 'prepared', prepared_at = now() where id = proof.get('e3')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000014');
update expenses set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now() where id = proof.get('e3')::uuid;
update expenses set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = proof.get('e3')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.set('g5200c', proof.gl('5200')::text);
select proof.fails($$select public.expense_post(proof.get('e3')::uuid, null, 3, null, proof.get('acc')::uuid)$$, 'either spread or charged', 'spread and accrual cannot be combined');
select public.expense_post(proof.get('e3')::uuid, null, 1, null, proof.get('acc')::uuid);
select proof.ok(proof.gl('2120') = 0 and proof.gl('5200') - proof.get('g5200c')::numeric = 5000, 'the bill clears what was set aside and books only the 5,000 difference');
select proof.ok((select status from finance_expense_schedules where id = proof.get('acc')::uuid) = 'settled', 'the accrual is settled');
select proof.fails($$select public.expense_schedule_cancel(proof.get('acc')::uuid)$$, 'Only an active schedule', 'a settled accrual cannot be cancelled');

\echo == I. Isolation
select proof.as_user('00000000-0000-0000-0000-000000000021');
select proof.fails($$select * from public.expense_schedules()$$, 'Finance access', 'another store''s cashier cannot see schedules');
select proof.ok((select count(*) from finance_expense_schedules) = 0, 'schedules are not readable without Finance access');
select proof.ok((select count(*) from expenses where id = proof.get('e1')::uuid) = 0, 'another store cannot read the expense');
select proof.as_owner();
select proof.ok((select count(*) from finance_journal_entries where business_id = (select id from businesses where code = 'PILI') and source_module in ('expenses','expense_payment','expense_schedule') and status <> 'posted') = 0,
                'every expense journal is posted');
\echo == Build 80 proof passed
