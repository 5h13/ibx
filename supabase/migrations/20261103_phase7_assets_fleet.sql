-- Phase 7 (Assets, Supplies, Fleet) of the remaining-punchlist implementation
-- plan: U025 (Assets/Supplies <-> Procurement), U026 (Procurement ->
-- Receiving), U027 (Asset Lifecycle), U029 (Asset Procurement
-- Traceability), U030 (Asset Maintenance History), U031 (Asset
-- Identification), U036 (Fleet Maintenance Request Integration).
--
-- U025/U026/U029 — assets and supplies were disconnected islands from
-- Procurement: only a free-text `supplier` column, no FK to the shared
-- `finance_suppliers` master, and no link back to the PO/receipt an asset
-- or supply item was actually acquired through. Same pattern as U004's
-- fix for expenses.vendor: add an optional FK alongside the existing
-- free-text column (kept as the non-catalog-supplier fallback, not
-- replaced), plus optional traceability links to the source PO/receipt.
--
-- U027 — assets.status was a real enum-driven state machine with no gap
-- at the type level, but had no DB-enforced transition guard and no
-- required reason on retiring/disposing an asset (an admin could flip
-- straight to 'disposed' with a bare status dropdown). Added a trigger
-- requiring a reason on retire and a disposal date on dispose, and making
-- 'disposed' a true terminal state (no further status changes), the same
-- discipline as guard_employee_status_transition() (Build 48).
--
-- U030 — fleet_maintenance already existed and worked for vehicles; there
-- was no equivalent table for general (non-fleet) assets at all. New
-- asset_maintenance table mirrors fleet_maintenance's shape exactly.
--
-- U031 — asset_no was a plain unique text column the admin typed in by
-- hand (free-text, user-editable) — unlike every other numbered entity in
-- this codebase (PR/PO/receipt/transfer/employee numbers), which are all
-- system-generated and immutable via a guard_X_number()/next_X_number()
-- trigger pair. Brought asset_no into that same established pattern:
-- AST-#### format.
--
-- U036 — no maintenance-*request* workflow existed anywhere (only
-- direct, already-completed admin-recorded maintenance). Rather than
-- build a second, parallel request/approval table, this reuses the
-- existing generic internal_requests draft/prepared/reviewed/approved/
-- rejected/fulfilled engine (the same "delegate to one authoritative
-- mechanism, don't duplicate workflow machinery" principle already
-- applied to PR-10/PR-11/PO-11 in Build 44): a nullable `vehicle_id` FK
-- on internal_requests plus a new 'fleet_maintenance' request category
-- lets an employee file "this vehicle needs service" through the exact
-- same review/approval chain every other internal request already goes
-- through. A nullable `request_id` FK on fleet_maintenance closes the
-- loop, linking the eventual completed maintenance record back to the
-- request that triggered it.

-- ============================================================================
-- U025/U026/U029 — Procurement linkage on assets and supplies
-- ============================================================================

alter table public.assets
  add column if not exists supplier_id uuid references public.finance_suppliers(id) on delete set null,
  add column if not exists source_po_id uuid references public.purchase_orders(id) on delete set null,
  add column if not exists source_receipt_id uuid references public.logistics_receipts(id) on delete set null;

alter table public.supplies
  add column if not exists supplier_id uuid references public.finance_suppliers(id) on delete set null,
  add column if not exists source_po_id uuid references public.purchase_orders(id) on delete set null,
  add column if not exists source_receipt_id uuid references public.logistics_receipts(id) on delete set null;

create index if not exists assets_source_po_idx on public.assets(source_po_id);
create index if not exists assets_source_receipt_idx on public.assets(source_receipt_id);
create index if not exists assets_supplier_idx on public.assets(supplier_id);
create index if not exists supplies_source_po_idx on public.supplies(source_po_id);
create index if not exists supplies_source_receipt_idx on public.supplies(source_receipt_id);
create index if not exists supplies_supplier_idx on public.supplies(supplier_id);

-- ============================================================================
-- U027 — Asset lifecycle: required reason on retire/dispose, disposed is terminal
-- ============================================================================

alter table public.assets
  add column if not exists retirement_reason text,
  add column if not exists disposal_date date,
  add column if not exists disposal_value numeric(14,2) check (disposal_value is null or disposal_value >= 0);

