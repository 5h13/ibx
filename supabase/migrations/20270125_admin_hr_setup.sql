-- Build 125 — Admin / HR set-up (UIA-25, 37, 38, 40, 41, 42, 43, 45).
--   1. HR masters filled from the names already in use; employees linked; names kept in step.
--   2. Store HR settings: pay cycle (semi-monthly by default) and default work schedule.
--   3. Attendance periods created automatically per pay cycle; every attendance row joins its
--      period; a locked period refuses changes.
--   4. Leave: carry-over column, adjustments log, yearly grant (pro-rated), per-employee adjust,
--      new employees get the year's defaults.
--   5. Allowances are for employees only: agent allowances switched off.
--   6. Recurring monthly expenses: approved once, one expense per month after that.

-- ------------------------------------------------------------------ helpers --
create or replace function public.hr_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or public.in_section((select id from public.sections where code = 'admin'));
$$;
revoke all on function public.hr_can_manage() from public;
grant execute on function public.hr_can_manage() to authenticated;

-- ------------------------------------------------- 1. HR masters (UIA-37) --
insert into public.hr_departments(name)
select distinct on (lower(n)) n from (
  select btrim(department) n from public.employees where coalesce(btrim(department), '') <> ''
  union all
  select btrim(label) from public.bo_plans where kind = 'department' and coalesce(btrim(label), '') <> ''
) s
where not exists (select 1 from public.hr_departments d where lower(d.name) = lower(s.n))
order by lower(n), n;

insert into public.hr_positions(name)
select distinct on (lower(n)) n from (
  select btrim(position_title) n from public.employees where coalesce(btrim(position_title), '') <> ''
) s
where not exists (select 1 from public.hr_positions p where lower(p.name) = lower(s.n))
order by lower(n), n;

update public.employees e set department_id = d.id
  from public.hr_departments d
 where e.department_id is null and coalesce(btrim(e.department), '') <> '' and lower(d.name) = lower(btrim(e.department));
update public.employees e set position_id = p.id
  from public.hr_positions p
 where e.position_id is null and coalesce(btrim(e.position_title), '') <> '' and lower(p.name) = lower(btrim(e.position_title));

-- The typed department / position follow the chosen master entry, so lists and reports agree.
create or replace function public.employees_sync_master_names()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.department_id is not null then
    select name into new.department from public.hr_departments where id = new.department_id;
  end if;
  if new.position_id is not null then
    select name into new.position_title from public.hr_positions where id = new.position_id;
  end if;
  return new;
end $$;
drop trigger if exists employees_sync_master_names on public.employees;
create trigger employees_sync_master_names before insert or update on public.employees
  for each row execute function public.employees_sync_master_names();

-- ----------------------------------------- 2. store HR settings (UIA-40/43) --
create table if not exists public.hr_store_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  pay_cycle text not null default 'semi_monthly' check (pay_cycle in ('semi_monthly', 'monthly')),
  default_schedule_id uuid references public.work_schedules(id) on delete set null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
insert into public.hr_store_settings(business_id) select id from public.businesses on conflict do nothing;
alter table public.hr_store_settings enable row level security;
drop policy if exists hr_store_settings_read on public.hr_store_settings;
create policy hr_store_settings_read on public.hr_store_settings for select
  using (public.is_super_admin() or business_id = public.current_business_id());
drop policy if exists hr_store_settings_write on public.hr_store_settings;
create policy hr_store_settings_write on public.hr_store_settings for all
  using (public.hr_can_manage() and (public.is_super_admin() or business_id = public.current_business_id()))
  with check (public.hr_can_manage() and (public.is_super_admin() or business_id = public.current_business_id()));
grant select, insert, update on public.hr_store_settings to authenticated;

create or replace function public.hr_store_settings_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.default_schedule_id is not null
     and not exists (select 1 from public.work_schedules where id = new.default_schedule_id and business_id = new.business_id) then
    raise exception 'The default schedule must be one of this store''s schedules.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_store_settings_check on public.hr_store_settings;
create trigger hr_store_settings_check before insert or update on public.hr_store_settings
  for each row execute function public.hr_store_settings_check();

-- The schedule in force for an employee on a date: their own assignment, else the store default.
create or replace function public.employee_schedule_on(p_employee uuid, p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.schedule_id from public.employee_schedule_assignments a
      where a.employee_id = p_employee and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
      order by a.effective_from desc limit 1),
    (select s.default_schedule_id from public.employees e join public.hr_store_settings s on s.business_id = e.business_id
      where e.id = p_employee));
