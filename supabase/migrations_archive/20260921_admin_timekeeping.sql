-- IBX Admin Timekeeping / Attendance foundation

do $$ begin
  create type attendance_status as enum ('present','absent','late','undertime','half_day','leave','holiday','rest_day','official_business','work_from_home','incomplete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attendance_correction_status as enum ('draft','prepared','reviewed','approved','rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  timezone text not null default 'Asia/Manila',
  monday_in time, monday_out time, monday_break_start time, monday_break_end time,
  tuesday_in time, tuesday_out time, tuesday_break_start time, tuesday_break_end time,
  wednesday_in time, wednesday_out time, wednesday_break_start time, wednesday_break_end time,
  thursday_in time, thursday_out time, thursday_break_start time, thursday_break_end time,
  friday_in time, friday_out time, friday_break_start time, friday_break_end time,
  saturday_in time, saturday_out time, saturday_break_start time, saturday_break_end time,
  sunday_in time, sunday_out time, sunday_break_start time, sunday_break_end time,
  grace_minutes int not null default 0 check (grace_minutes between 0 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  schedule_id uuid not null references public.work_schedules(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  constraint schedule_assignment_dates check (effective_to is null or effective_to >= effective_from)
);
create index if not exists employee_schedule_lookup_idx on public.employee_schedule_assignments(employee_id, effective_from, effective_to);

create table if not exists public.attendance_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','review','locked')),
  locked_at timestamptz,
  locked_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint attendance_period_dates check (end_date >= start_date),
  unique(start_date, end_date)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  attendance_date date not null,
  schedule_id uuid references public.work_schedules(id) on delete set null,
  time_in timestamptz,
  break_out timestamptz,
  break_in timestamptz,
  time_out timestamptz,
  regular_hours numeric(6,2) not null default 0,
  overtime_hours numeric(6,2) not null default 0,
  late_minutes int not null default 0,
  undertime_minutes int not null default 0,
  status attendance_status not null default 'present',
  notes text,
  period_id uuid references public.attendance_periods(id) on delete set null,
  prepared_by uuid references public.users(id),
  reviewed_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, attendance_date)
);
create index if not exists attendance_employee_date_idx on public.attendance_records(employee_id, attendance_date desc);
create index if not exists attendance_period_idx on public.attendance_records(period_id, status);

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  reason text not null,
  requested_time_in timestamptz,
  requested_break_out timestamptz,
  requested_break_in timestamptz,
  requested_time_out timestamptz,
  requested_status attendance_status,
  status attendance_correction_status not null default 'prepared',
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_corrections_status_idx on public.attendance_corrections(status, created_at desc);

create or replace function public.set_timekeeping_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists work_schedules_set_updated_at on public.work_schedules;
create trigger work_schedules_set_updated_at before update on public.work_schedules for each row execute function public.set_timekeeping_updated_at();
drop trigger if exists attendance_records_set_updated_at on public.attendance_records;
create trigger attendance_records_set_updated_at before update on public.attendance_records for each row execute function public.set_timekeeping_updated_at();

alter table public.work_schedules enable row level security;
alter table public.employee_schedule_assignments enable row level security;
alter table public.attendance_periods enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_corrections enable row level security;

create policy work_schedules_admin_all on public.work_schedules for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy schedule_assignments_admin_all on public.employee_schedule_assignments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy attendance_periods_admin_all on public.attendance_periods for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy attendance_records_admin_all on public.attendance_records for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy attendance_corrections_admin_all on public.attendance_corrections for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

-- Employees may view/request corrections for their own linked attendance. The app uses
-- server-side authorization as the authoritative gate for self-service operations.
create policy attendance_self_select on public.attendance_records for select using (exists(select 1 from public.employees e where e.id=employee_id and e.user_id=auth.uid()));
create policy corrections_self_select on public.attendance_corrections for select using (requested_by=auth.uid());
create policy corrections_self_insert on public.attendance_corrections for insert with check (requested_by=auth.uid());

insert into public.work_schedules (name, timezone, monday_in, monday_out, monday_break_start, monday_break_end, tuesday_in, tuesday_out, tuesday_break_start, tuesday_break_end, wednesday_in, wednesday_out, wednesday_break_start, wednesday_break_end, thursday_in, thursday_out, thursday_break_start, thursday_break_end, friday_in, friday_out, friday_break_start, friday_break_end, grace_minutes)
values ('Standard 8-5', 'Asia/Manila', '08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00',10)
on conflict (name) do nothing;
