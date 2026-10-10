-- Build 100 (ledger part 2: receivables raised in Finance, payroll and remittances, old expenses) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
select proof.set('t0', now()::text);
create or replace function pg_temp.bal(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from finance_journal_lines l join finance_journal_entries e on e.id = l.journal_entry_id
    join finance_chart_of_accounts a on a.id = l.account_id
   where e.business_id = proof.get('b')::uuid and a.account_code = p_code and e.status = 'posted' and e.created_at >= proof.get('t0')::timestamptz $$;
insert into finance_customers(id, business_id, customer_code, legal_name, active) values ('00000000-0000-0000-0000-000000010001', proof.get('b')::uuid, 'CUS-T100', 'Client T100', true);
insert into finance_bank_accounts(id, business_id, account_name, account_code, bank_name) values ('00000000-0000-0000-0000-000000010002', proof.get('b')::uuid, 'BPI T100', 'T100-BPI', 'BPI');

\echo == A. invoice raised in Finance, with VAT and a discount
insert into finance_customer_invoices(id, business_id, invoice_number, customer_id, invoice_date, subtotal, tax_amount, discount_amount, status, post_to_ledger)
values ('00000000-0000-0000-0000-000000010003', proof.get('b')::uuid, 'T100-INV1', '00000000-0000-0000-0000-000000010001', current_date, 10000, 1200, 200, 'reviewed', true);
update finance_customer_invoices set status = 'approved' where id = '00000000-0000-0000-0000-000000010003';
select proof.ok(pg_temp.bal('1100') = 11000 and pg_temp.bal('4000') = -9800 and pg_temp.bal('2210') = -1200, 'AR ₱11,000 = sales ₱9,800 + output VAT ₱1,200');
\echo == B. opening invoice, and a Storefront-made invoice (booked by the closing, not here)
insert into finance_customer_invoices(id, business_id, invoice_number, customer_id, invoice_date, subtotal, status, post_to_ledger, is_opening)
values ('00000000-0000-0000-0000-000000010004', proof.get('b')::uuid, 'T100-OPEN', '00000000-0000-0000-0000-000000010001', current_date, 5000, 'reviewed', true, true);
update finance_customer_invoices set status = 'approved' where id = '00000000-0000-0000-0000-000000010004';
select proof.ok(pg_temp.bal('3900') = -5000 and pg_temp.bal('1100') = 16000, 'opening invoice ₱5,000: AR against opening balance equity (not sales)');
insert into finance_customer_invoices(id, business_id, invoice_number, customer_id, invoice_date, subtotal, status)
values ('00000000-0000-0000-0000-000000010005', proof.get('b')::uuid, 'T100-DR', '00000000-0000-0000-0000-000000010001', current_date, 3000, 'reviewed');
update finance_customer_invoices set status = 'approved' where id = '00000000-0000-0000-0000-000000010005';
select proof.ok(pg_temp.bal('1100') = 16000, 'an invoice made by the Storefront (not flagged) adds nothing here — no double count');

\echo == C. receipt posted in Finance into the chosen account; voiding reverses
insert into finance_customer_receipts(id, business_id, receipt_number, invoice_id, receipt_date, amount, payment_method, bank_account, status, post_to_ledger)
values ('00000000-0000-0000-0000-000000010006', proof.get('b')::uuid, 'T100-OR1', '00000000-0000-0000-0000-000000010003', current_date, 4000, 'Bank transfer', '00000000-0000-0000-0000-000000010002', 'approved', true);
update finance_customer_receipts set status = 'posted' where id = '00000000-0000-0000-0000-000000010006';
select proof.ok(pg_temp.bal('1010') = 4000 and pg_temp.bal('1100') = 12000, 'receipt ₱4,000: bank +₱4,000, AR −₱4,000');
update finance_customer_receipts set status = 'voided' where id = '00000000-0000-0000-0000-000000010006';
select proof.ok(pg_temp.bal('1010') = 0 and pg_temp.bal('1100') = 16000, 'voiding the receipt reverses it');

\echo == D. payroll: approved → accrual; posted → net pay released; remittance
insert into payroll_periods(id, business_id, period_name, start_date, end_date, pay_date) values ('00000000-0000-0000-0000-000000010007', proof.get('b')::uuid, 'T100 Oct', '2026-10-01', '2026-10-15', current_date);
insert into payroll_runs(id, business_id, run_number, period_id, status) values ('00000000-0000-0000-0000-000000010008', proof.get('b')::uuid, 'T100-PR1', '00000000-0000-0000-0000-000000010007', 'reviewed');
insert into payroll_entries(business_id, payroll_run_id, employee_id, base_pay, gross_pay, social_security, health_contribution, housing_fund, tax_withheld, other_deductions, total_deductions, net_pay)
select proof.get('b')::uuid, '00000000-0000-0000-0000-000000010008', id, 20000, 20000, 900, 500, 200, 1000, 100, 2700, 17300 from employees where business_id = proof.get('b')::uuid limit 1;
update payroll_runs set status = 'approved' where id = '00000000-0000-0000-0000-000000010008';
select proof.ok(pg_temp.bal('5100') = 20000 and pg_temp.bal('2101') = -900 and pg_temp.bal('2102') = -500 and pg_temp.bal('2103') = -200
                and pg_temp.bal('2104') = -1000 and pg_temp.bal('2100') = -100 and pg_temp.bal('2105') = -17300, 'accrual: expense ₱20,000; SSS / PhilHealth / Pag-IBIG / tax / other payables; net ₱17,300 due');
update payroll_runs set paid_from_bank_account_id = '00000000-0000-0000-0000-000000010002', status = 'posted' where id = '00000000-0000-0000-0000-000000010008';
select proof.ok(pg_temp.bal('2105') = 0 and pg_temp.bal('1010') = -17300, 'posting releases the net pay from the chosen account');
update payroll_runs set status = 'posted' where id = '00000000-0000-0000-0000-000000010008';
select proof.ok((select count(*) from finance_journal_entries where source_record_id = '00000000-0000-0000-0000-000000010008') = 2, 'booked once (accrual + payment)');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.ok((select (x->>'balance')::numeric from jsonb_array_elements(public.payroll_liabilities()) x where x->>'code' = '2101') >= 900, 'the remit screen shows what is owed to SSS');
select public.payroll_remit(jsonb_build_object('code', '2101', 'amount', 900, 'bank_account_id', '00000000-0000-0000-0000-000000010002', 'reference', 'SSS PRN 123'));
select proof.fails($$select public.payroll_remit('{"code":"5200","amount":1}')$$, 'Choose what is being remitted', 'only payroll payables can be remitted');
reset role; select proof.as_owner();
select proof.ok(pg_temp.bal('2101') = 0 and pg_temp.bal('1010') = -18200, 'SSS remitted: payable cleared, bank −₱900');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.payroll_remit('{"code":"2101","amount":1}')$$, 'Finance approver', 'a cashier cannot record remittances');
reset role; select proof.as_owner();

