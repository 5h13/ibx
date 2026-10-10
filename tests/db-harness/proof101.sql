-- Build 101 (employer share of SSS / EC, PhilHealth, Pag-IBIG) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
select proof.set('t0', now()::text);
select proof.set('e1', (select id::text from employees where business_id = proof.get('b')::uuid order by id limit 1));
select proof.set('e2', (select id::text from employees where business_id = proof.get('b')::uuid order by id offset 1 limit 1));
create or replace function pg_temp.bal(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from finance_journal_lines l join finance_journal_entries e on e.id = l.journal_entry_id
    join finance_chart_of_accounts a on a.id = l.account_id
   where e.business_id = proof.get('b')::uuid and a.account_code = p_code and e.status = 'posted' and e.created_at >= proof.get('t0')::timestamptz $$;

\echo == A. monthly shares from the default schedule
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 20000) @> '{"msc":20000,"sss_ee":1000,"sss_er":2000,"ec":30,"ph_ee":500,"ph_er":500,"hdmf_ee":200,"hdmf_er":200}', '₱20,000: SSS 1,000 / 2,000 + EC 30; PhilHealth 500 / 500; Pag-IBIG 200 / 200');
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 13000) @> '{"msc":13000,"sss_ee":650,"sss_er":1300,"ec":10,"ph_ee":325,"ph_er":325}', '₱13,000: EC ₱10 below a ₱15,000 credit');
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 8000) @> '{"ph_ee":250,"ph_er":250}', '₱8,000: PhilHealth on the ₱10,000 floor');
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 50000) @> '{"msc":35000,"sss_ee":1750,"sss_er":3500,"hdmf_ee":200}', '₱50,000: SSS credit capped at ₱35,000, Pag-IBIG at ₱10,000');
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 1200) @> '{"hdmf_ee":12,"hdmf_er":24}', 'Pag-IBIG 1% employee up to ₱1,500');
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 12740) @> '{"msc":12500}', 'credit rounds to the nearest ₱500');

\echo == B. compute for a semi-monthly draft run (monthly and daily employees)
delete from payroll_employee_profiles where employee_id in (proof.get('e1')::uuid, proof.get('e2')::uuid);
insert into payroll_employee_profiles(business_id, employee_id, compensation_type, base_rate, active, effective_from) values
  (proof.get('b')::uuid, proof.get('e1')::uuid, 'monthly', 20000, true, current_date), (proof.get('b')::uuid, proof.get('e2')::uuid, 'daily', 500, true, current_date);
insert into payroll_periods(id, business_id, period_name, start_date, end_date, pay_date, frequency) values ('00000000-0000-0000-0000-000000010107', proof.get('b')::uuid, 'T101 Oct A', '2026-10-01', '2026-10-15', current_date, 'semi_monthly');
insert into payroll_runs(id, business_id, run_number, period_id, status) values ('00000000-0000-0000-0000-000000010108', proof.get('b')::uuid, 'T101-PR1', '00000000-0000-0000-0000-000000010107', 'draft');
insert into payroll_entries(business_id, payroll_run_id, employee_id, base_pay, gross_pay, tax_withheld, total_deductions, net_pay) values
  (proof.get('b')::uuid, '00000000-0000-0000-0000-000000010108', proof.get('e1')::uuid, 10000, 10000, 0, 0, 10000),
  (proof.get('b')::uuid, '00000000-0000-0000-0000-000000010108', proof.get('e2')::uuid, 6500, 6500, 0, 0, 6500);
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.payroll_compute_contributions('00000000-0000-0000-0000-000000010108')$$, 'Finance access', 'a cashier cannot compute contributions');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.ok(public.payroll_compute_contributions('00000000-0000-0000-0000-000000010108') = 2, 'computed for both employees');
reset role; select proof.as_owner();
select proof.ok((select social_security = 500 and er_sss = 1000 and er_ec = 15 and health_contribution = 250 and er_philhealth = 250 and housing_fund = 100 and er_pagibig = 100 and net_pay = 9150
                   from payroll_entries where payroll_run_id = '00000000-0000-0000-0000-000000010108' and employee_id = proof.get('e1')::uuid), 'monthly ₱20,000, half-month: both shares halved; net ₱9,150');
select proof.ok((select social_security = 325 and er_sss = 650 and er_ec = 5 and health_contribution = 162.50 and er_philhealth = 162.50 and housing_fund = 100 and net_pay = 5912.50
                   from payroll_entries where payroll_run_id = '00000000-0000-0000-0000-000000010108' and employee_id = proof.get('e2')::uuid), 'daily ₱500 = ₱13,000 a month; half-month shares; net ₱5,912.50');
select proof.ok((select net_pay = 15062.50 and total_deductions = 1437.50 from payroll_runs where id = '00000000-0000-0000-0000-000000010108'), 'run totals refreshed');

\echo == C. approval books the employer share
update payroll_runs set status = 'reviewed' where id = '00000000-0000-0000-0000-000000010108';
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.payroll_compute_contributions('00000000-0000-0000-0000-000000010108')$$, 'only on a draft', 'not after the draft stage');
reset role; select proof.as_owner();
update payroll_runs set status = 'approved' where id = '00000000-0000-0000-0000-000000010108';
select proof.ok(pg_temp.bal('5100') = 16500 and pg_temp.bal('5120') = 2282.50, 'expense: gross ₱16,500 + employer contributions ₱2,282.50');
select proof.ok(pg_temp.bal('2101') = -2495 and pg_temp.bal('2102') = -825 and pg_temp.bal('2103') = -400, 'SSS ₱2,495 / PhilHealth ₱825 / Pag-IBIG ₱400 owed — both shares');
select proof.ok(pg_temp.bal('2105') = -15062.50, 'net pay due unchanged by the employer share');
select proof.ok((select sum(l.debit) = sum(l.credit) from finance_journal_lines l join finance_journal_entries e on e.id = l.journal_entry_id where e.source_record_id = '00000000-0000-0000-0000-000000010108'), 'balanced');

\echo == D. rates editable per store
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.payroll_contribution_settings_save('{"ph_pct":4}')$$, 'Finance approver', 'a cashier cannot change rates');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.payroll_contribution_settings_save('{"ph_pct":4}');
select proof.ok(public.payroll_contribution_shares(proof.get('b')::uuid, 20000) @> '{"ph_ee":400,"ph_er":400}', 'PhilHealth rate changed to 4% for this store');
reset role; select proof.as_owner();
select proof.ok(public.payroll_contribution_shares((select id from businesses where code = 'ATON'), 20000) @> '{"ph_ee":500}', 'other stores keep their own rates');
rollback;
