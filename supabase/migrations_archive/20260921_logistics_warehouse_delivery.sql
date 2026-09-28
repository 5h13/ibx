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

create policy "logistics delivery orders access" on public.logistics_delivery_orders for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics delivery items access" on public.logistics_delivery_order_items for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics dispatches access" on public.logistics_dispatches for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics dispatch items access" on public.logistics_dispatch_items for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);

-- Logistics needs customer names and fleet assignments when preparing deliveries.
create policy "logistics can read customers" on public.finance_customers for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
create policy "logistics can read fleet vehicles" on public.fleet_vehicles for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
create policy "logistics can read fleet drivers" on public.fleet_drivers for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
