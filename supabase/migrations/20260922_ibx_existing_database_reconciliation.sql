-- IBX existing-database reconciliation baseline
--
-- Purpose:
--   Bring the existing IBX Supabase database forward to the current
--   cumulative application schema without dropping/recreating the existing
--   foundation tables or their data.
--
-- Preconditions:
--   Existing public foundation tables must already exist:
--     users, sections, user_access, audit_log, expenses,
--     financial_summary, months, sales_data
--
-- IMPORTANT:
--   This migration intentionally does NOT recreate those foundation tables.
--   The source module migrations are embedded below in dependency order.
--
-- After this baseline is applied, future schema changes should be added as
-- normal new migrations. The original 27 source migrations are retained in
-- the repository archive, outside supabase/migrations, so Supabase records
-- this baseline as one migration rather than attempting to replay the old
-- files against the existing database.

DO $$
DECLARE
  required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'users',
    'sections',
    'user_access',
    'audit_log',
    'expenses',
    'financial_summary',
    'months',
    'sales_data'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION
        'IBX reconciliation aborted: required existing table public.% is missing.',
        required_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION
      'IBX reconciliation aborted: public.is_super_admin() is missing.';
  END IF;

  IF to_regprocedure('public.in_section(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'IBX reconciliation aborted: public.in_section(uuid) is missing.';
  END IF;
END $$;

-- Compatibility helper required by the cumulative Finance RLS policies.
-- The existing database provides public.in_section(uuid), but the current
-- Finance migrations use a section-code helper. Define it here before any
-- policies reference it.
create or replace function public.has_section_access(p_section_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_access ua
    join public.sections s on s.id = ua.section_id
    join public.users u on u.id = ua.user_id
    where ua.user_id = auth.uid()
      and u.is_active = true
      and lower(s.code) = lower(p_section_code)
  );
$$;

grant execute on function public.has_section_access(text) to authenticated;

-- ============================================================================
-- 01 USER / EMPLOYEE FOUNDATION
-- ============================================================================

-- 01a. User-management foundation: indexes only; existing users/access tables
-- are deliberately preserved.
-- SOURCE: 20260921_user_management_foundation.sql
create index if not exists user_access_user_section_idx
  on public.user_access (user_id, section_id);
create index if not exists users_active_role_idx
  on public.users (role, is_active);

-- 01b. Employee master
-- SOURCE: 20260921_admin_employee_hr_lite.sql
-- IBX Admin / HR-lite employee foundation
-- Depends on the base schema and user-management foundation.

do $$ begin
  create type employee_status as enum ('active','probationary','on_leave','inactive','separated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_type as enum ('regular','probationary','contractual','part_time','project_based','intern');
exception when duplicate_object then null; end $$;

create table if not exists public.employees (
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

drop policy if exists employees_select_admin_or_super on public.employees;
create policy employees_select_admin_or_super on public.employees
  for select using (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

drop policy if exists employees_insert_admin_or_super on public.employees;
create policy employees_insert_admin_or_super on public.employees
  for insert with check (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

drop policy if exists employees_update_admin_or_super on public.employees;
create policy employees_update_admin_or_super on public.employees
  for update using (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')))
  with check (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

drop policy if exists employees_delete_super_only on public.employees;
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
create or replace trigger employees_set_updated_at
before update on public.employees
for each row execute function public.set_employees_updated_at();

-- Keep employee identity available to other modules without making employee rows
-- dependent on auth accounts. Historical employee records survive user deletion.
create index if not exists employees_name_idx
  on public.employees (last_name, first_name);

-- ============================================================================
-- 02 ADMIN FOUNDATIONS
-- ============================================================================

-- SOURCE: 20260921_admin_assets_equipment.sql
-- IBX Admin Assets & Equipment foundation

do $$ begin
  create type public.asset_status as enum ('available','assigned','maintenance','retired','disposed','lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.asset_condition as enum ('new','good','fair','needs_repair','damaged');
exception when duplicate_object then null; end $$;

create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_no text not null unique,
  category_id uuid not null references public.asset_categories(id) on delete restrict,
  name text not null,
  description text,
  serial_number text unique,
  manufacturer text,
  model text,
  purchase_date date,
  purchase_cost numeric(14,2),
  supplier text,
  warranty_until date,
  location text,
  condition public.asset_condition not null default 'new',
  status public.asset_status not null default 'available',
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_purchase_cost_check check (purchase_cost is null or purchase_cost >= 0),
  constraint asset_warranty_check check (warranty_until is null or purchase_date is null or warranty_until >= purchase_date)
);

create table if not exists public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  issued_condition public.asset_condition not null default 'good',
  returned_condition public.asset_condition,
  expected_return_date date,
  assignment_notes text,
  assigned_by uuid not null references public.users(id),
  returned_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint asset_assignment_dates check (returned_at is null or returned_at >= assigned_at)
);

create unique index if not exists asset_one_active_assignment_idx
  on public.asset_assignments(asset_id) where returned_at is null;
create index if not exists assets_category_status_idx on public.assets(category_id, status);
create index if not exists assets_name_idx on public.assets(name);
create index if not exists asset_assignments_employee_idx on public.asset_assignments(employee_id, returned_at);
create index if not exists asset_assignments_asset_idx on public.asset_assignments(asset_id, returned_at);

create or replace function public.set_assets_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists asset_categories_set_updated_at on public.asset_categories;
create or replace trigger asset_categories_set_updated_at before update on public.asset_categories for each row execute function public.set_assets_updated_at();
drop trigger if exists assets_set_updated_at on public.assets;
create or replace trigger assets_set_updated_at before update on public.assets for each row execute function public.set_assets_updated_at();

alter table public.asset_categories enable row level security;
alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;

drop policy if exists asset_categories_admin_all on public.asset_categories;
create policy asset_categories_admin_all on public.asset_categories for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists assets_admin_all on public.assets;
create policy assets_admin_all on public.assets for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists asset_assignments_admin_all on public.asset_assignments;
create policy asset_assignments_admin_all on public.asset_assignments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

insert into public.asset_categories(code,name,description) values
 ('computers','Computers','Desktop computers, laptops, monitors and related equipment.'),
 ('mobile_devices','Mobile Devices','Phones, tablets and mobile communication devices.'),
 ('office_equipment','Office Equipment','Printers, scanners, projectors and other office equipment.'),
 ('furniture','Furniture','Desks, chairs, cabinets and other office furniture.'),
 ('tools','Tools','Operational tools and reusable equipment.'),
 ('vehicles','Vehicles','Company vehicles and other fleet assets.'),
 ('other','Other','Other company-owned assets and equipment.')
on conflict(code) do nothing;

-- SOURCE: 20260921_admin_fleet_management.sql
-- IBX Admin Fleet Management foundation

do $$ begin
  create type public.fleet_vehicle_status as enum ('available','assigned','in_use','maintenance','out_of_service','retired','disposed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fleet_vehicle_condition as enum ('new','good','fair','needs_repair','damaged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fleet_trip_status as enum ('planned','started','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fleet_expense_type as enum ('fuel','toll','parking','maintenance','repair','registration','insurance','other');
exception when duplicate_object then null; end $$;

create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null unique,
  plate_no text unique,
  vehicle_type text not null,
  make text,
  model text,
  year integer check (year is null or year between 1900 and 2200),
  color text,
  vin text unique,
  engine_no text unique,
  purchase_date date,
  purchase_cost numeric(14,2) check (purchase_cost is null or purchase_cost >= 0),
  supplier text,
  registration_expiry date,
  insurance_expiry date,
  odometer numeric(14,1) not null default 0 check (odometer >= 0),
  capacity text,
  location text,
  condition public.fleet_vehicle_condition not null default 'good',
  status public.fleet_vehicle_status not null default 'available',
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_drivers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete restrict,
  license_no text,
  license_expiry date,
  license_type text,
  authorized boolean not null default true,
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  purpose text,
  location text,
  notes text,
  assigned_by uuid not null references public.users(id),
  returned_by uuid references public.users(id),
  constraint fleet_assignment_dates check (returned_at is null or returned_at >= assigned_at)
);
create unique index if not exists fleet_one_active_assignment_idx on public.fleet_assignments(vehicle_id) where returned_at is null;

create table if not exists public.fleet_trips (
  id uuid primary key default gen_random_uuid(),
  trip_no text not null unique,
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  driver_employee_id uuid references public.employees(id) on delete restrict,
  trip_date date not null default current_date,
  departure_at timestamptz,
  return_at timestamptz,
  origin text,
  destination text,
  purpose text,
  starting_odometer numeric(14,1) check (starting_odometer is null or starting_odometer >= 0),
  ending_odometer numeric(14,1) check (ending_odometer is null or ending_odometer >= 0),
  status public.fleet_trip_status not null default 'planned',
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fleet_trip_odo_check check (ending_odometer is null or starting_odometer is null or ending_odometer >= starting_odometer)
);

create table if not exists public.fleet_expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  trip_id uuid references public.fleet_trips(id) on delete set null,
  expense_date date not null default current_date,
  expense_type public.fleet_expense_type not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  vendor text,
  receipt_reference text,
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.fleet_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  service_date date not null default current_date,
  service_type text not null,
  description text not null,
  odometer numeric(14,1) check (odometer is null or odometer >= 0),
  vendor text,
  cost numeric(14,2) check (cost is null or cost >= 0),
  next_service_date date,
  next_service_odometer numeric(14,1) check (next_service_odometer is null or next_service_odometer >= 0),
  status text not null default 'completed',
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists fleet_vehicles_status_idx on public.fleet_vehicles(status, vehicle_type);
create index if not exists fleet_assignments_employee_idx on public.fleet_assignments(employee_id, returned_at);
create index if not exists fleet_trips_date_idx on public.fleet_trips(trip_date desc, status);
create index if not exists fleet_expenses_vehicle_idx on public.fleet_expenses(vehicle_id, expense_date desc);
create index if not exists fleet_maintenance_vehicle_idx on public.fleet_maintenance(vehicle_id, service_date desc);

create or replace function public.set_fleet_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists fleet_vehicles_updated_at on public.fleet_vehicles;
create or replace trigger fleet_vehicles_updated_at before update on public.fleet_vehicles for each row execute function public.set_fleet_updated_at();
drop trigger if exists fleet_drivers_updated_at on public.fleet_drivers;
create or replace trigger fleet_drivers_updated_at before update on public.fleet_drivers for each row execute function public.set_fleet_updated_at();
drop trigger if exists fleet_trips_updated_at on public.fleet_trips;
create or replace trigger fleet_trips_updated_at before update on public.fleet_trips for each row execute function public.set_fleet_updated_at();

alter table public.fleet_vehicles enable row level security;
alter table public.fleet_drivers enable row level security;
alter table public.fleet_assignments enable row level security;
alter table public.fleet_trips enable row level security;
alter table public.fleet_expenses enable row level security;
alter table public.fleet_maintenance enable row level security;

drop policy if exists fleet_vehicles_admin_all on public.fleet_vehicles;
create policy fleet_vehicles_admin_all on public.fleet_vehicles for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists fleet_drivers_admin_all on public.fleet_drivers;
create policy fleet_drivers_admin_all on public.fleet_drivers for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists fleet_assignments_admin_all on public.fleet_assignments;
create policy fleet_assignments_admin_all on public.fleet_assignments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists fleet_trips_admin_all on public.fleet_trips;
create policy fleet_trips_admin_all on public.fleet_trips for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists fleet_expenses_admin_all on public.fleet_expenses;
create policy fleet_expenses_admin_all on public.fleet_expenses for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists fleet_maintenance_admin_all on public.fleet_maintenance;
create policy fleet_maintenance_admin_all on public.fleet_maintenance for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

-- SOURCE: 20260921_admin_supplies_requests.sql
-- IBX Admin Office Supplies & Internal Requests

do $$ begin
  create type public.supply_transaction_type as enum ('receive','issue','adjust_in','adjust_out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_priority as enum ('low','normal','high','urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.internal_request_status as enum ('draft','prepared','reviewed','approved','rejected','fulfilled','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.supply_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  name text not null,
  category_id uuid not null references public.supply_categories(id) on delete restrict,
  description text,
  unit text not null default 'piece',
  stock_on_hand numeric(14,3) not null default 0 check (stock_on_hand >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  location text,
  supplier text,
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  active boolean not null default true,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supply_transactions (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  transaction_type public.supply_transaction_type not null,
  quantity numeric(14,3) not null check (quantity > 0),
  balance_after numeric(14,3) not null check (balance_after >= 0),
  reference_type text,
  reference_id uuid,
  notes text,
  performed_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.internal_request_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.internal_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  category_id uuid references public.internal_request_categories(id) on delete restrict,
  requester_employee_id uuid references public.employees(id) on delete restrict,
  requester_user_id uuid not null references public.users(id),
  department text,
  title text not null,
  description text,
  priority public.request_priority not null default 'normal',
  needed_by date,
  status public.internal_request_status not null default 'draft',
  rejection_reason text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  fulfilled_by uuid references public.users(id),
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_request_needed_by_check check (needed_by is null or needed_by >= created_at::date)
);

create table if not exists public.internal_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.internal_requests(id) on delete cascade,
  supply_id uuid references public.supplies(id) on delete restrict,
  item_description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'piece',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists supplies_category_active_idx on public.supplies(category_id, active);
create index if not exists supplies_name_idx on public.supplies(name);
create index if not exists supply_transactions_supply_idx on public.supply_transactions(supply_id, created_at desc);
create index if not exists internal_requests_status_idx on public.internal_requests(status, created_at desc);
create index if not exists internal_requests_requester_idx on public.internal_requests(requester_user_id, status);
create index if not exists internal_request_items_request_idx on public.internal_request_items(request_id);

create or replace function public.set_admin_supplies_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists supply_categories_set_updated_at on public.supply_categories;
create or replace trigger supply_categories_set_updated_at before update on public.supply_categories for each row execute function public.set_admin_supplies_updated_at();
drop trigger if exists supplies_set_updated_at on public.supplies;
create or replace trigger supplies_set_updated_at before update on public.supplies for each row execute function public.set_admin_supplies_updated_at();
drop trigger if exists internal_requests_set_updated_at on public.internal_requests;
create or replace trigger internal_requests_set_updated_at before update on public.internal_requests for each row execute function public.set_admin_supplies_updated_at();

alter table public.supply_categories enable row level security;
alter table public.supplies enable row level security;
alter table public.supply_transactions enable row level security;
alter table public.internal_request_categories enable row level security;
alter table public.internal_requests enable row level security;
alter table public.internal_request_items enable row level security;

drop policy if exists supply_categories_admin_all on public.supply_categories;
create policy supply_categories_admin_all on public.supply_categories for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists supplies_admin_all on public.supplies;
create policy supplies_admin_all on public.supplies for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists supply_transactions_admin_all on public.supply_transactions;
create policy supply_transactions_admin_all on public.supply_transactions for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists internal_request_categories_admin_all on public.internal_request_categories;
create policy internal_request_categories_admin_all on public.internal_request_categories for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists internal_requests_admin_all on public.internal_requests;
create policy internal_requests_admin_all on public.internal_requests for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists internal_request_items_admin_all on public.internal_request_items;
create policy internal_request_items_admin_all on public.internal_request_items for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

insert into public.supply_categories(code,name,description) values
 ('stationery','Stationery','Paper, pens, notebooks and general writing supplies.'),
 ('printing','Printing Supplies','Ink, toner, labels and printing consumables.'),
 ('cleaning','Cleaning Supplies','Cleaning and sanitation supplies.'),
 ('pantry','Pantry Supplies','Office pantry and break-room consumables.'),
 ('it_consumables','IT Consumables','Cables, adapters and other low-value IT consumables.'),
 ('other','Other','Other office consumables.')
on conflict(code) do nothing;

insert into public.internal_request_categories(code,name,description) values
 ('supplies','Office Supplies','Requests for office supplies and consumables.'),
 ('maintenance','Maintenance','Facilities, equipment and repair requests.'),
 ('it','IT Support','IT equipment, access and technical support requests.'),
 ('hr','HR / Employee Services','Employee-related administrative requests.'),
 ('facilities','Facilities','Office space, utilities and facility requests.'),
 ('documents','Documents','Internal documents, certifications and records.'),
 ('other','Other','Other internal requests.')
on conflict(code) do nothing;

-- SOURCE: 20260921_admin_employee_documents.sql
-- IBX Admin Employee Documents & Compliance
do $$ begin
  create type public.employee_document_status as enum ('pending','verified','rejected','expired','archived');
exception when duplicate_object then null; end $$;

create table if not exists public.employee_document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  required_for_active_employee boolean not null default false,
  requires_expiry boolean not null default false,
  default_validity_days int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  document_type_id uuid not null references public.employee_document_types(id) on delete restrict,
  document_name text not null,
  document_number text,
  issued_date date,
  expiry_date date,
  status public.employee_document_status not null default 'pending',
  storage_path text,
  original_file_name text,
  mime_type text,
  file_size bigint,
  notes text,
  uploaded_by uuid not null references public.users(id),
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_document_dates check (expiry_date is null or issued_date is null or expiry_date >= issued_date)
);

create index if not exists employee_documents_employee_idx on public.employee_documents(employee_id, expiry_date);
create index if not exists employee_documents_status_expiry_idx on public.employee_documents(status, expiry_date);
create index if not exists employee_documents_type_idx on public.employee_documents(document_type_id);

create or replace function public.set_employee_document_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists employee_document_types_set_updated_at on public.employee_document_types;
create or replace trigger employee_document_types_set_updated_at before update on public.employee_document_types for each row execute function public.set_employee_document_updated_at();
drop trigger if exists employee_documents_set_updated_at on public.employee_documents;
create or replace trigger employee_documents_set_updated_at before update on public.employee_documents for each row execute function public.set_employee_document_updated_at();

alter table public.employee_document_types enable row level security;
alter table public.employee_documents enable row level security;

drop policy if exists employee_document_types_admin_all on public.employee_document_types;
create policy employee_document_types_admin_all on public.employee_document_types for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists employee_documents_admin_all on public.employee_documents;
create policy employee_documents_admin_all on public.employee_documents for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

insert into public.employee_document_types(code,name,description,required_for_active_employee,requires_expiry,default_validity_days) values
 ('employment_contract','Employment Contract','Signed employment or engagement agreement.',true,false,null),
 ('government_id','Government ID','Government-issued identification document.',true,true,null),
 ('tax_registration','Tax Registration','Tax registration or taxpayer identification record.',false,false,null),
 ('social_security','Social Security','SSS or equivalent social security record.',false,false,null),
 ('health_membership','Health Membership','PhilHealth or equivalent health membership record.',false,false,null),
 ('housing_membership','Housing Membership','Pag-IBIG or equivalent housing fund record.',false,false,null),
 ('medical_clearance','Medical Clearance','Employment medical clearance or fitness certificate.',true,true,365),
 ('police_clearance','Police/NBI Clearance','Background or clearance document.',false,true,365),
 ('training_certificate','Training / Certification','Training, license, or professional certification.',false,true,null),
 ('drivers_license','Driver License','Driver license for employees assigned to driving duties.',false,true,null)
on conflict(code) do nothing;

-- Private bucket. Application server actions use the Supabase service role for controlled access.
insert into storage.buckets (id,name,public) values ('employee-documents','employee-documents',false) on conflict (id) do update set public=false;

-- SOURCE: 20260921_admin_timekeeping.sql
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
create or replace trigger work_schedules_set_updated_at before update on public.work_schedules for each row execute function public.set_timekeeping_updated_at();
drop trigger if exists attendance_records_set_updated_at on public.attendance_records;
create or replace trigger attendance_records_set_updated_at before update on public.attendance_records for each row execute function public.set_timekeeping_updated_at();

alter table public.work_schedules enable row level security;
alter table public.employee_schedule_assignments enable row level security;
alter table public.attendance_periods enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_corrections enable row level security;

drop policy if exists work_schedules_admin_all on public.work_schedules;
create policy work_schedules_admin_all on public.work_schedules for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists schedule_assignments_admin_all on public.employee_schedule_assignments;
create policy schedule_assignments_admin_all on public.employee_schedule_assignments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists attendance_periods_admin_all on public.attendance_periods;
create policy attendance_periods_admin_all on public.attendance_periods for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists attendance_records_admin_all on public.attendance_records;
create policy attendance_records_admin_all on public.attendance_records for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists attendance_corrections_admin_all on public.attendance_corrections;
create policy attendance_corrections_admin_all on public.attendance_corrections for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

-- Employees may view/request corrections for their own linked attendance. The app uses
-- server-side authorization as the authoritative gate for self-service operations.
drop policy if exists attendance_self_select on public.attendance_records;
create policy attendance_self_select on public.attendance_records for select using (exists(select 1 from public.employees e where e.id=employee_id and e.user_id=auth.uid()));
drop policy if exists corrections_self_select on public.attendance_corrections;
create policy corrections_self_select on public.attendance_corrections for select using (requested_by=auth.uid());
drop policy if exists corrections_self_insert on public.attendance_corrections;
create policy corrections_self_insert on public.attendance_corrections for insert with check (requested_by=auth.uid());

insert into public.work_schedules (name, timezone, monday_in, monday_out, monday_break_start, monday_break_end, tuesday_in, tuesday_out, tuesday_break_start, tuesday_break_end, wednesday_in, wednesday_out, wednesday_break_start, wednesday_break_end, thursday_in, thursday_out, thursday_break_start, thursday_break_end, friday_in, friday_out, friday_break_start, friday_break_end, grace_minutes)
values ('Standard 8-5', 'Asia/Manila', '08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00','08:00','17:00','12:00','13:00',10)
on conflict (name) do nothing;

-- SOURCE: 20260921_attendance_calculation.sql
-- Application-layer attendance calculation support.
-- The calculated result remains stored in attendance_records so payroll can consume
-- a stable authoritative value. Schedule assignment lookup is indexed for speed.
create index if not exists employee_schedule_effective_lookup_idx
  on public.employee_schedule_assignments(employee_id, effective_from desc, effective_to);

-- SOURCE: 20260921_admin_leave_management.sql
-- IBX Admin Leave Management
do $$ begin
  create type public.leave_request_status as enum ('prepared','reviewed','approved','rejected','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.leave_day_type as enum ('full_day','first_half','second_half');
exception when duplicate_object then null; end $$;

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
create or replace trigger leave_types_set_updated_at before update on public.leave_types for each row execute function public.set_leave_updated_at();
drop trigger if exists leave_balances_set_updated_at on public.employee_leave_balances;
create or replace trigger leave_balances_set_updated_at before update on public.employee_leave_balances for each row execute function public.set_leave_updated_at();
drop trigger if exists leave_requests_set_updated_at on public.leave_requests;
create or replace trigger leave_requests_set_updated_at before update on public.leave_requests for each row execute function public.set_leave_updated_at();

alter table public.leave_types enable row level security;
alter table public.employee_leave_balances enable row level security;
alter table public.leave_requests enable row level security;

drop policy if exists leave_types_admin_all on public.leave_types;
create policy leave_types_admin_all on public.leave_types for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists leave_balances_admin_all on public.employee_leave_balances;
create policy leave_balances_admin_all on public.employee_leave_balances for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists leave_requests_admin_all on public.leave_requests;
create policy leave_requests_admin_all on public.leave_requests for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
drop policy if exists leave_requests_self_select on public.leave_requests;
create policy leave_requests_self_select on public.leave_requests for select using (exists(select 1 from public.employees e where e.id=employee_id and e.user_id=auth.uid()) or requested_by=auth.uid());
drop policy if exists leave_requests_self_insert on public.leave_requests;
create policy leave_requests_self_insert on public.leave_requests for insert with check (requested_by=auth.uid() and exists(select 1 from public.employees e where e.id=employee_id and e.user_id=auth.uid()));

insert into public.leave_types(code,name,description,paid,requires_approval,default_days_per_year)
values
 ('vacation','Vacation Leave','Planned personal leave.',true,true,15),
 ('sick','Sick Leave','Leave for illness or medical needs.',true,true,15),
 ('emergency','Emergency Leave','Urgent unforeseen personal matters.',true,true,5),
 ('unpaid','Unpaid Leave','Approved leave without pay.',false,true,null)
on conflict(code) do nothing;

-- Admin expenses must follow assets, fleet and internal requests because the
-- existing expenses table receives foreign-key columns to those tables.
-- SOURCE: 20260921_admin_expenses.sql
-- IBX Admin Expenses: richer admin-specific expense register on top of shared expenses.
-- Keeps the shared workflow/status model compatible with Finance/Logistics/Marketing/Sales.

create table if not exists public.admin_expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.expenses add column if not exists expense_date date;
alter table public.expenses add column if not exists category_id uuid references public.admin_expense_categories(id) on delete set null;
alter table public.expenses add column if not exists vendor text;
alter table public.expenses add column if not exists payment_method text;
alter table public.expenses add column if not exists reference_no text;
alter table public.expenses add column if not exists receipt_reference text;
alter table public.expenses add column if not exists asset_id uuid references public.assets(id) on delete set null;
alter table public.expenses add column if not exists fleet_vehicle_id uuid references public.fleet_vehicles(id) on delete set null;
alter table public.expenses add column if not exists supply_request_id uuid references public.internal_requests(id) on delete set null;
alter table public.expenses add column if not exists rejection_reason text;

update public.expenses set expense_date = coalesce(expense_date, created_at::date) where expense_date is null;
alter table public.expenses alter column expense_date set default current_date;

create index if not exists expenses_admin_date_idx on public.expenses(section_id, expense_date desc);
create index if not exists expenses_admin_category_idx on public.expenses(category_id);
create index if not exists expenses_admin_vendor_idx on public.expenses(vendor);

insert into public.admin_expense_categories(code,name,description)
values
 ('office_operations','Office Operations','Routine office and administrative operating expenses'),
 ('utilities','Utilities','Electricity, water, internet, telephone and similar services'),
 ('rent','Rent & Premises','Office rent, building charges and premises costs'),
 ('transportation','Transportation','Local transport, fares and administrative travel'),
 ('supplies','Office Supplies','Administrative consumables and office supplies'),
 ('repairs','Repairs & Maintenance','Repairs and maintenance of office property/equipment'),
 ('fleet','Fleet','Administrative vehicle-related costs not captured by fleet expense records'),
 ('licenses','Licenses & Compliance','Licenses, permits, registrations and compliance costs'),
 ('training','Training','Administrative training and development'),
 ('communication','Communication','Postage, courier, communications and related costs'),
 ('miscellaneous','Miscellaneous','Other approved administrative expenses')
on conflict (code) do nothing;

alter table public.admin_expense_categories enable row level security;
drop policy if exists admin_expense_categories_admin on public.admin_expense_categories;
create policy admin_expense_categories_admin on public.admin_expense_categories
for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')))
with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

-- SOURCE: 20260921_admin_policies_announcements.sql
-- Admin Policies & Announcements
create table if not exists public.admin_policy_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_policies (
  id uuid primary key default gen_random_uuid(),
  policy_no text not null unique,
  title text not null,
  category_id uuid references public.admin_policy_categories(id),
  version text not null default '1.0',
  effective_date date,
  review_date date,
  owner_department text,
  summary text,
  content text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  acknowledgement_required boolean not null default false,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_announcements (
  id uuid primary key default gen_random_uuid(),
  announcement_no text not null unique,
  title text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  audience text not null default 'all' check (audience in ('all','admin','finance','logistics','marketing','sales')),
  summary text,
  content text not null,
  publish_from timestamptz,
  publish_until timestamptz,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.admin_policies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique(policy_id,user_id)
);

create index if not exists admin_policies_status_idx on public.admin_policies(status);
create index if not exists admin_policies_effective_idx on public.admin_policies(effective_date);
create index if not exists admin_announcements_status_idx on public.admin_announcements(status);
create index if not exists admin_announcements_publish_idx on public.admin_announcements(publish_from,publish_until);
create index if not exists admin_policy_ack_user_idx on public.admin_policy_acknowledgements(user_id);

insert into public.admin_policy_categories(code,name,description)
values
 ('hr','HR & People','Employment, conduct, leave and workplace policies'),
 ('finance','Finance & Controls','Financial control and administrative finance policies'),
 ('it','IT & Security','Technology, access and information security policies'),
 ('operations','Operations','Operational procedures and office rules'),
 ('safety','Safety & Compliance','Safety, compliance and emergency policies'),
 ('other','Other','Other internal policies')
on conflict (code) do nothing;

alter table public.admin_policy_categories enable row level security;
alter table public.admin_policies enable row level security;
alter table public.admin_announcements enable row level security;
alter table public.admin_policy_acknowledgements enable row level security;

drop policy if exists admin_policy_categories_select on public.admin_policy_categories;
drop policy if exists admin_policies_select on public.admin_policies;
drop policy if exists admin_announcements_select on public.admin_announcements;
drop policy if exists admin_policy_ack_select on public.admin_policy_acknowledgements;
drop policy if exists admin_policy_ack_insert on public.admin_policy_acknowledgements;

drop policy if exists admin_policy_categories_select on public.admin_policy_categories;
create policy admin_policy_categories_select on public.admin_policy_categories for select to authenticated using (true);
drop policy if exists admin_policies_select on public.admin_policies;
create policy admin_policies_select on public.admin_policies for select to authenticated using (status = 'published' or created_by = auth.uid());
drop policy if exists admin_announcements_select on public.admin_announcements;
create policy admin_announcements_select on public.admin_announcements for select to authenticated using (
  status = 'published' and (publish_from is null or publish_from <= now()) and (publish_until is null or publish_until >= now())
  or created_by = auth.uid()
);
drop policy if exists admin_policy_ack_select on public.admin_policy_acknowledgements;
create policy admin_policy_ack_select on public.admin_policy_acknowledgements for select to authenticated using (user_id = auth.uid());
drop policy if exists admin_policy_ack_insert on public.admin_policy_acknowledgements;
create policy admin_policy_ack_insert on public.admin_policy_acknowledgements for insert to authenticated with check (user_id = auth.uid());

-- Application actions use the existing service-role/admin client and audit_log.

-- ============================================================================
-- 03 FINANCE / PROCUREMENT
-- ============================================================================

-- Procurement must precede AP and logistics inventory because both reference
-- procurement suppliers/items/orders.
-- SOURCE: 20260921_finance_procurement_foundation.sql
-- IBX Finance + Procurement foundation
-- Supplier master, procurement catalog, purchase requisitions and purchase orders.

create table if not exists public.finance_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text unique not null,
  legal_name text not null,
  trade_name text,
  contact_person text,
  email text,
  phone text,
  address text,
  tax_id text,
  payment_terms text,
  bank_details text,
  active boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_procurement_items (
  id uuid primary key default gen_random_uuid(),
  item_code text unique not null,
  item_name text not null,
  description text,
  category text,
  unit text not null default 'unit',
  default_supplier_id uuid references public.finance_suppliers(id),
  standard_cost numeric(14,2) not null default 0,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  pr_number text unique not null,
  requested_by uuid references public.users(id),
  requested_for_employee_id uuid references public.employees(id),
  department text,
  needed_by date,
  purpose text not null,
  notes text,
  currency text not null default 'PHP',
  estimated_total numeric(14,2) not null default 0,
  status entry_status not null default 'draft',
  rejection_reason text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete cascade,
  item_id uuid references public.finance_procurement_items(id),
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'unit',
  estimated_unit_cost numeric(14,2) not null default 0,
  estimated_amount numeric(14,2) generated always as (quantity * estimated_unit_cost) stored,
  notes text
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text unique not null,
  requisition_id uuid references public.purchase_requisitions(id),
  supplier_id uuid not null references public.finance_suppliers(id),
  order_date date not null default current_date,
  expected_delivery_date date,
  delivery_address text,
  currency text not null default 'PHP',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (subtotal + tax_amount + other_charges) stored,
  payment_terms text,
  notes text,
  status entry_status not null default 'draft',
  rejection_reason text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid references public.finance_procurement_items(id),
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'unit',
  unit_cost numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * unit_cost) stored,
  notes text
);

create index if not exists idx_finance_suppliers_active on public.finance_suppliers(active, legal_name);
create index if not exists idx_procurement_items_active on public.finance_procurement_items(active, item_name);
create index if not exists idx_pr_status on public.purchase_requisitions(status, created_at desc);
create index if not exists idx_pr_items_requisition on public.purchase_requisition_items(requisition_id);
create index if not exists idx_po_status on public.purchase_orders(status, created_at desc);
create index if not exists idx_po_supplier on public.purchase_orders(supplier_id, order_date desc);
create index if not exists idx_po_items_order on public.purchase_order_items(purchase_order_id);

alter table public.finance_suppliers enable row level security;
alter table public.finance_procurement_items enable row level security;
alter table public.purchase_requisitions enable row level security;
alter table public.purchase_requisition_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

-- Finance section access. Super Admin is covered by is_super_admin().
drop policy if exists "finance suppliers access" on public.finance_suppliers;
create policy "finance suppliers access" on public.finance_suppliers for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
drop policy if exists "finance procurement items access" on public.finance_procurement_items;
create policy "finance procurement items access" on public.finance_procurement_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
drop policy if exists "finance PR access" on public.purchase_requisitions;
create policy "finance PR access" on public.purchase_requisitions for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
drop policy if exists "finance PR items access" on public.purchase_requisition_items;
create policy "finance PR items access" on public.purchase_requisition_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
drop policy if exists "finance PO access" on public.purchase_orders;
create policy "finance PO access" on public.purchase_orders for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
drop policy if exists "finance PO items access" on public.purchase_order_items;
create policy "finance PO items access" on public.purchase_order_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);

drop policy if exists "finance can read employees" on public.employees;
create policy "finance can read employees" on public.employees for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);

insert into public.finance_suppliers (supplier_code, legal_name, trade_name, payment_terms, notes)
select 'SUP-001', 'Sample Supplier — replace before production', 'Sample Supplier', '30 days', 'Seeded procurement supplier for initial setup.'
where not exists (select 1 from public.finance_suppliers where supplier_code='SUP-001');

-- SOURCE: 20260921_finance_accounts_payable.sql
-- IBX Finance Accounts Payable foundation
-- Supplier invoices, invoice lines, payment records and AP status/aging foundation.

do $$ begin
  create type public.ap_invoice_status as enum ('draft','prepared','reviewed','approved','partially_paid','paid','voided');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.ap_payment_status as enum ('draft','prepared','reviewed','approved','posted','voided');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  supplier_id uuid not null references public.finance_suppliers(id),
  purchase_order_id uuid references public.purchase_orders(id),
  invoice_date date not null,
  due_date date,
  currency text not null default 'PHP',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (subtotal + tax_amount + other_charges) stored,
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(14,2) generated always as ((subtotal + tax_amount + other_charges) - amount_paid) stored,
  status public.ap_invoice_status not null default 'draft',
  notes text,
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  created_by uuid references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(supplier_id, invoice_number)
);

create table if not exists public.finance_supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_supplier_invoices(id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_items(id),
  description text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'unit',
  unit_cost numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * unit_cost) stored,
  notes text
);

create table if not exists public.finance_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text unique not null,
  invoice_id uuid not null references public.finance_supplier_invoices(id),
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'Bank transfer',
  reference_number text,
  bank_account text,
  notes text,
  status public.ap_payment_status not null default 'draft',
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  posted_by uuid references public.users(id), posted_at timestamptz,
  created_by uuid references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists idx_ap_invoice_supplier on public.finance_supplier_invoices(supplier_id, invoice_date desc);
create index if not exists idx_ap_invoice_status on public.finance_supplier_invoices(status, due_date);
create index if not exists idx_ap_invoice_po on public.finance_supplier_invoices(purchase_order_id);
create index if not exists idx_ap_invoice_items_invoice on public.finance_supplier_invoice_items(invoice_id);
create index if not exists idx_ap_payment_invoice on public.finance_supplier_payments(invoice_id, payment_date desc);
create index if not exists idx_ap_payment_status on public.finance_supplier_payments(status, payment_date desc);

alter table public.finance_supplier_invoices enable row level security;
alter table public.finance_supplier_invoice_items enable row level security;
alter table public.finance_supplier_payments enable row level security;

drop policy if exists "finance AP invoices access" on public.finance_supplier_invoices;
create policy "finance AP invoices access" on public.finance_supplier_invoices for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);
drop policy if exists "finance AP invoice items access" on public.finance_supplier_invoice_items;
create policy "finance AP invoice items access" on public.finance_supplier_invoice_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);
drop policy if exists "finance AP payments access" on public.finance_supplier_payments;
create policy "finance AP payments access" on public.finance_supplier_payments for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);

create or replace function public.recalculate_supplier_invoice_paid(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_paid numeric(14,2);
begin
  select coalesce(sum(amount),0) into v_paid from public.finance_supplier_payments where invoice_id=p_invoice_id and status='posted';
  update public.finance_supplier_invoices
  set amount_paid=v_paid,
      status=case when status='voided' then status when v_paid >= total_amount then 'paid'::public.ap_invoice_status when v_paid > 0 then 'partially_paid'::public.ap_invoice_status else status end,
      updated_at=now()
  where id=p_invoice_id;
end; $$;

-- AR must precede warehouse delivery and sales revenue integration.
-- SOURCE: 20260921_finance_accounts_receivable.sql
-- IBX Finance Accounts Receivable foundation
-- Customer master, customer invoices, receipts and receivable aging foundation.

DO $$ BEGIN
  CREATE TYPE public.ar_invoice_status AS ENUM ('draft','prepared','reviewed','approved','partially_paid','paid','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.ar_receipt_status AS ENUM ('draft','prepared','reviewed','approved','posted','voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.finance_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  trade_name text,
  contact_person text,
  email text,
  phone text,
  address text,
  tax_id text,
  payment_terms text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_customer_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.finance_customers(id),
  invoice_date date NOT NULL,
  due_date date,
  currency text NOT NULL DEFAULT 'PHP',
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  other_charges numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS ((subtotal + tax_amount + other_charges) - discount_amount) STORED,
  amount_received numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  balance_due numeric(14,2) GENERATED ALWAYS AS (((subtotal + tax_amount + other_charges) - discount_amount) - amount_received) STORED,
  status public.ar_invoice_status NOT NULL DEFAULT 'draft',
  notes text,
  prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz,
  approved_by uuid REFERENCES public.users(id), approved_at timestamptz,
  created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_customer_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.finance_customer_invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'unit',
  unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount numeric(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes text
);

CREATE TABLE IF NOT EXISTS public.finance_customer_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.finance_customer_invoices(id),
  receipt_date date NOT NULL DEFAULT current_date,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'Bank transfer',
  reference_number text,
  bank_account text,
  notes text,
  status public.ar_receipt_status NOT NULL DEFAULT 'draft',
  prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz,
  approved_by uuid REFERENCES public.users(id), approved_at timestamptz,
  posted_by uuid REFERENCES public.users(id), posted_at timestamptz,
  created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_customer_active ON public.finance_customers(active, legal_name);
CREATE INDEX IF NOT EXISTS idx_ar_invoice_customer ON public.finance_customer_invoices(customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ar_invoice_status_due ON public.finance_customer_invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_ar_invoice_items_invoice ON public.finance_customer_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ar_receipt_invoice ON public.finance_customer_receipts(invoice_id, receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_ar_receipt_status ON public.finance_customer_receipts(status, receipt_date DESC);

ALTER TABLE public.finance_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_customer_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_customer_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance AR customers access" ON public.finance_customers;
CREATE POLICY "finance AR customers access" ON public.finance_customers FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);
DROP POLICY IF EXISTS "finance AR invoices access" ON public.finance_customer_invoices;
CREATE POLICY "finance AR invoices access" ON public.finance_customer_invoices FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);
DROP POLICY IF EXISTS "finance AR invoice items access" ON public.finance_customer_invoice_items;
CREATE POLICY "finance AR invoice items access" ON public.finance_customer_invoice_items FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);
DROP POLICY IF EXISTS "finance AR receipts access" ON public.finance_customer_receipts;
CREATE POLICY "finance AR receipts access" ON public.finance_customer_receipts FOR ALL USING (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
) WITH CHECK (
  public.is_super_admin() OR (select role from public.users where id=auth.uid())='finance' OR public.in_section((select id from public.sections where code='finance'))
);

CREATE OR REPLACE FUNCTION public.recalculate_customer_invoice_received(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_received numeric(14,2);
BEGIN
  SELECT coalesce(sum(amount),0) INTO v_received
  FROM public.finance_customer_receipts
  WHERE invoice_id=p_invoice_id AND status='posted';
  UPDATE public.finance_customer_invoices
  SET amount_received=v_received,
      status=CASE
        WHEN status='voided' THEN status
        WHEN v_received >= total_amount THEN 'paid'::public.ar_invoice_status
        WHEN v_received > 0 THEN 'partially_paid'::public.ar_invoice_status
        ELSE status
      END,
      updated_at=now()
  WHERE id=p_invoice_id;
END; $$;

INSERT INTO public.finance_customers (customer_code, legal_name, trade_name, payment_terms)
VALUES ('CUS-001','Sample Customer','Sample Customer','30 days')
ON CONFLICT (customer_code) DO NOTHING;

-- SOURCE: 20260921_finance_payroll_foundation.sql
-- IBX Finance Payroll Foundation

do $$ begin
  create type public.payroll_period_status as enum ('open','processing','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_run_status as enum ('draft','prepared','reviewed','approved','posted','voided');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_frequency as enum ('monthly','semi_monthly','weekly','daily');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_compensation_type as enum ('monthly','daily','hourly');
exception when duplicate_object then null; end $$;

create table if not exists public.payroll_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  compensation_type public.payroll_compensation_type not null default 'monthly',
  pay_frequency public.payroll_frequency not null default 'monthly',
  base_rate numeric(14,2) not null default 0 check (base_rate >= 0),
  housing_allowance numeric(14,2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  meal_allowance numeric(14,2) not null default 0 check (meal_allowance >= 0),
  other_allowance numeric(14,2) not null default 0 check (other_allowance >= 0),
  overtime_multiplier numeric(6,3) not null default 1.25 check (overtime_multiplier >= 0),
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_profile_dates check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_name text not null,
  start_date date not null,
  end_date date not null,
  pay_date date,
  frequency public.payroll_frequency not null default 'monthly',
  status public.payroll_period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references public.users(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(start_date,end_date),
  constraint payroll_period_dates check (end_date >= start_date)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique,
  period_id uuid not null references public.payroll_periods(id) on delete restrict,
  status public.payroll_run_status not null default 'draft',
  employee_count int not null default 0,
  gross_pay numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  notes text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_by uuid references public.users(id),
  posted_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id)
);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  base_pay numeric(14,2) not null default 0,
  overtime_pay numeric(14,2) not null default 0,
  paid_leave_pay numeric(14,2) not null default 0,
  housing_allowance numeric(14,2) not null default 0,
  transport_allowance numeric(14,2) not null default 0,
  meal_allowance numeric(14,2) not null default 0,
  other_allowance numeric(14,2) not null default 0,
  gross_pay numeric(14,2) not null default 0,
  tax_withheld numeric(14,2) not null default 0,
  social_security numeric(14,2) not null default 0,
  health_contribution numeric(14,2) not null default 0,
  housing_fund numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  regular_hours numeric(10,2) not null default 0,
  overtime_hours numeric(10,2) not null default 0,
  paid_leave_days numeric(10,2) not null default 0,
  unpaid_leave_days numeric(10,2) not null default 0,
  attendance_days numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_run_id, employee_id)
);

create table if not exists public.payroll_entry_adjustments (
  id uuid primary key default gen_random_uuid(),
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('earning','deduction')),
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists payroll_period_status_idx on public.payroll_periods(status,start_date desc);
create index if not exists payroll_run_status_idx on public.payroll_runs(status,created_at desc);
create index if not exists payroll_entries_employee_idx on public.payroll_entries(employee_id,payroll_run_id);

create or replace function public.set_payroll_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists payroll_profile_updated_at on public.payroll_employee_profiles;
create or replace trigger payroll_profile_updated_at before update on public.payroll_employee_profiles for each row execute function public.set_payroll_updated_at();
drop trigger if exists payroll_period_updated_at on public.payroll_periods;
create or replace trigger payroll_period_updated_at before update on public.payroll_periods for each row execute function public.set_payroll_updated_at();
drop trigger if exists payroll_run_updated_at on public.payroll_runs;
create or replace trigger payroll_run_updated_at before update on public.payroll_runs for each row execute function public.set_payroll_updated_at();
drop trigger if exists payroll_entry_updated_at on public.payroll_entries;
create or replace trigger payroll_entry_updated_at before update on public.payroll_entries for each row execute function public.set_payroll_updated_at();

alter table public.payroll_employee_profiles enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entry_adjustments enable row level security;

drop policy if exists payroll_profiles_finance_all on public.payroll_employee_profiles;
create policy payroll_profiles_finance_all on public.payroll_employee_profiles for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists payroll_periods_finance_all on public.payroll_periods;
create policy payroll_periods_finance_all on public.payroll_periods for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists payroll_runs_finance_all on public.payroll_runs;
create policy payroll_runs_finance_all on public.payroll_runs for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists payroll_entries_finance_all on public.payroll_entries;
create policy payroll_entries_finance_all on public.payroll_entries for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists payroll_adjustments_finance_all on public.payroll_entry_adjustments;
create policy payroll_adjustments_finance_all on public.payroll_entry_adjustments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));

-- SOURCE: 20260921_finance_payroll_functions.sql
-- Payroll totals helper
create or replace function public.recalculate_payroll_run_totals(p_run_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.payroll_runs r set
    employee_count=(select count(*) from public.payroll_entries e where e.payroll_run_id=r.id),
    gross_pay=coalesce((select sum(gross_pay) from public.payroll_entries e where e.payroll_run_id=r.id),0),
    total_deductions=coalesce((select sum(total_deductions) from public.payroll_entries e where e.payroll_run_id=r.id),0),
    net_pay=coalesce((select sum(net_pay) from public.payroll_entries e where e.payroll_run_id=r.id),0),
    updated_at=now()
  where r.id=p_run_id;
end; $$;

-- SOURCE: 20260921_finance_bank_cash_reconciliation.sql
-- IBX Finance Bank / Cash & Reconciliation Foundation

do $$ begin
  create type public.bank_account_status as enum ('active','inactive','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cash_transaction_status as enum ('draft','prepared','reviewed','approved','posted','voided');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cash_transaction_type as enum ('deposit','withdrawal','transfer_in','transfer_out','bank_charge','interest','adjustment');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reconciliation_status as enum ('draft','in_progress','completed','locked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reconciliation_item_status as enum ('unmatched','matched','excluded');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name text not null,
  bank_name text,
  account_number_masked text,
  account_type text not null default 'checking',
  currency text not null default 'PHP',
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  status public.bank_account_status not null default 'active',
  is_cash_on_hand boolean not null default false,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number text not null unique,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transaction_date date not null,
  transaction_type public.cash_transaction_type not null,
  amount numeric(14,2) not null check (amount > 0),
  direction text not null check (direction in ('in','out')),
  description text not null,
  reference_number text,
  counterparty text,
  source_module text,
  source_record_id uuid,
  status public.cash_transaction_status not null default 'draft',
  posted_at timestamptz,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_by uuid references public.users(id),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  statement_date date not null,
  statement_opening_balance numeric(14,2) not null default 0,
  statement_closing_balance numeric(14,2) not null default 0,
  book_balance numeric(14,2) not null default 0,
  reconciled_balance numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  status public.reconciliation_status not null default 'draft',
  notes text,
  completed_by uuid references public.users(id),
  completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bank_account_id, statement_date)
);

create table if not exists public.finance_bank_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.finance_bank_reconciliations(id) on delete cascade,
  transaction_id uuid references public.finance_cash_transactions(id) on delete set null,
  statement_date date,
  statement_reference text,
  description text,
  statement_amount numeric(14,2) not null default 0,
  status public.reconciliation_item_status not null default 'unmatched',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists finance_bank_accounts_status_idx on public.finance_bank_accounts(status);
create index if not exists finance_cash_transactions_account_date_idx on public.finance_cash_transactions(bank_account_id,transaction_date desc);
create index if not exists finance_cash_transactions_status_idx on public.finance_cash_transactions(status,created_at desc);
create index if not exists finance_bank_reconciliations_account_date_idx on public.finance_bank_reconciliations(bank_account_id,statement_date desc);
create index if not exists finance_bank_reconciliation_items_rec_idx on public.finance_bank_reconciliation_items(reconciliation_id,status);

create or replace function public.set_finance_bank_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists finance_bank_accounts_updated_at on public.finance_bank_accounts;
create or replace trigger finance_bank_accounts_updated_at before update on public.finance_bank_accounts for each row execute function public.set_finance_bank_updated_at();
drop trigger if exists finance_cash_transactions_updated_at on public.finance_cash_transactions;
create or replace trigger finance_cash_transactions_updated_at before update on public.finance_cash_transactions for each row execute function public.set_finance_bank_updated_at();
drop trigger if exists finance_bank_reconciliations_updated_at on public.finance_bank_reconciliations;
create or replace trigger finance_bank_reconciliations_updated_at before update on public.finance_bank_reconciliations for each row execute function public.set_finance_bank_updated_at();

create or replace function public.recalculate_finance_bank_balance(p_bank_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.finance_bank_accounts a
  set current_balance = a.opening_balance + coalesce((select sum(case when t.direction='in' then t.amount else -t.amount end) from public.finance_cash_transactions t where t.bank_account_id=a.id and t.status='posted'),0), updated_at=now()
  where a.id=p_bank_account_id;
end; $$;

create or replace function public.recalculate_finance_reconciliation(p_reconciliation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.finance_bank_reconciliations where id=p_reconciliation_id;
  if not found then return; end if;
  update public.finance_bank_reconciliations x
  set book_balance = coalesce((select current_balance from public.finance_bank_accounts where id=r.bank_account_id),0),
      reconciled_balance = r.statement_closing_balance,
      difference = coalesce((select current_balance from public.finance_bank_accounts where id=r.bank_account_id),0) - r.statement_closing_balance,
      updated_at=now()
  where id=p_reconciliation_id;
end; $$;

alter table public.finance_bank_accounts enable row level security;
alter table public.finance_cash_transactions enable row level security;
alter table public.finance_bank_reconciliations enable row level security;
alter table public.finance_bank_reconciliation_items enable row level security;

drop policy if exists finance_bank_accounts_all on public.finance_bank_accounts;
create policy finance_bank_accounts_all on public.finance_bank_accounts for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists finance_cash_transactions_all on public.finance_cash_transactions;
create policy finance_cash_transactions_all on public.finance_cash_transactions for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists finance_bank_reconciliations_all on public.finance_bank_reconciliations;
create policy finance_bank_reconciliations_all on public.finance_bank_reconciliations for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
drop policy if exists finance_bank_reconciliation_items_all on public.finance_bank_reconciliation_items;
create policy finance_bank_reconciliation_items_all on public.finance_bank_reconciliation_items for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));

-- SOURCE: 20260921_finance_budgets_forecasting.sql
-- IBX Finance: Budgets & Forecasting foundation
do $$ begin
  create type public.finance_budget_status as enum ('draft','prepared','reviewed','approved','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.finance_budget_scenario as enum ('budget','forecast','best_case','conservative');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  budget_code text not null unique,
  name text not null,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200),
  scenario public.finance_budget_scenario not null default 'budget',
  version integer not null default 1 check (version > 0),
  status public.finance_budget_status not null default 'draft',
  notes text,
  total_budget numeric(14,2) not null default 0,
  total_forecast numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  prepared_by uuid references auth.users(id), prepared_at timestamptz,
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  closed_by uuid references auth.users(id), closed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists finance_budgets_year_version_idx on public.finance_budgets(fiscal_year, scenario, version);

create table if not exists public.finance_budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.finance_budgets(id) on delete cascade,
  line_code text not null,
  account_name text not null,
  department text,
  category text,
  notes text,
  jan_budget numeric(14,2) not null default 0, feb_budget numeric(14,2) not null default 0, mar_budget numeric(14,2) not null default 0,
  apr_budget numeric(14,2) not null default 0, may_budget numeric(14,2) not null default 0, jun_budget numeric(14,2) not null default 0,
  jul_budget numeric(14,2) not null default 0, aug_budget numeric(14,2) not null default 0, sep_budget numeric(14,2) not null default 0,
  oct_budget numeric(14,2) not null default 0, nov_budget numeric(14,2) not null default 0, dec_budget numeric(14,2) not null default 0,
  jan_forecast numeric(14,2) not null default 0, feb_forecast numeric(14,2) not null default 0, mar_forecast numeric(14,2) not null default 0,
  apr_forecast numeric(14,2) not null default 0, may_forecast numeric(14,2) not null default 0, jun_forecast numeric(14,2) not null default 0,
  jul_forecast numeric(14,2) not null default 0, aug_forecast numeric(14,2) not null default 0, sep_forecast numeric(14,2) not null default 0,
  oct_forecast numeric(14,2) not null default 0, nov_forecast numeric(14,2) not null default 0, dec_forecast numeric(14,2) not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(budget_id, line_code)
);

create table if not exists public.finance_budget_actuals (
  id uuid primary key default gen_random_uuid(),
  budget_line_id uuid not null references public.finance_budget_lines(id) on delete cascade,
  fiscal_year integer not null,
  month integer not null check (month between 1 and 12),
  actual_amount numeric(14,2) not null default 0,
  source_module text,
  source_record_id uuid,
  notes text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(budget_line_id, month)
);

create index if not exists finance_budget_lines_budget_idx on public.finance_budget_lines(budget_id);
create index if not exists finance_budget_actuals_year_month_idx on public.finance_budget_actuals(fiscal_year, month);

create or replace function public.recalculate_finance_budget_totals(p_budget_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.finance_budgets b
  set total_budget = coalesce((select sum(jan_budget+feb_budget+mar_budget+apr_budget+may_budget+jun_budget+jul_budget+aug_budget+sep_budget+oct_budget+nov_budget+dec_budget) from public.finance_budget_lines l where l.budget_id=b.id),0),
      total_forecast = coalesce((select sum(jan_forecast+feb_forecast+mar_forecast+apr_forecast+may_forecast+jun_forecast+jul_forecast+aug_forecast+sep_forecast+oct_forecast+nov_forecast+dec_forecast) from public.finance_budget_lines l where l.budget_id=b.id),0),
      updated_at=now()
  where b.id=p_budget_id;
end; $$;

grant execute on function public.recalculate_finance_budget_totals(uuid) to authenticated;

alter table public.finance_budgets enable row level security;
alter table public.finance_budget_lines enable row level security;
alter table public.finance_budget_actuals enable row level security;

drop policy if exists finance_budgets_select on public.finance_budgets;
create policy finance_budgets_select on public.finance_budgets for select to authenticated using (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budgets_insert on public.finance_budgets;
create policy finance_budgets_insert on public.finance_budgets for insert to authenticated with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budgets_update on public.finance_budgets;
create policy finance_budgets_update on public.finance_budgets for update to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_lines_select on public.finance_budget_lines;
create policy finance_budget_lines_select on public.finance_budget_lines for select to authenticated using (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_lines_insert on public.finance_budget_lines;
create policy finance_budget_lines_insert on public.finance_budget_lines for insert to authenticated with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_lines_update on public.finance_budget_lines;
create policy finance_budget_lines_update on public.finance_budget_lines for update to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_lines_delete on public.finance_budget_lines;
create policy finance_budget_lines_delete on public.finance_budget_lines for delete to authenticated using (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_actuals_select on public.finance_budget_actuals;
create policy finance_budget_actuals_select on public.finance_budget_actuals for select to authenticated using (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_actuals_insert on public.finance_budget_actuals;
create policy finance_budget_actuals_insert on public.finance_budget_actuals for insert to authenticated with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_budget_actuals_update on public.finance_budget_actuals;
create policy finance_budget_actuals_update on public.finance_budget_actuals for update to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());

insert into public.finance_budgets (budget_code,name,fiscal_year,scenario,version,status,notes)
values ('BUD-2026-01','FY2026 Operating Budget',2026,'budget',1,'draft','Initial Finance budget foundation')
on conflict (budget_code) do nothing;

-- Accounting must precede sales revenue recognition because revenue
-- recognition stores a finance journal entry reference.
-- SOURCE: 20260921_finance_accounting_posting.sql
-- IBX Finance: Financial Summary / Accounting Posting Integration
do $$ begin
  create type public.finance_account_type as enum ('asset','liability','equity','revenue','expense');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.finance_journal_status as enum ('draft','prepared','reviewed','approved','posted','voided');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name text not null,
  account_type public.finance_account_type not null,
  parent_id uuid references public.finance_chart_of_accounts(id),
  is_control_account boolean not null default false,
  active boolean not null default true,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_accounting_periods (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  unique(year, month)
);

create table if not exists public.finance_journal_entries (
  id uuid primary key default gen_random_uuid(),
  journal_number text not null unique,
  entry_date date not null,
  description text not null,
  source_module text,
  source_record_id uuid,
  section_id uuid references public.sections(id),
  status public.finance_journal_status not null default 'draft',
  total_debit numeric(14,2) not null default 0,
  total_credit numeric(14,2) not null default 0,
  prepared_by uuid references auth.users(id), prepared_at timestamptz,
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  posted_by uuid references auth.users(id), posted_at timestamptz,
  voided_by uuid references auth.users(id), voided_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.finance_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.finance_journal_entries(id) on delete cascade,
  account_id uuid not null references public.finance_chart_of_accounts(id),
  line_description text,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  department text,
  created_at timestamptz not null default now(),
  check ((debit = 0 and credit > 0) or (credit = 0 and debit > 0))
);

create index if not exists finance_journal_entries_date_idx on public.finance_journal_entries(entry_date);
create index if not exists finance_journal_entries_source_idx on public.finance_journal_entries(source_module, source_record_id);
create index if not exists finance_journal_lines_account_idx on public.finance_journal_lines(account_id);
create unique index if not exists finance_posted_source_unique_idx on public.finance_journal_entries(source_module, source_record_id) where status='posted' and source_module is not null and source_record_id is not null;

create or replace function public.recalculate_finance_journal_totals(p_journal_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.finance_journal_entries j
  set total_debit=coalesce((select sum(debit) from public.finance_journal_lines l where l.journal_entry_id=j.id),0),
      total_credit=coalesce((select sum(credit) from public.finance_journal_lines l where l.journal_entry_id=j.id),0),
      updated_at=now()
  where j.id=p_journal_id;
end; $$;

grant execute on function public.recalculate_finance_journal_totals(uuid) to authenticated;

create or replace function public.post_finance_journal(p_journal_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare j public.finance_journal_entries%rowtype; period_status text; d numeric(14,2); c numeric(14,2);
begin
  select * into j from public.finance_journal_entries where id=p_journal_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if j.status <> 'approved' then raise exception 'Only approved journal entries can be posted'; end if;
  select status into period_status from public.finance_accounting_periods where year=extract(year from j.entry_date)::int and month=extract(month from j.entry_date)::int;
  if period_status='closed' then raise exception 'Accounting period is closed'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d,c from public.finance_journal_lines where journal_entry_id=j.id;
  if d <= 0 or d <> c then raise exception 'Journal entry must be balanced and greater than zero'; end if;
  update public.finance_journal_entries set status='posted',posted_by=p_actor,posted_at=now(),total_debit=d,total_credit=c,updated_at=now() where id=j.id;
  perform public.refresh_financial_summary_from_ledger(j.entry_date);
end; $$;

create or replace function public.refresh_financial_summary_from_ledger(p_entry_date date)
returns void language plpgsql security definer set search_path=public as $$
declare mid uuid; y int:=extract(year from p_entry_date)::int; m int:=extract(month from p_entry_date)::int; sec record;
begin
  select id into mid from public.months where year=y and month=m limit 1;
  if mid is null then return; end if;
  insert into public.months(year,month,label) values(y,m,to_char(p_entry_date,'FMMonth YYYY')) on conflict(year,month) do nothing;
  select id into mid from public.months where year=y and month=m;
  insert into public.financial_summary(section_id,month_id,total_sales,total_expenses,bottomline,total_commission,computed_at)
  select null,mid,
    coalesce(sum(case when coa.account_type='revenue' then jl.credit-jl.debit else 0 end),0),
    coalesce(sum(case when coa.account_type='expense' then jl.debit-jl.credit else 0 end),0),
    coalesce(sum(case when coa.account_type='revenue' then jl.credit-jl.debit when coa.account_type='expense' then -(jl.debit-jl.credit) else 0 end),0),
    0,now()
  from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id=je.id join public.finance_chart_of_accounts coa on coa.id=jl.account_id
  where je.status='posted' and extract(year from je.entry_date)=y and extract(month from je.entry_date)=m
  on conflict(section_id,month_id) do update set total_sales=excluded.total_sales,total_expenses=excluded.total_expenses,bottomline=excluded.bottomline,computed_at=now();
end; $$;

grant execute on function public.post_finance_journal(uuid,uuid) to authenticated;
grant execute on function public.refresh_financial_summary_from_ledger(date) to authenticated;

alter table public.finance_chart_of_accounts enable row level security;
alter table public.finance_accounting_periods enable row level security;
alter table public.finance_journal_entries enable row level security;
alter table public.finance_journal_lines enable row level security;

drop policy if exists finance_coa_all on public.finance_chart_of_accounts;
create policy finance_coa_all on public.finance_chart_of_accounts for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_periods_all on public.finance_accounting_periods;
create policy finance_periods_all on public.finance_accounting_periods for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_journal_all on public.finance_journal_entries;
create policy finance_journal_all on public.finance_journal_entries for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
drop policy if exists finance_journal_lines_all on public.finance_journal_lines;
create policy finance_journal_lines_all on public.finance_journal_lines for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());

insert into public.finance_chart_of_accounts(account_code,account_name,account_type,is_control_account) values
('1000','Cash on Hand','asset',true),('1010','Bank Accounts','asset',true),('1100','Accounts Receivable','asset',true),('1200','Inventory','asset',true),('1500','Property & Equipment','asset',false),
('2000','Accounts Payable','liability',true),('2100','Payroll Liabilities','liability',true),('2200','Taxes Payable','liability',true),
('3000','Owner Equity','equity',false),('4000','Sales Revenue','revenue',true),('4100','Other Revenue','revenue',false),
('5000','Cost of Sales','expense',true),('5100','Payroll Expense','expense',true),('5200','Operating Expenses','expense',true),('5300','Bank Charges','expense',false)
on conflict(account_code) do nothing;

insert into public.finance_accounting_periods(year,month,status)
select extract(year from now())::int, m, 'open' from generate_series(1,12) m
on conflict(year,month) do nothing;

-- ============================================================================
-- 04 LOGISTICS
-- ============================================================================

-- SOURCE: 20260921_logistics_inventory_receiving.sql
-- IBX Logistics foundation: locations, inventory receiving, stock ledger and transfers.
create table if not exists public.logistics_locations (
  id uuid primary key default gen_random_uuid(),
  location_code text unique not null,
  location_name text not null,
  location_type text not null default 'warehouse' check (location_type in ('warehouse','store','office','transit','other')),
  address text,
  active boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logistics_inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_code text unique not null,
  item_name text not null,
  description text,
  category text,
  unit text not null default 'unit',
  procurement_item_id uuid references public.finance_procurement_items(id),
  reorder_level numeric(14,3) not null default 0,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logistics_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text unique not null,
  purchase_order_id uuid references public.purchase_orders(id),
  supplier_id uuid references public.finance_suppliers(id),
  location_id uuid not null references public.logistics_locations(id),
  receipt_date date not null default current_date,
  delivery_reference text,
  received_by uuid references public.users(id),
  notes text,
  status entry_status not null default 'draft',
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logistics_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.logistics_receipts(id) on delete cascade,
  inventory_item_id uuid not null references public.logistics_inventory_items(id),
  description text,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0,
  lot_number text,
  expiry_date date,
  notes text
);

create table if not exists public.logistics_stock_movements (
  id uuid primary key default gen_random_uuid(),
  movement_number text unique not null,
  inventory_item_id uuid not null references public.logistics_inventory_items(id),
  location_id uuid not null references public.logistics_locations(id),
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('receipt','issue','transfer_in','transfer_out','adjustment')),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0,
  source_table text,
  source_record_id uuid,
  reference_number text,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.logistics_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text unique not null,
  from_location_id uuid not null references public.logistics_locations(id),
  to_location_id uuid not null references public.logistics_locations(id),
  transfer_date date not null default current_date,
  requested_by uuid references public.users(id),
  notes text,
  status entry_status not null default 'draft',
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);

create table if not exists public.logistics_stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.logistics_stock_transfers(id) on delete cascade,
  inventory_item_id uuid not null references public.logistics_inventory_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  notes text
);

create index if not exists idx_logistics_locations_active on public.logistics_locations(active, location_name);
create index if not exists idx_logistics_inventory_active on public.logistics_inventory_items(active, item_name);
create index if not exists idx_logistics_receipts_status on public.logistics_receipts(status, receipt_date desc);
create index if not exists idx_logistics_receipt_items_receipt on public.logistics_receipt_items(receipt_id);
create index if not exists idx_logistics_movements_item_location on public.logistics_stock_movements(inventory_item_id, location_id, movement_date desc);
create index if not exists idx_logistics_transfers_status on public.logistics_stock_transfers(status, transfer_date desc);

alter table public.logistics_locations enable row level security;
alter table public.logistics_inventory_items enable row level security;
alter table public.logistics_receipts enable row level security;
alter table public.logistics_receipt_items enable row level security;
alter table public.logistics_stock_movements enable row level security;
alter table public.logistics_stock_transfers enable row level security;
alter table public.logistics_stock_transfer_items enable row level security;

-- Logistics section access.
drop policy if exists "logistics locations access" on public.logistics_locations;
create policy "logistics locations access" on public.logistics_locations for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics inventory access" on public.logistics_inventory_items;
create policy "logistics inventory access" on public.logistics_inventory_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics receipts access" on public.logistics_receipts;
create policy "logistics receipts access" on public.logistics_receipts for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics receipt items access" on public.logistics_receipt_items;
create policy "logistics receipt items access" on public.logistics_receipt_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics stock movements access" on public.logistics_stock_movements;
create policy "logistics stock movements access" on public.logistics_stock_movements for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics transfers access" on public.logistics_stock_transfers;
create policy "logistics transfers access" on public.logistics_stock_transfers for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics transfer items access" on public.logistics_stock_transfer_items;
create policy "logistics transfer items access" on public.logistics_stock_transfer_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);

-- Logistics can read approved procurement records for receiving.
drop policy if exists "logistics can read purchase orders" on public.purchase_orders;
create policy "logistics can read purchase orders" on public.purchase_orders for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
drop policy if exists "logistics can read purchase order items" on public.purchase_order_items;
create policy "logistics can read purchase order items" on public.purchase_order_items for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
drop policy if exists "logistics can read suppliers" on public.finance_suppliers;
create policy "logistics can read suppliers" on public.finance_suppliers for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);

insert into public.logistics_locations (location_code, location_name, location_type, notes)
select 'WH-001', 'Main Warehouse', 'warehouse', 'Initial logistics location.'
where not exists (select 1 from public.logistics_locations where location_code='WH-001');

-- Warehouse delivery depends on customers, inventory, locations and fleet.
-- SOURCE: 20260921_logistics_warehouse_delivery.sql
-- IBX Logistics warehouse, picking, packing and delivery/dispatch foundation.
create table if not exists public.logistics_delivery_orders (
  id uuid primary key default gen_random_uuid(),
  delivery_number text unique not null,
  customer_id uuid references public.finance_customers(id),
  source_location_id uuid not null references public.logistics_locations(id),
  delivery_date date not null default current_date,
  requested_delivery_date date,
  delivery_address text,
  contact_name text,
  contact_phone text,
  sales_reference text,
  notes text,
  status text not null default 'draft' check (status in ('draft','prepared','picked','packed','reviewed','approved','dispatched','delivered','cancelled')),
  created_by uuid references public.users(id),
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  dispatched_at timestamptz, delivered_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.logistics_delivery_order_items (
  id uuid primary key default gen_random_uuid(),
  delivery_order_id uuid not null references public.logistics_delivery_orders(id) on delete cascade,
  inventory_item_id uuid not null references public.logistics_inventory_items(id),
  quantity numeric(14,3) not null check(quantity > 0),
  picked_quantity numeric(14,3) not null default 0,
  packed_quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  notes text
);
create table if not exists public.logistics_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_number text unique not null,
  delivery_order_id uuid not null references public.logistics_delivery_orders(id),
  vehicle_id uuid references public.fleet_vehicles(id),
  driver_id uuid references public.fleet_drivers(id),
  dispatch_date date not null default current_date,
  departure_time timestamptz,
  expected_arrival timestamptz,
  actual_arrival timestamptz,
  proof_of_delivery_reference text,
  recipient_name text,
  delivery_status text not null default 'planned' check(delivery_status in ('planned','loaded','in_transit','delivered','failed','cancelled')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.logistics_dispatch_items (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.logistics_dispatches(id) on delete cascade,
  delivery_order_item_id uuid not null references public.logistics_delivery_order_items(id),
  quantity numeric(14,3) not null check(quantity > 0)
);
create index if not exists idx_logistics_delivery_status on public.logistics_delivery_orders(status, delivery_date desc);
create index if not exists idx_logistics_delivery_customer on public.logistics_delivery_orders(customer_id, delivery_date desc);
create index if not exists idx_logistics_delivery_items_order on public.logistics_delivery_order_items(delivery_order_id);
create index if not exists idx_logistics_dispatch_status on public.logistics_dispatches(delivery_status, dispatch_date desc);
create index if not exists idx_logistics_dispatch_order on public.logistics_dispatches(delivery_order_id);

alter table public.logistics_delivery_orders enable row level security;
alter table public.logistics_delivery_order_items enable row level security;
alter table public.logistics_dispatches enable row level security;
alter table public.logistics_dispatch_items enable row level security;

drop policy if exists "logistics delivery orders access" on public.logistics_delivery_orders;
create policy "logistics delivery orders access" on public.logistics_delivery_orders for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics delivery items access" on public.logistics_delivery_order_items;
create policy "logistics delivery items access" on public.logistics_delivery_order_items for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics dispatches access" on public.logistics_dispatches;
create policy "logistics dispatches access" on public.logistics_dispatches for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
drop policy if exists "logistics dispatch items access" on public.logistics_dispatch_items;
create policy "logistics dispatch items access" on public.logistics_dispatch_items for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);

-- Logistics needs customer names and fleet assignments when preparing deliveries.
drop policy if exists "logistics can read customers" on public.finance_customers;
create policy "logistics can read customers" on public.finance_customers for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
drop policy if exists "logistics can read fleet vehicles" on public.fleet_vehicles;
create policy "logistics can read fleet vehicles" on public.fleet_vehicles for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
drop policy if exists "logistics can read fleet drivers" on public.fleet_drivers;
create policy "logistics can read fleet drivers" on public.fleet_drivers for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);

-- This migration alters logistics_dispatches, so it MUST follow warehouse
-- delivery, which creates logistics_dispatches.
-- SOURCE: 20260921_logistics_fleet_delivery_operations.sql
-- Logistics/Fleet integration and delivery operations layer.
alter table public.logistics_dispatches
  add column if not exists fleet_trip_id uuid references public.fleet_trips(id),
  add column if not exists route_notes text,
  add column if not exists failed_reason text,
  add column if not exists cancelled_reason text;

create table if not exists public.logistics_delivery_stops (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.logistics_dispatches(id) on delete cascade,
  stop_sequence integer not null check (stop_sequence > 0),
  stop_type text not null default 'delivery' check (stop_type in ('pickup','delivery','return','other')),
  address text not null,
  contact_name text,
  contact_phone text,
  planned_arrival timestamptz,
  actual_arrival timestamptz,
  status text not null default 'planned' check (status in ('planned','arrived','completed','skipped')),
  notes text,
  created_at timestamptz not null default now(),
  unique(dispatch_id, stop_sequence)
);

create table if not exists public.logistics_delivery_events (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.logistics_dispatches(id) on delete cascade,
  event_type text not null check (event_type in ('planned','loaded','departed','arrived','delivered','failed','cancelled','pod_recorded')),
  event_at timestamptz not null default now(),
  location_text text,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_logistics_dispatch_trip on public.logistics_dispatches(fleet_trip_id);
create index if not exists idx_logistics_stops_dispatch on public.logistics_delivery_stops(dispatch_id, stop_sequence);
create index if not exists idx_logistics_events_dispatch on public.logistics_delivery_events(dispatch_id, event_at desc);

alter table public.logistics_delivery_stops enable row level security;
alter table public.logistics_delivery_events enable row level security;

drop policy if exists "logistics delivery stops access" on public.logistics_delivery_stops;
create policy "logistics delivery stops access" on public.logistics_delivery_stops for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
drop policy if exists "logistics delivery events access" on public.logistics_delivery_events;
create policy "logistics delivery events access" on public.logistics_delivery_events for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);

-- Fleet remains owned by Admin; Logistics receives only the read access required for dispatch execution.
drop policy if exists "logistics can read fleet trips" on public.fleet_trips;
create policy "logistics can read fleet trips" on public.fleet_trips for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);

-- ============================================================================
-- 05 MARKETING
-- ============================================================================

-- SOURCE: 20260921_marketing_foundation.sql
-- IBX Marketing foundation: campaigns, channels, leads and marketing activities
do $$ begin
  create type public.marketing_campaign_status as enum ('draft','prepared','reviewed','approved','active','paused','completed','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.marketing_lead_status as enum ('new','qualified','contacted','nurturing','converted','lost');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.marketing_activity_type as enum ('call','email','meeting','social','event','follow_up','other');
exception when duplicate_object then null; end $$;

create table if not exists public.marketing_channels (
  id uuid primary key default gen_random_uuid(),
  channel_code text not null unique,
  channel_name text not null,
  channel_type text not null default 'other',
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique,
  campaign_name text not null,
  objective text,
  campaign_type text not null default 'general',
  channel_id uuid references public.marketing_channels(id),
  owner_id uuid references public.users(id),
  start_date date,
  end_date date,
  budget numeric(14,2) not null default 0,
  expected_revenue numeric(14,2) not null default 0,
  actual_spend numeric(14,2) not null default 0,
  actual_revenue numeric(14,2) not null default 0,
  target_leads integer not null default 0,
  generated_leads integer not null default 0,
  converted_leads integer not null default 0,
  status public.marketing_campaign_status not null default 'draft',
  notes text,
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  lead_code text not null unique,
  campaign_id uuid references public.marketing_campaigns(id),
  channel_id uuid references public.marketing_channels(id),
  company_name text,
  contact_name text not null,
  email text,
  phone text,
  source text,
  estimated_value numeric(14,2) not null default 0,
  status public.marketing_lead_status not null default 'new',
  assigned_to uuid references public.users(id),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete cascade,
  activity_type public.marketing_activity_type not null default 'other',
  activity_date timestamptz not null default now(),
  subject text not null,
  details text,
  outcome text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists marketing_campaigns_status_idx on public.marketing_campaigns(status);
create index if not exists marketing_leads_status_idx on public.marketing_leads(status);
create index if not exists marketing_leads_campaign_idx on public.marketing_leads(campaign_id);
create index if not exists marketing_activities_lead_idx on public.marketing_activities(lead_id);

insert into public.marketing_channels(channel_code, channel_name, channel_type)
values ('DIGITAL','Digital Marketing','digital'),('SOCIAL','Social Media','social'),('EVENT','Events','event'),('REFERRAL','Referral','referral')
on conflict (channel_code) do nothing;

alter table public.marketing_channels enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_leads enable row level security;
alter table public.marketing_activities enable row level security;

drop policy if exists marketing_channels_access on public.marketing_channels;
create policy marketing_channels_access on public.marketing_channels for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);
drop policy if exists marketing_campaigns_access on public.marketing_campaigns;
create policy marketing_campaigns_access on public.marketing_campaigns for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);
drop policy if exists marketing_leads_access on public.marketing_leads;
create policy marketing_leads_access on public.marketing_leads for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);
drop policy if exists marketing_activities_access on public.marketing_activities;
create policy marketing_activities_access on public.marketing_activities for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);

