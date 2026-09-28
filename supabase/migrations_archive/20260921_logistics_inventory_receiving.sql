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
create policy "logistics locations access" on public.logistics_locations for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics inventory access" on public.logistics_inventory_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics receipts access" on public.logistics_receipts for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics receipt items access" on public.logistics_receipt_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics stock movements access" on public.logistics_stock_movements for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics transfers access" on public.logistics_stock_transfers for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);
create policy "logistics transfer items access" on public.logistics_stock_transfer_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='logistics')
);

-- Logistics can read approved procurement records for receiving.
create policy "logistics can read purchase orders" on public.purchase_orders for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
create policy "logistics can read purchase order items" on public.purchase_order_items for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
create policy "logistics can read suppliers" on public.finance_suppliers for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);

insert into public.logistics_locations (location_code, location_name, location_type, notes)
select 'WH-001', 'Main Warehouse', 'warehouse', 'Initial logistics location.'
where not exists (select 1 from public.logistics_locations where location_code='WH-001');
