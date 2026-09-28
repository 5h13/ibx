-- ============================================================================
-- SF-23 — Inventory valued at WEIGHTED AVERAGE COST per item per business.
--
-- Decided by the user:
--   * Stock is valued at weighted average cost, per item, per store
--     (business). The category add-on is a pricing margin only and is NOT
--     part of cost, so cost comes only from what was actually paid on
--     goods receipts (and, later, the opening-stock counts of LOG-46).
--   * new_avg = (basis_qty*old_avg + qty_in*unit_cost) / (basis_qty + qty_in)
--     where basis_qty = the item's on-hand across the business BEFORE the
--     receipt, floored at 0 (negative stock is allowed pre-go-live; with
--     on-hand <= 0 the new average is simply the receipt cost).
--
-- Design:
--   inventory_item_costs      one row per (business, item): the current
--                             average. Read via RLS (business_row_visible);
--                             no direct writes — definer functions only.
--   inventory_cost_history    audit trail, one row per costed inflow; its
--                             unique (business, item, source, source_id)
--                             key is what makes costing idempotent.
--   inventory_cost_receive()  the single entry point that moves the
--                             average. Receipt posting reaches it through
--                             the ledger trigger below; a future opening-
--                             stock entry (LOG-46) calls it directly with
--                             source 'opening_stock'. Not callable by
--                             app users (internal, definer-to-definer).
--   inventory_unit_cost()     read API for callers (e.g. Storefront cost of
--                             sales): the average, or NULL when the item has
--                             never been costed (callers fall back to their
--                             pricing cost).
--
-- Hook: AFTER INSERT trigger on logistics_stock_movements for movement_type
-- 'receipt'. post_receipt_to_stock() is the only writer of receipt
-- movements and inserts them with ON CONFLICT DO NOTHING against
-- uq_stock_movement_source_line, and movements are immutable
-- (guard_stock_movement), so a receipt line produces exactly one inserted
-- row exactly once — re-posting inserts nothing, fires nothing. The history
-- key is a second guard. Hooking the ledger (rather than the receipt status
-- change) also means the cost is taken from the same row the stock is, in
-- the same transaction, and post_receipt_to_stock itself is left untouched.
--
-- Unit cost: the receipt line's unit_cost (the receiving form pre-fills it
-- from the PO line). If that is 0 and the receipt is against a PO, the PO
-- line's unit_cost for the same catalog item is used. If still 0 the inflow
-- is not costed (logged in history with new_avg = old_avg) so a missing
-- price cannot drag the average toward zero.
-- ============================================================================

create table if not exists public.inventory_item_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  item_id uuid not null references public.logistics_inventory_items(id) on delete cascade,
  avg_cost numeric(14,4) not null,
  qty_on_hand_basis numeric not null default 0,   -- floored on-hand after the last costed inflow
  last_source text,
  last_source_id uuid,
  updated_at timestamptz not null default now(),
  unique (business_id, item_id)
);
comment on table public.inventory_item_costs is
  'SF-23 weighted average cost per item per business. Written only by inventory_cost_receive(); read via inventory_unit_cost() or RLS.';

create table if not exists public.inventory_cost_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  item_id uuid not null references public.logistics_inventory_items(id) on delete cascade,
  entry_date date not null,
  qty_in numeric not null,
  unit_cost numeric(14,4),
  basis_qty numeric not null,             -- on-hand before the inflow, floored at 0
  old_avg numeric(14,4),
  new_avg numeric(14,4),
  source text not null,                   -- 'logistics_receipts' | 'opening_stock' | ...
  source_id uuid,
  stock_movement_id uuid references public.logistics_stock_movements(id),
  costed boolean not null default true,   -- false = inflow had no usable unit cost
  created_at timestamptz not null default now()
);
create unique index if not exists uq_inventory_cost_history_source
  on public.inventory_cost_history(business_id, item_id, source, source_id)
  where source_id is not null;
create index if not exists idx_inventory_cost_history_item
  on public.inventory_cost_history(business_id, item_id, entry_date, created_at);

alter table public.inventory_item_costs enable row level security;
alter table public.inventory_cost_history enable row level security;

drop policy if exists inventory_item_costs_read on public.inventory_item_costs;
create policy inventory_item_costs_read on public.inventory_item_costs
  for select to authenticated using (public.business_row_visible(business_id));
