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
create trigger asset_categories_set_updated_at before update on public.asset_categories for each row execute function public.set_assets_updated_at();
drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at before update on public.assets for each row execute function public.set_assets_updated_at();

alter table public.asset_categories enable row level security;
alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;

create policy asset_categories_admin_all on public.asset_categories for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy assets_admin_all on public.assets for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
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
