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
create trigger fleet_vehicles_updated_at before update on public.fleet_vehicles for each row execute function public.set_fleet_updated_at();
drop trigger if exists fleet_drivers_updated_at on public.fleet_drivers;
create trigger fleet_drivers_updated_at before update on public.fleet_drivers for each row execute function public.set_fleet_updated_at();
drop trigger if exists fleet_trips_updated_at on public.fleet_trips;
create trigger fleet_trips_updated_at before update on public.fleet_trips for each row execute function public.set_fleet_updated_at();

alter table public.fleet_vehicles enable row level security;
alter table public.fleet_drivers enable row level security;
alter table public.fleet_assignments enable row level security;
alter table public.fleet_trips enable row level security;
alter table public.fleet_expenses enable row level security;
alter table public.fleet_maintenance enable row level security;

create policy fleet_vehicles_admin_all on public.fleet_vehicles for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy fleet_drivers_admin_all on public.fleet_drivers for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy fleet_assignments_admin_all on public.fleet_assignments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy fleet_trips_admin_all on public.fleet_trips for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy fleet_expenses_admin_all on public.fleet_expenses for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy fleet_maintenance_admin_all on public.fleet_maintenance for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