$$;
revoke all on function public.employee_schedule_on(uuid, date) from public;
grant execute on function public.employee_schedule_on(uuid, date) to authenticated, service_role;

-- --------------------------------------- 3. attendance periods (UIA-43) --
create or replace function public.attendance_period_for(p_business uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cycle text; v_start date; v_end date; v_name text;
begin
  if p_business is null or p_date is null then return null; end if;
  select id into v_id from public.attendance_periods
   where business_id = p_business and start_date <= p_date and end_date >= p_date
   order by start_date desc limit 1;
  if v_id is not null then return v_id; end if;
  select coalesce((select pay_cycle from public.hr_store_settings where business_id = p_business), 'semi_monthly') into v_cycle;
  if v_cycle = 'monthly' then
    v_start := date_trunc('month', p_date)::date;
    v_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
    v_name := to_char(p_date, 'FMMonth YYYY');
  elsif extract(day from p_date) <= 15 then
    v_start := date_trunc('month', p_date)::date;
    v_end := v_start + 14;
    v_name := to_char(p_date, 'Mon') || ' 1–15, ' || to_char(p_date, 'YYYY');
  else
    v_start := date_trunc('month', p_date)::date + 15;
    v_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
    v_name := to_char(p_date, 'Mon') || ' 16–' || extract(day from v_end) || ', ' || to_char(p_date, 'YYYY');
  end if;
  -- a hand-made period may already cover part of the cycle: start after it / end before the next one
  select coalesce(max(end_date) + 1, v_start) into v_start from public.attendance_periods
   where business_id = p_business and end_date >= v_start and end_date < p_date;
  select coalesce(min(start_date) - 1, v_end) into v_end from public.attendance_periods
   where business_id = p_business and start_date <= v_end and start_date > p_date;
  insert into public.attendance_periods(business_id, name, start_date, end_date, status)
  values (p_business, v_name, v_start, v_end, 'open')
  on conflict (business_id, start_date, end_date) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.attendance_periods where business_id = p_business and start_date = v_start and end_date = v_end;
  end if;
  return v_id;
end $$;
revoke all on function public.attendance_period_for(uuid, date) from public;
grant execute on function public.attendance_period_for(uuid, date) to authenticated;

create or replace function public.attendance_records_period()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.period_id is not null then
    select name into v_name from public.attendance_periods where id = old.period_id and status = 'locked';
    if v_name is not null then
      raise exception 'Attendance for % is in the locked period %; ask HR to reopen it.', old.attendance_date, v_name;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.period_id := public.attendance_period_for(new.business_id, new.attendance_date);
  select name into v_name from public.attendance_periods where id = new.period_id and status = 'locked';
  if v_name is not null then
    raise exception 'Attendance for % is in the locked period %; ask HR to reopen it.', new.attendance_date, v_name;
  end if;
  return new;
end $$;
drop trigger if exists attendance_records_period on public.attendance_records;
create trigger attendance_records_period before insert or update or delete on public.attendance_records
  for each row execute function public.attendance_records_period();

update public.attendance_records set period_id = public.attendance_period_for(business_id, attendance_date)
 where period_id is null;

-- Lock: after the period has ended and with no correction still pending. Reopen: Business Admin,
-- and only while no payroll run beyond draft covers the period.
create or replace function public.attendance_period_lock(p_period uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p record; v_pending int;
begin
  if not public.hr_can_manage() then raise exception 'Admin access required.'; end if;
  select * into p from public.attendance_periods where id = p_period for update;
  if not found or not (public.is_super_admin() or p.business_id = public.current_business_id()) then raise exception 'Period not found.'; end if;
  if p.status = 'locked' then raise exception 'This period is already locked.'; end if;
  if p.end_date >= (now() at time zone 'Asia/Manila')::date then
    raise exception 'The period ends on %; lock it after that day.', p.end_date;
  end if;
  select count(*) into v_pending from public.attendance_corrections c join public.attendance_records r on r.id = c.attendance_id
   where r.period_id = p.id and c.status in ('prepared', 'reviewed');
  if v_pending > 0 then raise exception '% correction request(s) in this period are still pending; decide them first.', v_pending; end if;
  update public.attendance_periods set status = 'locked', locked_at = now(), locked_by = auth.uid() where id = p.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'attendance_periods', p.id, 'approved', jsonb_build_object('action', 'locked', 'name', p.name));
end $$;
revoke all on function public.attendance_period_lock(uuid) from public;
grant execute on function public.attendance_period_lock(uuid) to authenticated;

create or replace function public.attendance_period_reopen(p_period uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p record; v_run text;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin can reopen a locked period.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the period is reopened.'; end if;
  select * into p from public.attendance_periods where id = p_period for update;
  if not found or not (public.is_super_admin() or p.business_id = public.current_business_id()) then raise exception 'Period not found.'; end if;
  if p.status <> 'locked' then raise exception 'This period is not locked.'; end if;
  select r.run_number into v_run from public.payroll_runs r join public.payroll_periods pp on pp.id = r.period_id
   where pp.business_id = p.business_id and pp.start_date <= p.end_date and pp.end_date >= p.start_date
     and r.status not in ('draft', 'voided') limit 1;
  if v_run is not null then raise exception 'Payroll run % already uses this period; it cannot be reopened.', v_run; end if;
  update public.attendance_periods set status = 'open', locked_at = null, locked_by = null where id = p.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'attendance_periods', p.id, 'reopened', jsonb_build_object('name', p.name, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.attendance_period_reopen(uuid, text) from public;
grant execute on function public.attendance_period_reopen(uuid, text) to authenticated;

-- Payroll may only run on dates fully covered by locked attendance periods. Returns null when
-- ready, else the reason.
create or replace function public.attendance_locked_for(p_business uuid, p_start date, p_end date)
returns text language plpgsql stable security definer set search_path = public as $$
declare d date := p_start; p record;
begin
  while d <= p_end loop
    select * into p from public.attendance_periods where business_id = p_business and start_date <= d and end_date >= d
     order by start_date desc limit 1;
    if not found then return 'No attendance period covers ' || d || '.'; end if;
    if p.status <> 'locked' then return 'Attendance period ' || p.name || ' is not locked yet; HR locks it after review.'; end if;
    d := p.end_date + 1;
  end loop;
  return null;
end $$;
revoke all on function public.attendance_locked_for(uuid, date, date) from public;
grant execute on function public.attendance_locked_for(uuid, date, date) to authenticated;

-- -------------------------------------------------- 4. leave (UIA-41/42) --
alter table public.employee_leave_balances add column if not exists carried_over numeric not null default 0;

create table if not exists public.leave_balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  balance_id uuid not null references public.employee_leave_balances(id) on delete cascade,
  days numeric not null check (days <> 0),
  reason text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.leave_balance_adjustments enable row level security;
drop policy if exists leave_balance_adjustments_read on public.leave_balance_adjustments;
create policy leave_balance_adjustments_read on public.leave_balance_adjustments for select
  using (public.hr_can_manage() and (public.is_super_admin() or business_id = public.current_business_id()));
grant select on public.leave_balance_adjustments to authenticated;

-- A year's entitlement for one employee: the default days, pro-rated by the months left in the
-- year when hired during it (to the nearest half day); none when hired after the year.
create or replace function public.leave_prorated(p_days numeric, p_hire date, p_year int)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_days, 0) <= 0 then 0
    when p_hire is null or p_hire < make_date(p_year, 1, 1) then p_days
    when p_hire > make_date(p_year, 12, 31) then 0
    else round(p_days * (13 - extract(month from p_hire)) / 12 * 2) / 2 end;
$$;

create or replace function public.leave_balance_ensure(p_employee uuid, p_type uuid, p_year int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; e record; t record;
begin
  select id into v_id from public.employee_leave_balances where employee_id = p_employee and leave_type_id = p_type and leave_year = p_year;
  if v_id is not null then return v_id; end if;
  select * into e from public.employees where id = p_employee;
  select * into t from public.leave_types where id = p_type;
  if e.id is null or t.id is null then raise exception 'Employee or leave type not found.'; end if;
  if not (auth.uid() is null or public.is_super_admin() or e.business_id = public.current_business_id()) then
    raise exception 'Employee not found.';
  end if;
  insert into public.employee_leave_balances(business_id, employee_id, leave_type_id, leave_year, entitlement, used, adjustment)
  values (e.business_id, e.id, t.id, p_year, public.leave_prorated(t.default_days_per_year, e.hire_date, p_year), 0, 0)
  on conflict (employee_id, leave_type_id, leave_year) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.employee_leave_balances where employee_id = p_employee and leave_type_id = p_type and leave_year = p_year;
  end if;
  return v_id;
end $$;
revoke all on function public.leave_balance_ensure(uuid, uuid, int) from public;
grant execute on function public.leave_balance_ensure(uuid, uuid, int) to authenticated;

-- Grant the year's leave to every current employee of the store, per active leave type with
-- default days. Re-running updates the entitlement (and the carry-over when asked) and never
-- touches days used or adjustments.
create or replace function public.leave_grant_year(p_year int, p_carry boolean default false, p_carry_max numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); e record; t record; v_prev numeric; v_rows int := 0; v_emps int := 0;
begin
  if not public.hr_can_manage() then raise exception 'Admin access required.'; end if;
  if v_b is null then raise exception 'Select a store in "Acting as" first.'; end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Choose the leave year.'; end if;
  if p_carry_max is not null and p_carry_max < 0 then raise exception 'The carry-over limit cannot be negative.'; end if;
  for e in select * from public.employees where business_id = v_b
            and employment_status not in ('separated', 'inactive')
            and (hire_date is null or hire_date <= make_date(p_year, 12, 31)) loop
    v_emps := v_emps + 1;
    for t in select * from public.leave_types where active and coalesce(default_days_per_year, 0) > 0 loop
      v_prev := null;
      if p_carry then
        select greatest(entitlement + carried_over + adjustment - used, 0) into v_prev
          from public.employee_leave_balances where employee_id = e.id and leave_type_id = t.id and leave_year = p_year - 1;
        v_prev := coalesce(v_prev, 0);
        if p_carry_max is not null then v_prev := least(v_prev, p_carry_max); end if;
      end if;
      insert into public.employee_leave_balances(business_id, employee_id, leave_type_id, leave_year, entitlement, carried_over, used, adjustment)
      values (v_b, e.id, t.id, p_year, public.leave_prorated(t.default_days_per_year, e.hire_date, p_year), coalesce(v_prev, 0), 0, 0)
      on conflict (employee_id, leave_type_id, leave_year) do update
        set entitlement = excluded.entitlement,
            carried_over = case when p_carry then excluded.carried_over else public.employee_leave_balances.carried_over end,
            updated_at = now();
      v_rows := v_rows + 1;
    end loop;
  end loop;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'employee_leave_balances', v_b, 'leave_granted',
          jsonb_build_object('year', p_year, 'employees', v_emps, 'balances', v_rows, 'carry_over', p_carry, 'carry_max', p_carry_max));
  return jsonb_build_object('employees', v_emps, 'balances', v_rows);
end $$;
revoke all on function public.leave_grant_year(int, boolean, numeric) from public;
grant execute on function public.leave_grant_year(int, boolean, numeric) to authenticated;

create or replace function public.leave_adjust(p_employee uuid, p_type uuid, p_year int, p_days numeric, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_id uuid; b record;
begin
  if not public.hr_can_manage() then raise exception 'Admin access required.'; end if;
  if coalesce(p_days, 0) = 0 then raise exception 'Enter the days to add (or a minus number to take away).'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the balance is adjusted.'; end if;
  v_id := public.leave_balance_ensure(p_employee, p_type, p_year);
  select * into b from public.employee_leave_balances where id = v_id for update;
  if not (public.is_super_admin() or b.business_id = public.current_business_id()) then raise exception 'Employee not found.'; end if;
  if b.entitlement + b.carried_over + b.adjustment + p_days - b.used < 0 then
    raise exception 'That would leave % days, below zero.', b.entitlement + b.carried_over + b.adjustment + p_days - b.used;
  end if;
  update public.employee_leave_balances set adjustment = adjustment + p_days, updated_at = now() where id = v_id;
  insert into public.leave_balance_adjustments(business_id, balance_id, days, reason, created_by) values (b.business_id, v_id, p_days, btrim(p_reason), auth.uid());
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'employee_leave_balances', v_id, 'leave_adjusted', jsonb_build_object('days', p_days, 'reason', btrim(p_reason)));
  return b.entitlement + b.carried_over + b.adjustment + p_days - b.used;
end $$;
revoke all on function public.leave_adjust(uuid, uuid, int, numeric, text) from public;
grant execute on function public.leave_adjust(uuid, uuid, int, numeric, text) to authenticated;

-- New employees get this year's defaults straight away.
create or replace function public.employees_grant_leave()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record; v_year int := extract(year from (now() at time zone 'Asia/Manila'))::int;
begin
  if new.employment_status in ('separated', 'inactive') then return null; end if;
  for t in select id from public.leave_types where active and coalesce(default_days_per_year, 0) > 0 loop
    perform public.leave_balance_ensure(new.id, t.id, v_year);
  end loop;
  return null;
end $$;
drop trigger if exists employees_grant_leave on public.employees;
create trigger employees_grant_leave after insert on public.employees for each row execute function public.employees_grant_leave();

-- ------------------------------------------------ 5. allowances (UIA-45) --
update public.expense_allowances set active = false, updated_at = now() where agent_id is not null and active;
create or replace function public.expense_allowances_employees_only()
returns trigger language plpgsql as $$
begin
  if new.agent_id is not null and new.active then
    raise exception 'Allowances are for employees only; agents are not given allowances.';
  end if;
  return new;
end $$;
drop trigger if exists expense_allowances_employees_only on public.expense_allowances;
create trigger expense_allowances_employees_only before insert or update on public.expense_allowances
  for each row execute function public.expense_allowances_employees_only();

-- ------------------------------------ 6. recurring monthly expenses (UIA-25) --
alter table public.expenses add column if not exists recurring_monthly boolean not null default false;
alter table public.expenses add column if not exists recurring_months int;
alter table public.expenses add column if not exists recurring_series_id uuid;
alter table public.expenses drop constraint if exists expenses_recurring_check;
alter table public.expenses add constraint expenses_recurring_check check (
  (not recurring_monthly and recurring_months is null)
  or (recurring_monthly and not is_yearly and (recurring_months is null or recurring_months between 2 and 60)));

create table if not exists public.expense_recurring_series (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  section_id uuid not null references public.sections(id),
  source_expense_id uuid not null unique references public.expenses(id),
  amount numeric(14,2) not null,
  day_of_month int not null check (day_of_month between 1 and 31),
  start_month date not null,
  months int,
  created_count int not null default 1,
  status text not null default 'active' check (status in ('active', 'stopped', 'finished')),
  stopped_by uuid references public.users(id),
  stopped_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now()
);
alter table public.expenses drop constraint if exists expenses_recurring_series_fk;
alter table public.expenses add constraint expenses_recurring_series_fk foreign key (recurring_series_id) references public.expense_recurring_series(id);
alter table public.expense_recurring_series enable row level security;
drop policy if exists expense_recurring_series_read on public.expense_recurring_series;
create policy expense_recurring_series_read on public.expense_recurring_series for select
  using (public.is_super_admin() or business_id = public.current_business_id());
grant select on public.expense_recurring_series to authenticated;

-- The approved first month opens the series.
create or replace function public.expenses_recurring_open()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.status::text = 'approved' and old.status::text is distinct from 'approved'
     and new.recurring_monthly and new.recurring_series_id is null then
    insert into public.expense_recurring_series(business_id, section_id, source_expense_id, amount, day_of_month, start_month, months)
    values (new.business_id, new.section_id, new.id, new.amount, extract(day from coalesce(new.expense_date, now()::date))::int,
            date_trunc('month', coalesce(new.expense_date, now()::date))::date, new.recurring_months)
    on conflict (source_expense_id) do nothing
    returning id into v_id;
    if v_id is not null then
      update public.expenses set recurring_series_id = v_id where id = new.id;
      if new.recurring_months is not null and new.recurring_months <= 1 then
        update public.expense_recurring_series set status = 'finished' where id = v_id;
      end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists expenses_recurring_open on public.expenses;
create trigger expenses_recurring_open after update of status on public.expenses
  for each row execute function public.expenses_recurring_open();

-- Creates the months that have arrived (up to today, Manila) for the store's active series, each
-- as an approved expense for Finance to post and pay. Safe to call often; nothing is created twice.
create or replace function public.expense_recurring_run(p_business uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_b uuid := coalesce(p_business, public.current_business_id()); s record; src record; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_month date; v_date date; v_month_id uuid; v_made int := 0; v_k int; v_label text;
begin
  if v_b is null then return 0; end if;
  if auth.uid() is not null and not (public.is_super_admin() or v_b = public.current_business_id()) then return 0; end if;
  for s in select * from public.expense_recurring_series where business_id = v_b and status = 'active' for update skip locked loop
    select * into src from public.expenses where id = s.source_expense_id;
    loop
      exit when s.months is not null and s.created_count >= s.months;
      v_k := s.created_count + 1;
      v_month := (s.start_month + make_interval(months => s.created_count))::date;
      v_date := least(v_month + (s.day_of_month - 1), (v_month + interval '1 month - 1 day')::date);
      exit when v_date > v_today;
      select id into v_month_id from public.months where business_id = v_b and year = extract(year from v_month) and month = extract(month from v_month);
      if v_month_id is null then
        insert into public.months(business_id, year, month, label, is_closed)
        values (v_b, extract(year from v_month), extract(month from v_month), to_char(v_month, 'FMMonth YYYY'), false)
        on conflict (business_id, year, month) do nothing returning id into v_month_id;
        if v_month_id is null then
          select id into v_month_id from public.months where business_id = v_b and year = extract(year from v_month) and month = extract(month from v_month);
        end if;
      end if;
      v_label := case when s.months is null then 'month ' || v_k else 'month ' || v_k || ' of ' || s.months end;
      if exists (select 1 from public.months where id = v_month_id and is_closed) then
        insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
        values (null, 'expense_recurring_series', s.id, 'recurring_month_skipped', jsonb_build_object('month', v_month, 'reason', 'accounting period closed'));
      else
        insert into public.expenses(business_id, section_id, month_id, status, description, amount, expense_date,
                                    category_id, suggested_category, vendor, supplier_id, payment_method, cost_center_id, asset_id, fleet_vehicle_id,
                                    notes, prepared_by, prepared_at, reviewed_by, reviewed_at, approved_by, approved_at,
                                    recurring_monthly, recurring_months, recurring_series_id)
        values (v_b, src.section_id, v_month_id, 'approved', src.description, s.amount, v_date,
                src.category_id, src.suggested_category, src.vendor, src.supplier_id, src.payment_method, src.cost_center_id, src.asset_id, src.fleet_vehicle_id,
                'Recurring monthly expense, ' || v_label || (case when src.notes is not null then ' — ' || src.notes else '' end),
                src.prepared_by, src.prepared_at, src.reviewed_by, src.reviewed_at, src.approved_by, src.approved_at,
                true, src.recurring_months, s.id);
        v_made := v_made + 1;
      end if;
      update public.expense_recurring_series set created_count = created_count + 1 where id = s.id;
      s.created_count := s.created_count + 1;
    end loop;
    if s.months is not null and s.created_count >= s.months then
      update public.expense_recurring_series set status = 'finished' where id = s.id;
    end if;
  end loop;
  return v_made;
end $$;
revoke all on function public.expense_recurring_run(uuid) from public;
grant execute on function public.expense_recurring_run(uuid) to authenticated;

-- Stop: the department's approver (or the Business Admin); months already created stay.
create or replace function public.expense_recurring_stop(p_series uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public.expense_recurring_series where id = p_series for update;
  if not found or not (public.is_super_admin() or s.business_id = public.current_business_id()) then raise exception 'Recurring expense not found.'; end if;
  if not (public.is_super_admin() or public.is_business_admin() or public.has_workflow_role(s.section_id, 'approver')
          or exists (select 1 from public.expenses where id = s.source_expense_id and prepared_by = auth.uid())) then
    raise exception 'Only the department''s approver, the preparer or the Business Admin can stop it.';
  end if;
  if s.status <> 'active' then raise exception 'This recurring expense is no longer running.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why it stops.'; end if;
  update public.expense_recurring_series set status = 'stopped', stopped_by = auth.uid(), stopped_at = now(), stop_reason = btrim(p_reason) where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'expense_recurring_series', s.id, 'recurring_stopped', jsonb_build_object('reason', btrim(p_reason), 'months_created', s.created_count));
end $$;
revoke all on function public.expense_recurring_stop(uuid, text) from public;
grant execute on function public.expense_recurring_stop(uuid, text) to authenticated;

-- Attendance periods for Finance's payroll period picker (Finance has no access to timekeeping).
create or replace function public.attendance_periods_for_payroll()
returns table(id uuid, name text, start_date date, end_date date, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.start_date, p.end_date, p.status from public.attendance_periods p
   where p.business_id = public.current_business_id() order by p.start_date desc limit 48;
$$;
revoke all on function public.attendance_periods_for_payroll() from public;
grant execute on function public.attendance_periods_for_payroll() to authenticated;