\echo == E. old expenses (no journal yet), as book_old_expenses.sql does
insert into months(business_id, year, month, label) values (proof.get('b')::uuid, 2026, 1, 'January 2026') on conflict do nothing;
insert into expenses(id, section_id, month_id, business_id, description, amount, status, expense_date, category_id, payment_method, paid_at)
select '00000000-0000-0000-0000-000000010009', (select id from sections where code = 'admin'), m.id, proof.get('b')::uuid, 'T100 old paid expense', 750, 'paid', '2026-01-10',
       (select id from admin_expense_categories where code = 'rent'), 'Cash', '2026-01-10'
  from months m where m.business_id = proof.get('b')::uuid and m.year = 2026 and m.month = 1;
do $$
declare e record; v uuid; v_cash text;
begin
  for e in select x.* from public.expenses x where x.status::text in ('posted', 'paid') and x.journal_entry_id is null and x.category_id is not null and x.amount > 0 loop
    if e.status::text = 'posted' then
      v := public.fin_auto_journal(e.business_id, coalesce(e.expense_date, e.created_at::date), 'Expense (booked late): ' || e.description, 'expense', e.id,
             jsonb_build_array(jsonb_build_object('code', public.exp_gl_code(e.category_id), 'debit', e.amount), jsonb_build_object('code', '2000', 'credit', e.amount)));
      update public.expenses set journal_entry_id = v where id = e.id;
    else
      v_cash := public.fin_cash_code(e.business_id, null, e.payment_method);
      v := public.fin_auto_journal(e.business_id, coalesce(e.paid_at::date, e.expense_date, e.created_at::date), 'Expense paid (booked late): ' || e.description, 'expense', e.id,
             jsonb_build_array(jsonb_build_object('code', public.exp_gl_code(e.category_id), 'debit', e.amount), jsonb_build_object('code', v_cash, 'credit', e.amount)));
      update public.expenses set journal_entry_id = v, payment_journal_id = coalesce(payment_journal_id, v) where id = e.id;
    end if;
  end loop;
end $$;
select proof.ok(pg_temp.bal('1000') = -750 and (select journal_entry_id is not null from expenses where id = '00000000-0000-0000-0000-000000010009'), 'a paid old expense: expense against cash, linked so it never books twice');

\echo == F. every entry balances
select proof.ok(not exists (select 1 from finance_journal_entries e where e.business_id = proof.get('b')::uuid and e.created_at >= proof.get('t0')::timestamptz
                 and (select sum(debit) - sum(credit) from finance_journal_lines where journal_entry_id = e.id) <> 0), 'every entry balances');
rollback;
