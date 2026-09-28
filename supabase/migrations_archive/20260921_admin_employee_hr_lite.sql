-- IBX Admin / HR-lite employee foundation
-- Depends on the base schema and user-management foundation.

do $$ begin
  create type employee_status as enum ('active','probationary','on_leave','inactive','separated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_type as enum ('regular','probationary','contractual','part_time','project_based','intern');
exception when duplicate_object then null; end $$;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_no text unique not null,
  user_id uuid unique references public.users(id) on delete set null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  preferred_name text,
  department text,
  position_title text,
  employment_type employment_type not null default 'regular',
  employment_status employee_status not null default 'active',
  hire_date date,
  separation_date date,
  work_email text,
  personal_email text,
  phone text,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_dates_check check (
    separation_date is null or hire_date is null or separation_date >= hire_date
  )
);

create index if not exists employees_status_idx on public.employees (employment_status);
create index if not exists employees_department_idx on public.employees (department);
create index if not exists employees_user_id_idx on public.employees (user_id);

alter table public.employees enable row level security;

create policy employees_select_admin_or_super on public.employees
  for select using (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

create policy employees_insert_admin_or_super on public.employees
  for insert with check (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

create policy employees_update_admin_or_super on public.employees
  for update using (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')))
  with check (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

create policy employees_delete_super_only on public.employees
  for delete using (public.is_super_admin());

create or replace function public.set_employees_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
before update on public.employees
for each row execute function public.set_employees_updated_at();

-- Keep employee identity available to other modules without making employee rows
-- dependent on auth accounts. Historical employee records survive user deletion.
create index if not exists employees_name_idx
  on public.employees (last_name, first_name);
