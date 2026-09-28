-- IBX Admin Leave Management
create type public.leave_request_status as enum ('prepared','reviewed','approved','rejected','cancelled');
create type public.leave_day_type as enum ('full_day','first_half','second_half');

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  paid boolean not null default true,
  requires_approval boolean not null default true,
  active boolean not null default true,
  default_days_per_year numeric(6,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  leave_year int not null,
  entitlement numeric(6,2) not null default 0,
  used numeric(6,2) not null default 0,
  adjustment numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, leave_type_id, leave_year)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  day_type public.leave_day_type not null default 'full_day',
  days numeric(6,2) not null,
  reason text not null,
  status public.leave_request_status not null default 'prepared',
  requested_by uuid not null references public.users(id),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_request_dates check (end_date >= start_date),
  constraint leave_request_days_positive check (days > 0)
);

create index if not exists leave_requests_employee_dates_idx on public.leave_requests(employee_id, start_date desc, end_date desc);
create index if not exists leave_requests_status_idx on public.leave_requests(status, start_date desc);
create index if not exists leave_balances_employee_year_idx on public.employee_leave_balances(employee_id, leave_year);

create or replace function public.set_leave_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists leave_types_set_updated_at on public.leave_types;
create trigger leave_types_set_updated_at before update on public.leave_types for each row execute function public.set_leave_updated_at();
drop trigger if exists leave_balances_set_updated_at on public.employee_leave_balances;
create trigger leave_balances_set_updated_at before update on public.employee_leave_balances for each row execute function public.set_leave_updated_at();
drop trigger if exists leave_requests_set_updated_at on public.leave_requests;
create trigger leave_requests_set_updated_at before update on public.leave_requests for each row execute function public.set_leave_updated_at();

alter table public.leave_types enable row level security;
alter table public.employee_leave_balances enable row level security;
alter table public.leave_requests enable row level security;

create policy leave_types_admin_all on public.leave_types for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy leave_balances_admin_all on public.employee_leave_balances for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy leave_requests_admin_all on public.leave_requests for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy leave_requests_self_select on public.leave_requests for select using (exists(select 1 from public.employees e where e.id=employee_id and e.user_id=auth.uid()) or requested_by=auth.uid());
create policy leave_requests_self_insert on public.leave_requests for insert with check (requested_by=auth.uid() and exists(select 1 from public.employees e where e.id=employee_id and e.user_id=auth.uid()));

insert into public.leave_types(code,name,description,paid,requires_approval,default_days_per_year)
values
 ('vacation','Vacation Leave','Planned personal leave.',true,true,15),
 ('sick','Sick Leave','Leave for illness or medical needs.',true,true,15),
 ('emergency','Emergency Leave','Urgent unforeseen personal matters.',true,true,5),
 ('unpaid','Unpaid Leave','Approved leave without pay.',false,true,null)
on conflict(code) do nothing;
