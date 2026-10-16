-- Build 125 (Admin / HR set-up) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
select proof.set('e1', (select id::text from employees where employee_no = 'E-1'));
select proof.set('e2', (select id::text from employees where employee_no = 'E-2'));

-- 1. HR masters
select proof.ok((select count(*) from hr_departments where name in ('Admin', 'Logistics', 'Marketing', 'Purchasing', 'Sales', 'Management')) = 6, 'departments filled from the employees'' and commission plans'' names');
select proof.ok((select count(*) from hr_positions where name in ('Sales Manager', 'Store Manager')) = 2, 'positions filled from the employees'' titles');
select proof.ok(not exists (select 1 from employees where coalesce(department, '') <> '' and department_id is null), 'every employee with a department is linked to it');
select proof.ok((select count(*) from hr_departments where lower(name) = 'logistics') = 1, 'no duplicate departments');
update employees set position_id = (select id from hr_positions where name = 'Store Manager') where id = proof.get('e1')::uuid;
select proof.ok((select position_title from employees where id = proof.get('e1')::uuid) = 'Store Manager', 'choosing a position fills the typed title');

-- 2. schedules: the store default applies when the employee has none
insert into work_schedules(id, business_id, name, monday_in, monday_out) values ('00000000-0000-0000-0000-0000012500a1', proof.get('pili')::uuid, 'Store hours', '08:00', '17:00');
insert into work_schedules(id, business_id, name) values ('00000000-0000-0000-0000-0000012500a2', proof.get('aton')::uuid, 'ATON hours');
select proof.ok(public.employee_schedule_on(proof.get('e1')::uuid, '2026-09-07') is null, 'no assignment and no default: no schedule');
update hr_store_settings set default_schedule_id = '00000000-0000-0000-0000-0000012500a1' where business_id = proof.get('pili')::uuid;
select proof.ok(public.employee_schedule_on(proof.get('e1')::uuid, '2026-09-07') = '00000000-0000-0000-0000-0000012500a1', 'the store default schedule applies');
select proof.fails($$update hr_store_settings set default_schedule_id = '00000000-0000-0000-0000-0000012500a2' where business_id = proof.get('pili')::uuid$$, 'must be one of this store', 'another store''s schedule cannot be the default');
select proof.ok((select pay_cycle from hr_store_settings where business_id = proof.get('pili')::uuid) = 'semi_monthly', 'stores start semi-monthly');

-- 3. attendance periods
insert into attendance_records(id, business_id, employee_id, attendance_date, status) values
  ('00000000-0000-0000-0000-0000012500b1', proof.get('pili')::uuid, proof.get('e1')::uuid, '2026-08-03', 'present'),
  ('00000000-0000-0000-0000-0000012500b2', proof.get('pili')::uuid, proof.get('e1')::uuid, '2026-08-20', 'present');