create or replace function public.marketing_refresh_campaign_metrics(p_campaign_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.marketing_campaigns c set
    generated_leads=(select count(*) from public.marketing_leads l where l.campaign_id=c.id),
    converted_leads=(select count(*) from public.marketing_leads l where l.campaign_id=c.id and l.status='converted'),
    updated_at=now()
  where c.id=p_campaign_id;
end; $$;
grant execute on function public.marketing_refresh_campaign_metrics(uuid) to authenticated;

-- ============================================================================
-- 06 SALES
-- ============================================================================

-- Sales pipeline depends on marketing leads, finance customers, employees and
-- logistics inventory items.
-- SOURCE: 20260921_sales_revenue_pipeline.sql
-- IBX Sales / Revenue Pipeline foundation
DO $$ BEGIN CREATE TYPE public.sales_opportunity_status AS ENUM ('open','qualified','proposal','won','lost','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sales_quotation_status AS ENUM ('draft','prepared','reviewed','approved','sent','accepted','rejected','expired','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sales_order_status AS ENUM ('draft','prepared','reviewed','approved','processing','fulfilled','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.sales_commission_status AS ENUM ('draft','prepared','reviewed','approved','paid','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sales_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_number text NOT NULL UNIQUE, lead_id uuid REFERENCES public.marketing_leads(id), customer_id uuid REFERENCES public.finance_customers(id), opportunity_name text NOT NULL, owner_id uuid REFERENCES public.users(id), expected_close_date date, estimated_value numeric(14,2) NOT NULL DEFAULT 0, probability numeric(5,2) NOT NULL DEFAULT 0 CHECK(probability between 0 and 100), status public.sales_opportunity_status NOT NULL DEFAULT 'open', source text, notes text, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sales_quotations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_number text NOT NULL UNIQUE, opportunity_id uuid REFERENCES public.sales_opportunities(id), customer_id uuid NOT NULL REFERENCES public.finance_customers(id), quotation_date date NOT NULL DEFAULT current_date, valid_until date, currency text NOT NULL DEFAULT 'PHP', subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0, other_charges numeric(14,2) NOT NULL DEFAULT 0, total_amount numeric(14,2) GENERATED ALWAYS AS ((subtotal + tax_amount + other_charges) - discount_amount) STORED, status public.sales_quotation_status NOT NULL DEFAULT 'draft', notes text, prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, approved_by uuid REFERENCES public.users(id), approved_at timestamptz, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sales_quotation_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quotation_id uuid NOT NULL REFERENCES public.sales_quotations(id) ON DELETE CASCADE, description text NOT NULL, quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK(quantity>0), unit text NOT NULL DEFAULT 'unit', unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK(unit_price>=0), amount numeric(14,2) GENERATED ALWAYS AS (quantity*unit_price) STORED, notes text
);
CREATE TABLE IF NOT EXISTS public.sales_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number text NOT NULL UNIQUE, quotation_id uuid REFERENCES public.sales_quotations(id), opportunity_id uuid REFERENCES public.sales_opportunities(id), customer_id uuid NOT NULL REFERENCES public.finance_customers(id), order_date date NOT NULL DEFAULT current_date, requested_delivery_date date, delivery_address text, contact_name text, contact_phone text, currency text NOT NULL DEFAULT 'PHP', subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0, other_charges numeric(14,2) NOT NULL DEFAULT 0, total_amount numeric(14,2) GENERATED ALWAYS AS ((subtotal+tax_amount+other_charges)-discount_amount) STORED, status public.sales_order_status NOT NULL DEFAULT 'draft', notes text, prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, approved_by uuid REFERENCES public.users(id), approved_at timestamptz, fulfilled_at timestamptz, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sales_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE, inventory_item_id uuid REFERENCES public.logistics_inventory_items(id), description text NOT NULL, quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK(quantity>0), unit text NOT NULL DEFAULT 'unit', unit_price numeric(14,2) NOT NULL DEFAULT 0 CHECK(unit_price>=0), amount numeric(14,2) GENERATED ALWAYS AS (quantity*unit_price) STORED, notes text
);
CREATE TABLE IF NOT EXISTS public.sales_commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), commission_number text NOT NULL UNIQUE, sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id), employee_id uuid REFERENCES public.employees(id), user_id uuid REFERENCES public.users(id), commission_rate numeric(7,4) NOT NULL DEFAULT 0, commission_base numeric(14,2) NOT NULL DEFAULT 0, commission_amount numeric(14,2) GENERATED ALWAYS AS (commission_base*commission_rate/100) STORED, status public.sales_commission_status NOT NULL DEFAULT 'draft', notes text, prepared_by uuid REFERENCES public.users(id), prepared_at timestamptz, reviewed_by uuid REFERENCES public.users(id), reviewed_at timestamptz, approved_by uuid REFERENCES public.users(id), approved_at timestamptz, paid_at timestamptz, created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_opps_status ON public.sales_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_customer ON public.sales_quotations(customer_id, quotation_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON public.sales_orders(customer_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON public.sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_order ON public.sales_commissions(sales_order_id);

ALTER TABLE public.sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_commissions ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['sales_opportunities','sales_quotations','sales_quotation_items','sales_orders','sales_order_items','sales_commissions'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I_access ON public.%I',t,t); EXECUTE format('CREATE POLICY %I_access ON public.%I FOR ALL USING (public.is_super_admin() OR (select role from public.users where id=auth.uid())=''sales'' OR public.in_section((select id from public.sections where code=''sales''))) WITH CHECK (public.is_super_admin() OR (select role from public.users where id=auth.uid())=''sales'' OR public.in_section((select id from public.sections where code=''sales'')))',t,t); END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.sales_refresh_opportunity(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN UPDATE public.sales_opportunities SET estimated_value=COALESCE((SELECT total_amount FROM public.sales_quotations WHERE opportunity_id=p_id AND status IN ('approved','sent','accepted') ORDER BY created_at DESC LIMIT 1),estimated_value), status=CASE WHEN EXISTS(SELECT 1 FROM public.sales_orders WHERE opportunity_id=p_id AND status NOT IN ('cancelled')) THEN 'won'::public.sales_opportunity_status ELSE status END, updated_at=now() WHERE id=p_id; END; $$;
GRANT EXECUTE ON FUNCTION public.sales_refresh_opportunity(uuid) TO authenticated;

-- Revenue recognition depends on sales orders, delivery orders, AR and
-- accounting journals.
-- SOURCE: 20260921_sales_ar_revenue_integration.sql
-- IBX Sales -> AR / Revenue Recognition + Monthly Sales / Commission integration

create table if not exists public.sales_revenue_recognitions (
  id uuid primary key default gen_random_uuid(),
  recognition_number text not null unique,
  sales_order_id uuid not null references public.sales_orders(id),
  delivery_order_id uuid references public.logistics_delivery_orders(id),
  customer_id uuid not null references public.finance_customers(id),
  ar_invoice_id uuid references public.finance_customer_invoices(id),
  journal_entry_id uuid references public.finance_journal_entries(id),
  recognition_date date not null default current_date,
  revenue_amount numeric(14,2) not null default 0 check (revenue_amount >= 0),
  status text not null default 'draft' check (status in ('draft','prepared','reviewed','approved','posted','cancelled')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sales_order_id)
);

create table if not exists public.sales_monthly_revenue_summary (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id),
  year integer not null check(year between 2000 and 2200),
  month integer not null check(month between 1 and 12),
  fulfilled_orders integer not null default 0,
  gross_revenue numeric(14,2) not null default 0,
  ar_invoiced numeric(14,2) not null default 0,
  cash_collected numeric(14,2) not null default 0,
  commission_accrued numeric(14,2) not null default 0,
  commission_approved numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(section_id, year, month)
);

alter table public.sales_revenue_recognitions enable row level security;
alter table public.sales_monthly_revenue_summary enable row level security;

drop policy if exists sales_revenue_recognition_access on public.sales_revenue_recognitions;
create policy sales_revenue_recognition_access on public.sales_revenue_recognitions for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
);
drop policy if exists sales_monthly_revenue_summary_access on public.sales_monthly_revenue_summary;
create policy sales_monthly_revenue_summary_access on public.sales_monthly_revenue_summary for select using (
  public.is_super_admin() or public.in_section(section_id)
);
drop policy if exists sales_monthly_revenue_summary_admin on public.sales_monthly_revenue_summary;
create policy sales_monthly_revenue_summary_admin on public.sales_monthly_revenue_summary for all using (
  public.is_super_admin()
) with check (public.is_super_admin());

create index if not exists idx_sales_revenue_recognition_order on public.sales_revenue_recognitions(sales_order_id);
create index if not exists idx_sales_revenue_recognition_status on public.sales_revenue_recognitions(status, recognition_date);
create index if not exists idx_sales_monthly_revenue_summary_period on public.sales_monthly_revenue_summary(year, month);

create or replace function public.refresh_sales_monthly_revenue_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path=public as $$
declare v_section uuid; v_start date; v_end date; v_orders integer; v_revenue numeric(14,2); v_ar numeric(14,2); v_cash numeric(14,2); v_comm numeric(14,2); v_comm_approved numeric(14,2);
begin
  select id into v_section from public.sections where code='sales' limit 1;
  if v_section is null then return; end if;
  v_start := make_date(p_year,p_month,1);
  v_end := (v_start + interval '1 month')::date;
  select count(*), coalesce(sum(total_amount),0) into v_orders,v_revenue
    from public.sales_orders where order_date >= v_start and order_date < v_end and status='fulfilled';
  select coalesce(sum(inv.total_amount),0), coalesce(sum(inv.amount_received),0) into v_ar,v_cash
    from public.sales_revenue_recognitions rr join public.finance_customer_invoices inv on inv.id=rr.ar_invoice_id
    where rr.recognition_date >= v_start and rr.recognition_date < v_end and inv.status <> 'voided';
  select coalesce(sum(commission_amount),0), coalesce(sum(commission_amount) filter(where status in ('approved','paid')),0) into v_comm,v_comm_approved
    from public.sales_commissions sc join public.sales_orders so on so.id=sc.sales_order_id
    where so.order_date >= v_start and so.order_date < v_end;
  insert into public.sales_monthly_revenue_summary(section_id,year,month,fulfilled_orders,gross_revenue,ar_invoiced,cash_collected,commission_accrued,commission_approved,updated_at)
  values(v_section,p_year,p_month,v_orders,v_revenue,v_ar,v_cash,v_comm,v_comm_approved,now())
  on conflict(section_id,year,month) do update set
    fulfilled_orders=excluded.fulfilled_orders,gross_revenue=excluded.gross_revenue,ar_invoiced=excluded.ar_invoiced,
    cash_collected=excluded.cash_collected,commission_accrued=excluded.commission_accrued,commission_approved=excluded.commission_approved,updated_at=now();
end; $$;

grant execute on function public.refresh_sales_monthly_revenue_summary(integer,integer) to authenticated;

create or replace function public.create_sales_revenue_draft(p_order_id uuid, p_delivery_id uuid, p_actor uuid, p_recognition_number text, p_invoice_number text)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.sales_orders%rowtype; c uuid; inv uuid; rr uuid; je uuid; revenue numeric(14,2); ar_account uuid; revenue_account uuid; section_id uuid; ddate date;
begin
  select * into o from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if o.status not in ('processing','fulfilled') then raise exception 'Sales order must be in processing or fulfilled status'; end if;
  select id into section_id from public.sections where code='sales' limit 1;
  select id into ar_account from public.finance_chart_of_accounts where account_code='1100' limit 1;
  select id into revenue_account from public.finance_chart_of_accounts where account_code='4000' limit 1;
  if ar_account is null or revenue_account is null then raise exception 'Required AR/revenue accounts are missing'; end if;
  revenue := o.total_amount;
  ddate := coalesce((select delivery_date from public.logistics_delivery_orders where id=p_delivery_id), o.order_date);
  if exists(select 1 from public.sales_revenue_recognitions where sales_order_id=o.id) then raise exception 'Revenue recognition already exists for this order'; end if;
  insert into public.finance_customer_invoices(invoice_number,customer_id,invoice_date,due_date,currency,subtotal,discount_amount,tax_amount,other_charges,status,created_by,notes)
  values(p_invoice_number,o.customer_id,ddate,ddate + 30,o.currency,o.subtotal,o.discount_amount,o.tax_amount,o.other_charges,'draft',p_actor,'Generated from sales order '||o.order_number)
  returning id into inv;
  insert into public.finance_customer_invoice_items(invoice_id,description,quantity,unit,unit_price,notes)
  select inv,description,quantity,unit,unit_price,notes from public.sales_order_items where order_id=o.id;
  insert into public.finance_journal_entries(journal_number,entry_date,description,source_module,source_record_id,section_id,status,total_debit,total_credit,created_by,notes)
  values('JE-SALES-'||replace(p_recognition_number,'REC-',''),ddate,'Revenue recognition - '||o.order_number,'sales_revenue',o.id,section_id,'draft',revenue,revenue,p_actor,'Draft accounting entry generated with AR invoice')
  returning id into je;
  insert into public.finance_journal_lines(journal_entry_id,account_id,line_description,debit,credit,department)
  values(je,ar_account,'Accounts receivable - '||o.order_number,revenue,0,'Sales'),(je,revenue_account,'Sales revenue - '||o.order_number,0,revenue,'Sales');
  insert into public.sales_revenue_recognitions(recognition_number,sales_order_id,delivery_order_id,customer_id,ar_invoice_id,journal_entry_id,recognition_date,revenue_amount,status,created_by)
  values(p_recognition_number,o.id,p_delivery_id,o.customer_id,inv,je,ddate,revenue,'draft',p_actor)
  returning id into rr;
  perform public.recalculate_finance_journal_totals(je);
  if p_delivery_id is not null then update public.sales_orders set status='fulfilled',fulfilled_at=coalesce(fulfilled_at,now()),updated_at=now() where id=o.id; end if;
  return rr;
end; $$;

grant execute on function public.create_sales_revenue_draft(uuid,uuid,uuid,text,text) to authenticated;

-- SOURCE: 20260921_sales_commission_operations_reporting.sql
-- IBX Sales / Commission Operations & Reporting

create table if not exists public.sales_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  payout_number text not null unique,
  employee_id uuid references public.employees(id),
  period_start date not null,
  period_end date not null,
  payout_date date,
  gross_commission numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  net_commission numeric(14,2) generated always as (gross_commission + adjustments) stored,
  payment_reference text,
  status text not null default 'draft' check(status in ('draft','prepared','reviewed','approved','paid','cancelled')),
  notes text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end >= period_start)
);

