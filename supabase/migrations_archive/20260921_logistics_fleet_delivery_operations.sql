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

create policy "logistics delivery stops access" on public.logistics_delivery_stops for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
create policy "logistics delivery events access" on public.logistics_delivery_events for all using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
) with check (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);

-- Fleet remains owned by Admin; Logistics receives only the read access required for dispatch execution.
create policy "logistics can read fleet trips" on public.fleet_trips for select using (
 public.is_super_admin() or (select role from public.users where id=auth.uid())='logistics' or public.in_section((select id from public.sections where code='logistics'))
);
