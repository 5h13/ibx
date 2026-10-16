-- Build 126 (employee cash advance) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('e1', (select id::text from employees where employee_no = 'E-1'));
update employees set user_id = '00000000-0000-0000-0000-000000000016' where id = proof.get('e1')::uuid;  -- P.Logistics is E-1

select proof.as_user('00000000-0000-0000-0000-000000000016');
select proof.fails($$select public.cash_advance_request(1000, 2, 'school fees')$$, 'not set up in payroll', 'no advance before the pay is set up');
select proof.as_owner();
insert into payroll_employee_profiles(business_id, employee_id, compensation_type, pay_frequency, base_rate, active, effective_from)
values (proof.get('pili')::uuid, proof.get('e1')::uuid, 'monthly', 'semi_monthly', 20000, true, '2026-01-01');

select proof.as_user('00000000-0000-0000-0000-000000000016');
select proof.ok((public.my_cash_advance()->>'limit')::numeric = 10000, 'the limit is half a month''s pay: ₱10,000 of ₱20,000');
select proof.fails($$select public.cash_advance_request(12000, 2, 'school fees')$$, 'half a month', 'more than half a month''s pay is refused');
select proof.fails($$select public.cash_advance_request(1000, 13, 'school fees')$$, '1 to 12 payments', 'more than 12 payments is refused');
select proof.fails($$select public.cash_advance_request(1000, 2, ' ')$$, 'what the advance is for', 'a reason is needed');
select proof.set('ca', public.cash_advance_request(6000, 3, 'school fees')::text);
select proof.ok((select instalment = 2000 and status = 'requested' and advance_number like 'CA-%' from employee_cash_advances where id = proof.get('ca')::uuid), '₱6,000 in 3 payments: ₱2,000 each, waiting for approval');
select proof.fails($$select public.cash_advance_request(1000, 1, 'more')$$, 'already have an open cash advance', 'one open advance at a time');
select proof.fails($$select public.cash_advance_decide(proof.get('ca')::uuid, true)$$, 'Business Admin approves', 'the employee cannot approve');
select proof.as_user('00000000-0000-0000-0000-000000000015');  -- Finance
select proof.fails($$select public.cash_advance_decide(proof.get('ca')::uuid, true)$$, 'Business Admin approves', 'Finance cannot approve');
select proof.fails($$select public.cash_advance_release(proof.get('ca')::uuid, null, 'cash')$$, 'Only an approved', 'nothing is released before approval');
select proof.as_user('00000000-0000-0000-0000-000000000011');  -- Business Admin
select proof.fails($$select public.cash_advance_decide(proof.get('ca')::uuid, false, '')$$, 'why', 'a rejection needs a reason');
select public.cash_advance_decide(proof.get('ca')::uuid, true);
select proof.ok((select status from employee_cash_advances where id = proof.get('ca')::uuid) = 'approved', 'the Business Admin approves');
select proof.as_user('00000000-0000-0000-0000-000000000015');
select public.cash_advance_release(proof.get('ca')::uuid, null, 'cash');
select proof.ok((select status = 'released' and release_journal_id is not null from employee_cash_advances where id = proof.get('ca')::uuid), 'Finance releases it');
select proof.as_owner();
select proof.ok((select bool_and(case a.account_code when '1330' then l.debit = 6000 when '1000' then l.credit = 6000 else false end) and count(*) = 2
                   from finance_journal_lines l join finance_chart_of_accounts a on a.id = l.account_id
                  where l.journal_entry_id = (select release_journal_id from employee_cash_advances where id = proof.get('ca')::uuid)), 'release: Dr 1330 Advances to Employees ₱6,000, Cr 1000 Cash');

-- payroll
insert into payroll_periods(id, business_id, period_name, start_date, end_date, frequency) values
  ('00000000-0000-0000-0000-0000012600a1', proof.get('pili')::uuid, 'T126 a', '2027-01-01', '2027-01-15', 'semi_monthly'),
  ('00000000-0000-0000-0000-0000012600a2', proof.get('pili')::uuid, 'T126 b', '2027-01-16', '2027-01-31', 'semi_monthly');
