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
create trigger supply_categories_set_updated_at before update on public.supply_categories for each row execute function public.set_admin_supplies_updated_at();
drop trigger if exists supplies_set_updated_at on public.supplies;
create trigger supplies_set_updated_at before update on public.supplies for each row execute function public.set_admin_supplies_updated_at();
drop trigger if exists internal_requests_set_updated_at on public.internal_requests;
create trigger internal_requests_set_updated_at before update on public.internal_requests for each row execute function public.set_admin_supplies_updated_at();

alter table public.supply_categories enable row level security;
alter table public.supplies enable row level security;
alter table public.supply_transactions enable row level security;
alter table public.internal_request_categories enable row level security;
alter table public.internal_requests enable row level security;
alter table public.internal_request_items enable row level security;

create policy supply_categories_admin_all on public.supply_categories for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy supplies_admin_all on public.supplies for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy supply_transactions_admin_all on public.supply_transactions for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy internal_request_categories_admin_all on public.internal_request_categories for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy internal_requests_admin_all on public.internal_requests for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
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
