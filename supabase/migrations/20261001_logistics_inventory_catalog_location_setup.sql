-- Consolidated implementation: logistics inventory is an operational reference to
-- the shared Product/Procurement catalog, with location-specific reorder settings.
create table if not exists public.logistics_inventory_location_settings (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.logistics_inventory_items(id) on delete cascade,
  location_id uuid not null references public.logistics_locations(id) on delete cascade,
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, location_id)
);
create index if not exists idx_logistics_inventory_location_settings_location
  on public.logistics_inventory_location_settings(location_id, active);
create index if not exists idx_logistics_inventory_location_settings_item
  on public.logistics_inventory_location_settings(inventory_item_id, active);
alter table public.logistics_inventory_location_settings enable row level security;
drop policy if exists "logistics inventory location settings access" on public.logistics_inventory_location_settings;
create policy "logistics inventory location settings access"
  on public.logistics_inventory_location_settings for all using (
    public.is_super_admin() or public.has_section_access('logistics')
  ) with check (
    public.is_super_admin() or public.has_section_access('logistics')
  );