create table if not exists public.sales_commission_monthly_summary (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id),
  employee_id uuid references public.employees(id),
  year integer not null check(year between 2000 and 2200),
  month integer not null check(month between 1 and 12),
  commission_count integer not null default 0,
  accrued numeric(14,2) not null default 0,
  prepared numeric(14,2) not null default 0,
  reviewed numeric(14,2) not null default 0,
  approved numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0,
  open_amount numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(section_id, employee_id, year, month)
);

alter table public.sales_commission_payouts enable row level security;
alter table public.sales_commission_monthly_summary enable row level security;

drop policy if exists sales_commission_payouts_access on public.sales_commission_payouts;
create policy sales_commission_payouts_access on public.sales_commission_payouts for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
);
drop policy if exists sales_commission_monthly_summary_access on public.sales_commission_monthly_summary;
create policy sales_commission_monthly_summary_access on public.sales_commission_monthly_summary for select using (
  public.is_super_admin() or public.in_section(section_id)
);
drop policy if exists sales_commission_monthly_summary_admin on public.sales_commission_monthly_summary;
create policy sales_commission_monthly_summary_admin on public.sales_commission_monthly_summary for all using (public.is_super_admin()) with check (public.is_super_admin());

create index if not exists idx_sales_commission_payouts_period on public.sales_commission_payouts(period_start, period_end);
create index if not exists idx_sales_commission_payouts_employee on public.sales_commission_payouts(employee_id, status);
create index if not exists idx_sales_commission_summary_period on public.sales_commission_monthly_summary(year, month);