select proof.ok((select p.start_date = '2026-08-01' and p.end_date = '2026-08-15' and p.name = 'Aug 1–15, 2026' from attendance_records r join attendance_periods p on p.id = r.period_id where r.id = '00000000-0000-0000-0000-0000012500b1'), 'a day in 1–15 joins the period Aug 1–15, created automatically');
select proof.ok((select p.start_date = '2026-08-16' and p.end_date = '2026-08-31' and p.name = 'Aug 16–31, 2026' from attendance_records r join attendance_periods p on p.id = r.period_id where r.id = '00000000-0000-0000-0000-0000012500b2'), 'a day after the 15th joins Aug 16–31');
select proof.set('p1', (select period_id::text from attendance_records where id = '00000000-0000-0000-0000-0000012500b1'));
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.attendance_period_lock(proof.get('p1')::uuid)$$, 'Admin access required', 'a cashier cannot lock a period');
select proof.as_user('00000000-0000-0000-0000-000000000011');
insert into attendance_corrections(business_id, attendance_id, requested_by, reason) values (proof.get('pili')::uuid, '00000000-0000-0000-0000-0000012500b1', auth.uid(), 'forgot to clock out');
select proof.fails($$select public.attendance_period_lock(proof.get('p1')::uuid)$$, 'still pending', 'a period with a pending correction cannot be locked');
select proof.as_owner();
update attendance_corrections set status = 'rejected' where attendance_id = '00000000-0000-0000-0000-0000012500b1';
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.attendance_period_lock(proof.get('p1')::uuid);
select proof.ok((select status from attendance_periods where id = proof.get('p1')::uuid) = 'locked', 'the Business Admin locks the period');
select proof.fails($$update attendance_records set notes = 'x' where id = '00000000-0000-0000-0000-0000012500b1'$$, 'locked period', 'a locked day cannot be changed');
select proof.fails($$insert into attendance_records(business_id, employee_id, attendance_date, status) values (proof.get('pili')::uuid, proof.get('e2')::uuid, '2026-08-04', 'present')$$, 'locked period', 'no new day can be added to a locked period');
select proof.ok(public.attendance_locked_for(proof.get('pili')::uuid, '2026-08-01', '2026-08-15') is null, 'payroll may run on 1–15 (locked)');
select proof.ok(public.attendance_locked_for(proof.get('pili')::uuid, '2026-08-01', '2026-08-31') like '%Aug 16–31%not locked%', 'payroll for the whole month waits for 16–31');
select proof.fails($$select public.attendance_period_reopen(proof.get('p1')::uuid, '')$$, 'Say why', 'reopening needs a reason');
select public.attendance_period_reopen(proof.get('p1')::uuid, 'missed OT entry');
select proof.ok((select status from attendance_periods where id = proof.get('p1')::uuid) = 'open', 'the Business Admin reopens it with a reason');
select proof.as_owner();
insert into attendance_records(id, business_id, employee_id, attendance_date, status) values ('00000000-0000-0000-0000-0000012500b3', proof.get('pili')::uuid, proof.get('e2')::uuid, '2026-09-08', 'present');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.attendance_period_lock((select period_id from attendance_records where id = '00000000-0000-0000-0000-0000012500b3'));
select proof.fails($$select public.attendance_period_reopen((select period_id from attendance_records where id = '00000000-0000-0000-0000-0000012500b3'), 'fix')$$, 'already uses this period', 'a period paid by a posted payroll run cannot be reopened');
select proof.as_owner();
insert into attendance_records(business_id, employee_id, attendance_date, status) values (proof.get('pili')::uuid, proof.get('e2')::uuid, current_date, 'present');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.attendance_period_lock((select period_id from attendance_records where employee_id = proof.get('e2')::uuid and attendance_date = current_date))$$, 'lock it after that day', 'a period still running cannot be locked');
select proof.as_owner();

-- 4. leave
select proof.ok(public.leave_prorated(15, '2026-07-01', 2026) = 7.5, 'hired 1 July: 15 days pro-rated to 7.5');
select proof.ok(public.leave_prorated(15, '2025-03-01', 2026) = 15, 'hired before the year: full days');
select proof.ok(public.leave_prorated(5, '2026-12-01', 2026) = 0.5, 'hired in December: 5 days → 0.5');
update employees set hire_date = '2026-07-01' where id = proof.get('e2')::uuid;
insert into employee_leave_balances(business_id, employee_id, leave_type_id, leave_year, entitlement, used)
values (proof.get('pili')::uuid, proof.get('e1')::uuid, (select id from leave_types where code = 'vacation'), 2025, 15, 10);
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.leave_grant_year(2026)$$, 'Admin access required', 'a cashier cannot grant leave');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok((public.leave_grant_year(2026, true, 3)->>'employees')::int = 3, 'grant for 2026 covers the store''s 3 current employees');
select proof.ok((select entitlement = 15 and carried_over = 3 from employee_leave_balances where employee_id = proof.get('e1')::uuid and leave_year = 2026 and leave_type_id = (select id from leave_types where code = 'vacation')), 'E-1: 15 vacation days + 3 carried (5 unused, limit 3)');
select proof.ok((select entitlement from employee_leave_balances where employee_id = proof.get('e2')::uuid and leave_year = 2026 and leave_type_id = (select id from leave_types where code = 'vacation')) = 7.5, 'E-2 hired in July: 7.5 vacation days');
select proof.ok(not exists (select 1 from employee_leave_balances b join leave_types t on t.id = b.leave_type_id where t.code = 'unpaid' and b.leave_year = 2026 and b.business_id = proof.get('pili')::uuid), 'no balance for unpaid leave (no default days)');
select proof.ok(not exists (select 1 from employee_leave_balances b join employees e on e.id = b.employee_id where b.leave_year = 2026 and e.business_id <> proof.get('pili')::uuid), 'only this store''s employees are granted');
update employee_leave_balances set used = 2 where employee_id = proof.get('e1')::uuid and leave_year = 2026 and leave_type_id = (select id from leave_types where code = 'vacation');
select public.leave_grant_year(2026, false);
select proof.ok((select used = 2 and carried_over = 3 from employee_leave_balances where employee_id = proof.get('e1')::uuid and leave_year = 2026 and leave_type_id = (select id from leave_types where code = 'vacation')), 'granting again keeps days used and the carry-over');
select proof.ok(public.leave_adjust(proof.get('e1')::uuid, (select id from leave_types where code = 'vacation'), 2026, 2, 'service award') = 18, 'adjust +2: 15 + 3 + 2 − 2 used = 18 left');
select proof.ok((select reason from leave_balance_adjustments order by created_at desc limit 1) = 'service award', 'the adjustment and its reason are kept');
select proof.fails($$select public.leave_adjust(proof.get('e1')::uuid, (select id from leave_types where code = 'vacation'), 2026, -30, 'x')$$, 'below zero', 'a balance cannot go below zero');
select proof.fails($$select public.leave_adjust(proof.get('e1')::uuid, (select id from leave_types where code = 'vacation'), 2026, 1, ' ')$$, 'Say why', 'an adjustment needs a reason');
insert into employees(business_id, first_name, last_name, employment_status, hire_date) values (proof.get('pili')::uuid, 'New', 'Hire', 'active', make_date(extract(year from current_date)::int, 1, 15));
select proof.ok((select count(*) from employee_leave_balances b join employees e on e.id = b.employee_id where e.first_name = 'New' and e.last_name = 'Hire' and b.leave_year = extract(year from current_date)) = 3, 'a new employee gets this year''s vacation, sick and emergency leave');
select proof.as_owner();