drop policy if exists inventory_cost_history_read on public.inventory_cost_history;
create policy inventory_cost_history_read on public.inventory_cost_history
  for select to authenticated using (public.business_row_visible(business_id));

-- No direct writes: only SELECT is granted; writes happen in definer functions.
revoke all on public.inventory_item_costs from public, anon, authenticated;
revoke all on public.inventory_cost_history from public, anon, authenticated;
grant select on public.inventory_item_costs to authenticated;
grant select on public.inventory_cost_history to authenticated;

-- Business-wide on-hand of an item from the ledger (same sign rules as
-- logistics_stock_balance), optionally excluding one movement.
create or replace function public.inventory_business_on_hand(p_business uuid, p_item uuid, p_exclude_movement uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when sm.movement_type in ('receipt','transfer_in','adjustment') then sm.quantity else -sm.quantity end), 0)
    from public.logistics_stock_movements sm
   where sm.business_id = p_business and sm.inventory_item_id = p_item
     and (p_exclude_movement is null or sm.id <> p_exclude_movement);
$$;
revoke all on function public.inventory_business_on_hand(uuid, uuid, uuid) from public, anon, authenticated;

-- The one place the average moves. Receipts (via trigger) and the future
-- opening-stock entry (LOG-46) both call this.
--   p_basis_qty: on-hand BEFORE this inflow. NULL = read the current ledger
--   on-hand, i.e. call it BEFORE inserting the inflow's own movement, or pass
--   the value explicitly (the receipt trigger does, excluding its own row).
-- Returns the resulting average (NULL if the item is still uncosted).
create or replace function public.inventory_cost_receive(
  p_business uuid, p_item uuid, p_qty numeric, p_unit_cost numeric,
  p_source text, p_source_id uuid default null, p_date date default null,
  p_basis_qty numeric default null, p_movement_id uuid default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_item_business uuid; v_old numeric; v_basis numeric; v_new numeric; v_costed boolean;
begin
  if p_business is null or p_item is null or p_source is null then
    raise exception 'inventory_cost_receive: business, item and source are required.';
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'inventory_cost_receive: quantity must be positive.'; end if;
  select business_id into v_item_business from public.logistics_inventory_items where id = p_item;
  if v_item_business is distinct from p_business then
    raise exception 'inventory_cost_receive: item does not belong to that business.';
  end if;

  -- serialize per (business, item) so concurrent postings average correctly
  perform pg_advisory_xact_lock(hashtext('invcost:' || p_business::text), hashtext(p_item::text));

  if p_source_id is not null and exists (
       select 1 from public.inventory_cost_history
        where business_id = p_business and item_id = p_item and source = p_source and source_id = p_source_id) then
    return (select avg_cost from public.inventory_item_costs where business_id = p_business and item_id = p_item);
  end if;

  select avg_cost into v_old from public.inventory_item_costs
   where business_id = p_business and item_id = p_item for update;
  v_basis := greatest(coalesce(p_basis_qty, public.inventory_business_on_hand(p_business, p_item)), 0);
  v_costed := coalesce(p_unit_cost, 0) > 0;

  if not v_costed then
    v_new := v_old;                                   -- no usable cost: leave the average alone
  elsif v_old is null or v_basis = 0 then
    v_new := round(p_unit_cost, 4);
  else
    v_new := round((v_basis * v_old + p_qty * p_unit_cost) / (v_basis + p_qty), 4);
  end if;

  insert into public.inventory_cost_history(business_id, item_id, entry_date, qty_in, unit_cost, basis_qty,
                                            old_avg, new_avg, source, source_id, stock_movement_id, costed)
  values (p_business, p_item, coalesce(p_date, (now() at time zone 'Asia/Manila')::date), p_qty,
          case when v_costed then round(p_unit_cost, 4) end, v_basis, v_old, v_new, p_source, p_source_id, p_movement_id, v_costed);

  if v_costed then
    insert into public.inventory_item_costs(business_id, item_id, avg_cost, qty_on_hand_basis, last_source, last_source_id, updated_at)
    values (p_business, p_item, v_new, v_basis + p_qty, p_source, p_source_id, now())
    on conflict (business_id, item_id) do update
      set avg_cost = excluded.avg_cost, qty_on_hand_basis = excluded.qty_on_hand_basis,
          last_source = excluded.last_source, last_source_id = excluded.last_source_id, updated_at = now();
  end if;
  return v_new;
end $$;
revoke all on function public.inventory_cost_receive(uuid, uuid, numeric, numeric, text, uuid, date, numeric, uuid) from public, anon, authenticated;

-- Unit cost of a receipt movement: the line cost, else the PO line cost.
create or replace function public.inventory_receipt_unit_cost(p_movement public.logistics_stock_movements)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(p_movement.unit_cost, 0),
    (select nullif(max(poi.unit_cost), 0)
       from public.logistics_receipts r
       join public.logistics_inventory_items ii on ii.id = p_movement.inventory_item_id
       join public.purchase_order_items poi on poi.purchase_order_id = r.purchase_order_id
                                           and poi.item_id = ii.procurement_item_id
      where p_movement.source_table = 'logistics_receipts'
        and r.id = p_movement.source_record_id
        and r.purchase_order_id is not null),
    0);