create or replace function public.refresh_sales_commission_monthly_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_section uuid;
  v_start date;
  v_end date;
begin
  select id into v_section from public.sections where code='sales' limit 1;
  if v_section is null then return; end if;
  v_start := make_date(p_year,p_month,1);
  v_end := (v_start + interval '1 month')::date;
  delete from public.sales_commission_monthly_summary where section_id=v_section and year=p_year and month=p_month;
  insert into public.sales_commission_monthly_summary(section_id,employee_id,year,month,commission_count,accrued,prepared,reviewed,approved,paid,open_amount,updated_at)
  select
    v_section, sc.employee_id, p_year, p_month, count(*),
    coalesce(sum(sc.commission_amount),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status in ('prepared','reviewed','approved','paid')),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status in ('reviewed','approved','paid')),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status in ('approved','paid')),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status='paid'),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status not in ('paid','cancelled')),0), now()
  from public.sales_commissions sc
  join public.sales_orders so on so.id=sc.sales_order_id
  where so.order_date >= v_start and so.order_date < v_end
  group by sc.employee_id;
end; $$;
grant execute on function public.refresh_sales_commission_monthly_summary(integer,integer) to authenticated;

create or replace function public.refresh_sales_commission_for_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare y integer; m integer;
begin
  select extract(year from order_date)::integer, extract(month from order_date)::integer into y,m from public.sales_orders where id=p_order_id;
  if y is not null then perform public.refresh_sales_commission_monthly_summary(y,m); end if;