insert into payroll_runs(id, business_id, run_number, period_id, status) values
  ('00000000-0000-0000-0000-0000012600b1', proof.get('pili')::uuid, 'T126-1', '00000000-0000-0000-0000-0000012600a1', 'draft');
insert into payroll_entries(id, business_id, payroll_run_id, employee_id, base_pay, gross_pay, total_deductions, net_pay) values
  ('00000000-0000-0000-0000-0000012600c1', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000012600b1', proof.get('e1')::uuid, 10000, 10000, 0, 10000);
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok(public.payroll_apply_cash_advances('00000000-0000-0000-0000-0000012600b1') = 1, 'the payroll run picks up the advance');
select proof.ok((select cash_advance = 2000 and total_deductions = 2000 and net_pay = 8000 from payroll_entries where id = '00000000-0000-0000-0000-0000012600c1'), 'the instalment ₱2,000 is deducted: net ₱8,000');
select public.payroll_apply_cash_advances('00000000-0000-0000-0000-0000012600b1');
select proof.ok((select cash_advance = 2000 and net_pay = 8000 from payroll_entries where id = '00000000-0000-0000-0000-0000012600c1'), 'applying again changes nothing');
select public.payroll_compute_contributions('00000000-0000-0000-0000-0000012600b1');
select proof.ok((select cash_advance = 2000 and total_deductions > 2000 and net_pay = gross_pay - total_deductions from payroll_entries where id = '00000000-0000-0000-0000-0000012600c1'), 'computing contributions keeps the advance in the deductions');
select proof.as_owner();
select proof.ok((select x->>'credit' from jsonb_array_elements(public.fin_payroll_lines('00000000-0000-0000-0000-0000012600b1')) x where x->>'code' = '1330')::numeric = 2000, 'payroll journal: Cr 1330 ₱2,000 recovered');
select proof.ok((select sum(coalesce((x->>'debit')::numeric, 0)) = sum(coalesce((x->>'credit')::numeric, 0)) from jsonb_array_elements(public.fin_payroll_lines('00000000-0000-0000-0000-0000012600b1')) x), 'the payroll journal still balances');
select proof.as_user('00000000-0000-0000-0000-000000000016');
select proof.ok((public.my_cash_advance()->'history'->0->>'balance')::numeric = 4000, 'the employee sees ₱4,000 left');
select proof.as_owner();
update payroll_runs set status = 'voided' where id = '00000000-0000-0000-0000-0000012600b1';
select proof.as_user('00000000-0000-0000-0000-000000000016');
select proof.ok((public.my_cash_advance()->'history'->0->>'balance')::numeric = 6000, 'a voided run gives the deduction back');

-- separated: the whole balance from final pay, never more than the pay
select proof.as_owner();
update employees set employment_status = 'separated', separation_date = '2027-01-20' where id = proof.get('e1')::uuid;
insert into payroll_runs(id, business_id, run_number, period_id, status) values
  ('00000000-0000-0000-0000-0000012600b2', proof.get('pili')::uuid, 'T126-2', '00000000-0000-0000-0000-0000012600a2', 'draft');
insert into payroll_entries(id, business_id, payroll_run_id, employee_id, base_pay, gross_pay, total_deductions, net_pay) values
  ('00000000-0000-0000-0000-0000012600c2', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000012600b2', proof.get('e1')::uuid, 5000, 5000, 500, 4500);
select proof.as_user('00000000-0000-0000-0000-000000000015');
select public.payroll_apply_cash_advances('00000000-0000-0000-0000-0000012600b2');
select proof.ok((select cash_advance = 4500 and net_pay = 0 from payroll_entries where id = '00000000-0000-0000-0000-0000012600c2'), 'final pay: the balance is taken, up to the pay left (₱4,500 of ₱6,000)');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.cash_advances_list()$$, 'Access denied', 'a cashier cannot list advances');
rollback;