-- 5. allowances
select proof.ok(not exists (select 1 from expense_allowances where agent_id is not null and active), 'agent allowances switched off');
select proof.fails($$insert into expense_allowances(business_id, agent_id, category_id, monthly_limit) values (proof.get('pili')::uuid, (select id from sales_agents limit 1), (select id from admin_expense_categories limit 1), 100)$$, 'employees only', 'no new agent allowance');

-- 6. recurring monthly expense
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'single');
select proof.as_owner();
select proof.set('m0', (select id::text from months where business_id = proof.get('pili')::uuid and year = extract(year from current_date - interval '3 months') and month = extract(month from current_date - interval '3 months')));
insert into months(business_id, year, month, label) select proof.get('pili')::uuid, extract(year from current_date - interval '3 months'), extract(month from current_date - interval '3 months'), 'x' where proof.get('m0') is null;
insert into expenses(id, business_id, section_id, month_id, description, amount, status, prepared_by, expense_date, recurring_monthly, recurring_months)
values ('00000000-0000-0000-0000-0000012500e1', proof.get('pili')::uuid, (select id from sections where code = 'logistics'),
        (select id from months where business_id = proof.get('pili')::uuid and year = extract(year from current_date - interval '3 months') and month = extract(month from current_date - interval '3 months')),
        'Warehouse rent', 10000, 'draft', '00000000-0000-0000-0000-000000000016', (date_trunc('month', current_date) - interval '3 months')::date, true, 12);
select proof.fails($$update expenses set is_yearly = true where id = '00000000-0000-0000-0000-0000012500e1'$$, 'expenses_recurring_check', 'a recurring expense cannot also be a yearly spread');
select proof.as_user('00000000-0000-0000-0000-000000000016');
update expenses set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000012500e1';
select proof.ok((select recurring_series_id is not null from expenses where id = '00000000-0000-0000-0000-0000012500e1'), 'approving the first month opens the series');
select proof.ok(public.expense_recurring_run(proof.get('pili')::uuid) = 3, 'the 3 months that have arrived since are created');
select proof.ok(public.expense_recurring_run(proof.get('pili')::uuid) = 0, 'running again creates nothing twice');
select proof.as_owner();
select proof.ok((select count(*) from expenses where recurring_series_id = (select recurring_series_id from expenses where id = '00000000-0000-0000-0000-0000012500e1') and status = 'approved' and amount = 10000) = 4, '4 approved monthly expenses of 10,000 so far');
select proof.ok((select notes from expenses where recurring_series_id is not null and expense_date = date_trunc('month', current_date)::date) like 'Recurring monthly expense, month 4 of 12%', 'this month''s is labelled month 4 of 12');
select proof.set('ser', (select recurring_series_id::text from expenses where id = '00000000-0000-0000-0000-0000012500e1'));
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.expense_recurring_stop(proof.get('ser')::uuid, 'moved out')$$, 'Only the department', 'a cashier cannot stop it');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.expense_recurring_stop((select recurring_series_id from expenses where id = '00000000-0000-0000-0000-0000012500e1'), 'moved out');
select proof.ok((select status from expense_recurring_series where source_expense_id = '00000000-0000-0000-0000-0000012500e1') = 'stopped', 'the Business Admin stops it; months made stay');
rollback;
