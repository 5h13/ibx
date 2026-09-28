-- Schema-drift fix: the Employee Profile pages (app/profile/page.tsx,
-- app/admin/employees/[id]/page.tsx) have shipped since Group 2 assuming
-- three master tables and three FK columns on `employees` that Group 1
-- documented but never actually migrated:
--   employees.department_id  -> hr_departments(id)
--   employees.position_id    -> hr_positions(id)
--   employees.work_location_id -> work_locations(id)
-- Without them, PostgREST cannot resolve the embedded selects
-- ("department_master:hr_departments(id,name)" etc.), which is the cause of
-- the runtime error: "Could not find a relationship between 'employees' and
-- 'hr_departments' in the schema cache".
--
-- This migration builds exactly the structure the frontend already expects
-- and nothing more, additive-only. The legacy free-text `department` /
-- `position_title` columns on `employees` are left untouched — the frontend
-- already falls back to them when no master is assigned.
--
-- These three are kept GLOBAL, not business-scoped, per the "locked
-- architecture" A001 already committed to (see
-- 20261012_a001_multi_business_foundation.sql section 5): taxonomy/master
-- data referenced by business-scoped records — sections, leave_types,
-- employee_document_types, asset_categories, finance_catalog_categories,
-- finance_suppliers, etc. — stays global even though the records that
-- reference it (employees included) are business-scoped. Department/
-- position/work-location naming is the same shape of thing, so it follows
-- the same rule rather than introducing a one-off exception.

create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employees add column if not exists department_id uuid references public.hr_departments(id) on delete set null;
alter table public.employees add column if not exists position_id uuid references public.hr_positions(id) on delete set null;
alter table public.employees add column if not exists work_location_id uuid references public.work_locations(id) on delete set null;

create index if not exists idx_employees_department_id on public.employees(department_id);
create index if not exists idx_employees_position_id on public.employees(position_id);
create index if not exists idx_employees_work_location_id on public.employees(work_location_id);

-- RLS mirrors `sections` exactly: everyone authenticated can read (needed
-- for display/dropdowns), admin-tier (Global Super Admin, Business Super
-- Admin, or the Admin section) manages the master data.
alter table public.hr_departments enable row level security;
alter table public.hr_positions enable row level security;
alter table public.work_locations enable row level security;

drop policy if exists hr_departments_select on public.hr_departments;
create policy hr_departments_select on public.hr_departments
  for select using (auth.role() = 'authenticated');
drop policy if exists hr_departments_admin_write on public.hr_departments;
create policy hr_departments_admin_write on public.hr_departments
  for all using (public.is_super_admin() or public.is_business_admin() or public.has_section_access('admin'))
  with check (public.is_super_admin() or public.is_business_admin() or public.has_section_access('admin'));

drop policy if exists hr_positions_select on public.hr_positions;
create policy hr_positions_select on public.hr_positions
  for select using (auth.role() = 'authenticated');
drop policy if exists hr_positions_admin_write on public.hr_positions;
create policy hr_positions_admin_write on public.hr_positions
  for all using (public.is_super_admin() or public.is_business_admin() or public.has_section_access('admin'))
  with check (public.is_super_admin() or public.is_business_admin() or public.has_section_access('admin'));

drop policy if exists work_locations_select on public.work_locations;
create policy work_locations_select on public.work_locations
  for select using (auth.role() = 'authenticated');
drop policy if exists work_locations_admin_write on public.work_locations;
create policy work_locations_admin_write on public.work_locations
  for all using (public.is_super_admin() or public.is_business_admin() or public.has_section_access('admin'))
  with check (public.is_super_admin() or public.is_business_admin() or public.has_section_access('admin'));