create or replace function public.guard_asset_status_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if old.status = 'disposed' then
      raise exception 'A disposed asset cannot change status further.';
    end if;
    if new.status = 'retired' and (new.retirement_reason is null or btrim(new.retirement_reason) = '') then
      raise exception 'A retirement reason is required to retire an asset.';
    end if;
    if new.status = 'disposed' and new.disposal_date is null then
      raise exception 'A disposal date is required to dispose an asset.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists assets_guard_status_transition on public.assets;
create trigger assets_guard_status_transition
before update on public.assets
for each row execute function public.guard_asset_status_transition();

-- ============================================================================
-- U030 — Asset Maintenance History (general assets, mirrors fleet_maintenance)
-- ============================================================================

create table if not exists public.asset_maintenance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  asset_id uuid not null references public.assets(id) on delete restrict,
  service_date date not null default current_date,
  service_type text not null,
  description text not null,
  vendor text,
  cost numeric(14,2) check (cost is null or cost >= 0),
  next_service_date date,
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists asset_maintenance_asset_idx on public.asset_maintenance(asset_id, service_date desc);

alter table public.asset_maintenance enable row level security;

drop policy if exists asset_maintenance_admin_all on public.asset_maintenance;
create policy asset_maintenance_admin_all on public.asset_maintenance
  for all
  using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')))
  with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

drop policy if exists asset_maintenance_business_isolation on public.asset_maintenance;
create policy asset_maintenance_business_isolation on public.asset_maintenance
  as restrictive for all
  using (public.is_super_admin() or business_id = public.current_business_id())
  with check (public.is_super_admin() or business_id = public.current_business_id());

-- ============================================================================
-- U031 — Asset Identification: system-generated, immutable asset_no (AST-####)
-- ============================================================================

-- security definer + search_path, matching next_employee_no()'s established
-- pattern exactly: this MUST run with elevated visibility across the whole
-- assets table, not just the caller's own business, because asset_no is a
-- single globally-unique sequence (not scoped per business_id). Without
-- security definer, a non-super-admin business user's RLS-filtered view of
-- `assets` only shows rows in their own business, so max(asset_no) would be
-- computed from a partial table and collide with other businesses' numbers
-- (reproduced directly during Phase 7 verification: a second business's
-- insert generated the same AST-0001 already used by the first business and
-- failed on the unique constraint). The advisory lock likewise mirrors
-- next_employee_no(), serializing concurrent number generation so two
-- simultaneous inserts can't compute the same next value.
create or replace function public.next_asset_no()
returns text language plpgsql security definer set search_path to 'public' as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('AST'));
  select coalesce(max(substring(asset_no from 5)::bigint), 0) + 1 into n
  from public.assets
  where asset_no ~ '^AST-[0-9]{4,}$';
  return 'AST-' || lpad(n::text, 4, '0');
exception when others then
  return 'AST-' || lpad((extract(epoch from clock_timestamp())::bigint % 100000)::text, 5, '0');
end; $$;

create or replace function public.guard_asset_no()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and (new.asset_no is null or btrim(new.asset_no) = '') then
    new.asset_no := public.next_asset_no();
  end if;
  if tg_op = 'UPDATE' and new.asset_no is distinct from old.asset_no then
    raise exception 'Asset number is system-controlled and immutable.';
  end if;
  return new;
end; $$;

alter table public.assets alter column asset_no drop not null;
alter table public.assets alter column asset_no set default public.next_asset_no();

drop trigger if exists assets_guard_asset_no on public.assets;
create trigger assets_guard_asset_no
before insert or update on public.assets
for each row execute function public.guard_asset_no();

alter table public.assets alter column asset_no set not null;

-- ============================================================================
-- U036 — Fleet Maintenance Request Integration (via the generic internal_requests engine)
-- ============================================================================

alter table public.internal_requests
  add column if not exists vehicle_id uuid references public.fleet_vehicles(id) on delete set null;

alter table public.fleet_maintenance
  add column if not exists request_id uuid references public.internal_requests(id) on delete set null;

insert into public.internal_request_categories (code, name, description)
values ('fleet_maintenance', 'Fleet Maintenance Request', 'Request service or repair for a fleet vehicle; routes through the standard internal-request review/approval chain before being recorded as actual maintenance.')
on conflict (code) do nothing;