end; $$;
grant execute on function public.refresh_sales_commission_for_order(uuid) to authenticated;

-- ============================================================================
-- 07 APPROVALS / SHARED CORE
-- ============================================================================

-- Approvals depends on fleet_expenses and all operational workflow targets.
-- SOURCE: 20260922_approvals_decision_engine.sql
-- IBX Approvals / Decision Engine
-- Cumulative migration on top of the Sales / Commission Operations build.

-- Fleet expenses previously had no workflow. Add the same approval lifecycle used by Admin expenses.
ALTER TABLE public.fleet_expenses
  ADD COLUMN IF NOT EXISTS status entry_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_fleet_expenses_status ON public.fleet_expenses(status, expense_date DESC);

-- Central decision history. Source records remain the system of record; this table records
-- every central approval decision without changing the source module's schema.
CREATE TABLE IF NOT EXISTS public.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_record_id uuid NOT NULL,
  section_code text NOT NULL,
  action text NOT NULL CHECK (action IN ('reviewed','approved','returned','rejected','posted')),
  from_status text,
  to_status text,
  reason text,
  actor_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_source
  ON public.approval_decisions(source_table, source_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_actor
  ON public.approval_decisions(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_section
  ON public.approval_decisions(section_code, created_at DESC);

ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_decisions_read ON public.approval_decisions;
CREATE POLICY approval_decisions_read ON public.approval_decisions
  FOR SELECT USING (
    public.is_super_admin()
    OR public.in_section((SELECT id FROM public.sections WHERE code = approval_decisions.section_code))
  );

-- Inserts/updates are performed server-side by the decision engine using the service role.
-- No client-side write policy is intentionally exposed.

-- Shared integration is last so workflow/integration registries sit on top of
-- the completed module schema.
-- SOURCE: 20260922_shared_core_integration.sql
-- IBX Shared Core / Cross-Module Integration Foundation
-- Cumulative on top of the Approvals / Decision Engine build.

create table if not exists public.workflow_registry (
  id uuid primary key default gen_random_uuid(),
  module_code text not null,
  module_name text not null,
  section_code text not null,
  workflow_name text not null,
  states text[] not null,
  posting_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(module_code, workflow_name)
);

create index if not exists idx_workflow_registry_section on public.workflow_registry(section_code, active);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  source_module text not null,
  target_module text not null,
  event_type text not null,
  source_table text,
  source_record_id uuid,
  status text not null default 'completed' check (status in ('pending','completed','failed','skipped')),
  message text,
  payload jsonb,
  actor_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_integration_events_created on public.integration_events(created_at desc);
create index if not exists idx_integration_events_status on public.integration_events(status, created_at desc);
create index if not exists idx_integration_events_source on public.integration_events(source_module, target_module, created_at desc);

alter table public.workflow_registry enable row level security;
alter table public.integration_events enable row level security;

-- Workflow metadata is readable to authenticated users; writes are service-role only.
drop policy if exists workflow_registry_read on public.workflow_registry;
create policy workflow_registry_read on public.workflow_registry
  for select using (auth.role() = 'authenticated');

-- Integration events are intentionally visible only to super admins.
drop policy if exists integration_events_read on public.integration_events;
create policy integration_events_read on public.integration_events
  for select using (public.is_super_admin());

-- Server-side integration logger. Source modules remain authoritative; this is the
-- cross-module trace, not a replacement for their own transaction/audit records.
create or replace function public.record_integration_event(
  p_source_module text,
  p_target_module text,
  p_event_type text,
  p_source_table text default null,
  p_source_record_id uuid default null,
  p_status text default 'completed',
  p_message text default null,
  p_payload jsonb default null,
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.integration_events(
    source_module,target_module,event_type,source_table,source_record_id,
    status,message,payload,actor_id,completed_at
  ) values (
    p_source_module,p_target_module,p_event_type,p_source_table,p_source_record_id,
    p_status,p_message,p_payload,p_actor_id,
    case when p_status in ('completed','skipped') then now() else null end
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.record_integration_event(text,text,text,text,uuid,text,text,jsonb,uuid) to authenticated;

-- Registry of the operational workflows built so far.
insert into public.workflow_registry(module_code,module_name,section_code,workflow_name,states,posting_enabled)
values
 ('admin-expenses','Admin Expenses','admin','Expense approval',array['draft','prepared','reviewed','approved'],true),
 ('admin-requests','Internal Requests','admin','Request approval',array['draft','prepared','reviewed','approved','rejected','cancelled','fulfilled'],true),
 ('procurement','Procurement','finance','PR / PO approval',array['draft','prepared','reviewed','approved'],false),
 ('accounts-payable','Accounts Payable','finance','Supplier invoice approval',array['draft','prepared','reviewed','approved','partially_paid','paid','voided'],false),
 ('accounts-payable','Accounts Payable','finance','Supplier payment',array['draft','prepared','reviewed','approved','posted','voided'],true),
 ('accounts-receivable','Accounts Receivable','finance','Customer invoice approval',array['draft','prepared','reviewed','approved'],false),
 ('accounts-receivable','Accounts Receivable','finance','Customer receipt',array['draft','prepared','reviewed','approved','posted','voided'],true),
 ('bank-cash','Bank / Cash','finance','Cash transaction',array['draft','prepared','reviewed','approved','posted','voided'],true),
 ('budgeting','Budgets & Forecasting','finance','Budget approval',array['draft','prepared','reviewed','approved','closed'],false),
 ('accounting','Accounting','finance','Journal entry',array['draft','prepared','reviewed','approved','posted'],true),
 ('payroll','Payroll','finance','Payroll run',array['draft','prepared','reviewed','approved','posted'],true),
 ('inventory','Inventory','logistics','Goods receiving',array['draft','prepared','reviewed','approved','posted'],true),
 ('inventory','Inventory','logistics','Stock transfer',array['draft','prepared','reviewed','approved','posted'],true),
 ('delivery','Delivery','logistics','Delivery order',array['draft','prepared','picked','packed','reviewed','approved','dispatched','delivered'],false),
 ('marketing','Marketing','marketing','Campaign approval',array['draft','prepared','reviewed','approved','active','paused','completed'],false),
 ('sales','Sales','sales','Sales order approval',array['draft','prepared','reviewed','approved'],false),
 ('sales','Sales','sales','Revenue recognition',array['draft','prepared','reviewed','approved','posted'],true),
 ('sales','Sales','sales','Commission',array['draft','prepared','reviewed','approved','paid'],false),
 ('sales','Sales','sales','Commission payout',array['draft','prepared','reviewed','approved','paid'],false)
on conflict(module_code,workflow_name) do update set
  module_name=excluded.module_name,
  section_code=excluded.section_code,
  states=excluded.states,
  posting_enabled=excluded.posting_enabled,
  updated_at=now();