$$;
revoke all on function public.inventory_receipt_unit_cost(public.logistics_stock_movements) from public, anon, authenticated;

create or replace function public.inventory_cost_on_receipt_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- same lock inventory_cost_receive takes, held before the basis is read
  perform pg_advisory_xact_lock(hashtext('invcost:' || new.business_id::text), hashtext(new.inventory_item_id::text));
  perform public.inventory_cost_receive(
    new.business_id, new.inventory_item_id, new.quantity,
    public.inventory_receipt_unit_cost(new),
    coalesce(new.source_table, 'logistics_stock_movements'),
    coalesce(new.source_record_id, new.id),
    new.movement_date,
    public.inventory_business_on_hand(new.business_id, new.inventory_item_id, new.id),
    new.id);
  return null;
end $$;
revoke all on function public.inventory_cost_on_receipt_movement() from public, anon, authenticated;

drop trigger if exists logistics_stock_movement_weighted_cost on public.logistics_stock_movements;
create trigger logistics_stock_movement_weighted_cost
after insert on public.logistics_stock_movements
for each row when (new.movement_type = 'receipt')
execute function public.inventory_cost_on_receipt_movement();

-- Read API. Own business only (Global Super Admin: any business).
create or replace function public.inventory_unit_cost(p_business uuid, p_item uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if p_business is null or p_item is null then return null; end if;
  if not public.is_super_admin() and p_business is distinct from public.current_business_id() then
    raise exception 'Not allowed to read another business''s inventory cost.';
  end if;
  return (select avg_cost from public.inventory_item_costs where business_id = p_business and item_id = p_item);
end $$;
revoke all on function public.inventory_unit_cost(uuid, uuid) from public, anon;
grant execute on function public.inventory_unit_cost(uuid, uuid) to authenticated, service_role;

-- Backfill from receipt movements already in the ledger, in date order. The
-- basis for each is the on-hand from every movement ordered before it.
create or replace function public.inventory_cost_backfill()
returns integer language plpgsql security definer set search_path = public as $$
declare m public.logistics_stock_movements%rowtype; v_basis numeric; n int := 0;
begin
  for m in
    select sm.* from public.logistics_stock_movements sm
     where sm.movement_type = 'receipt'
     order by sm.movement_date, sm.created_at, sm.id
  loop
    select coalesce(sum(case when x.movement_type in ('receipt','transfer_in','adjustment') then x.quantity else -x.quantity end), 0)
      into v_basis
      from public.logistics_stock_movements x
     where x.business_id = m.business_id and x.inventory_item_id = m.inventory_item_id
       and (x.movement_date, x.created_at, x.id) < (m.movement_date, m.created_at, m.id);
    perform public.inventory_cost_receive(
      m.business_id, m.inventory_item_id, m.quantity, public.inventory_receipt_unit_cost(m),
      coalesce(m.source_table, 'logistics_stock_movements'), coalesce(m.source_record_id, m.id),
      m.movement_date, v_basis, m.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.inventory_cost_backfill() from public, anon, authenticated;

-- Already-costed sources are skipped (history key), so re-running is a no-op.
do $$ begin raise notice 'SF-23 backfill: % receipt movement(s) visited', public.inventory_cost_backfill(); end $$;
