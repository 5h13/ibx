-- ============================================================================
-- Build 78 — lots on every item (U062 / LOG-23, decided by the owner 2026-10-02)
--
--   • A lot is one purchase: every posted receipt line becomes a lot with its
--     own supplier, purchase price, received date and quantity. The opening
--     count at go-live is the first lot of each item.
--   • Every stock movement records its lot (logistics_stock_movements.lot_id).
--     Transfers move a chosen lot (or the oldest lots first); counter sales
--     and order DRs record the lot the cashier picked; returns go back into
--     the lot they were sold from.
--   • Lot balances per location are always computed from the movements, like
--     every other stock figure (never typed in).
--   • Cost of sales stays at the weighted average per item per store (owner's
--     decision 2026-10-02). Lots are for tracing, aging and purchase-price
--     history; a lot's purchase price is visible only to users who may see
--     cost (Finance / admins), like the rest of the inventory cost data.
--   • Stock that left before lots existed, or was sold while no lot had stock,
--     shows as "No lot". The approved opening count at go-live clears it: the
--     counted quantity is matched to the lots and the rest becomes the
--     opening lot.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lots
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  inventory_item_id uuid not null references public.logistics_inventory_items(id),
  lot_code text not null,
  source text not null check (source in ('receipt', 'opening', 'count', 'legacy')),
  receipt_id uuid references public.logistics_receipts(id),
  receipt_item_id uuid references public.logistics_receipt_items(id),
  purchase_order_id uuid references public.purchase_orders(id),
  opening_count_id uuid references public.inventory_opening_counts(id),
  opening_count_line_id uuid references public.inventory_opening_count_lines(id),
  supplier_id uuid references public.finance_suppliers(id),
  supplier_lot_no text,
  expiry_date date,
  unit_cost numeric(14,4) not null default 0,
  received_date date not null,
  received_qty numeric(14,3) not null,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint inventory_lots_code_key unique (business_id, lot_code),
  constraint inventory_lots_receipt_item_key unique (receipt_item_id)
);
create index if not exists idx_inventory_lots_item on public.inventory_lots (business_id, inventory_item_id, received_date);
create index if not exists idx_inventory_lots_supplier on public.inventory_lots (supplier_id);
comment on table public.inventory_lots is
  'Build 78: one row per purchase (receipt line) or opening / count lot. Balances come from logistics_stock_movements.lot_id.';

alter table public.inventory_lots enable row level security;
drop policy if exists inventory_lots_read on public.inventory_lots;
-- the lot row carries the purchase price: readable only by users who may see cost
create policy inventory_lots_read on public.inventory_lots
  for select to authenticated using (public.business_row_visible(business_id) and public.can_view_inventory_cost());
revoke all on public.inventory_lots from public, anon, authenticated;
grant select on public.inventory_lots to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Movements, transfer lines and sale lines record their lot
-- ---------------------------------------------------------------------------
alter table public.logistics_stock_movements add column if not exists lot_id uuid references public.inventory_lots(id);
create index if not exists idx_logistics_movements_lot_id on public.logistics_stock_movements (lot_id, location_id);
alter table public.logistics_stock_transfer_items add column if not exists lot_id uuid references public.inventory_lots(id);
alter table public.logistics_stock_transfer_items add column if not exists lot_code text;   -- shown to Logistics, who cannot read lot rows
alter table public.storefront_sale_items add column if not exists lot_id uuid references public.inventory_lots(id);
-- SF-29 (used by the trace below; rules in 20261209)
alter table public.storefront_sales add column if not exists hardcopy_dr_no text;

-- one movement per source + item + location + type + LOT (a receipt with two
-- lines of the same item now posts two lots)
drop index if exists public.uq_stock_movement_source_line;
create unique index if not exists uq_stock_movement_source_lot
  on public.logistics_stock_movements (source_table, source_record_id, inventory_item_id, location_id, movement_type,
                                       (coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  where source_table is not null and source_record_id is not null;

-- movements stay immutable, lot included; a lot must belong to the movement's item and business
create or replace function public.guard_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lot record;
begin
  if tg_op = 'INSERT' then
    new.movement_number := public.next_stock_movement_number();
  end if;
  if tg_op = 'UPDATE' and (
    new.movement_number is distinct from old.movement_number or
    new.inventory_item_id is distinct from old.inventory_item_id or
    new.location_id is distinct from old.location_id or
    new.quantity is distinct from old.quantity or
    new.movement_type is distinct from old.movement_type or
    new.source_table is distinct from old.source_table or
    new.source_record_id is distinct from old.source_record_id or
    new.lot_id is distinct from old.lot_id
  ) then
    raise exception 'Posted stock movements are immutable; create an authorized correcting movement.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Posted stock movements cannot be deleted; create an authorized correcting movement.';
  end if;
  if tg_op = 'INSERT' and new.lot_id is not null then
    select business_id, inventory_item_id, lot_code into v_lot from public.inventory_lots where id = new.lot_id;
    if not found or v_lot.business_id <> new.business_id or v_lot.inventory_item_id <> new.inventory_item_id then
      raise exception 'Lot % is not a lot of this item in this store.', coalesce(v_lot.lot_code, new.lot_id::text);
    end if;
    new.lot_number := v_lot.lot_code;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.inventory_next_lot_code(p_business uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_prefix text; n bigint; yr text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYY');
begin
  select code into v_code from public.businesses where id = p_business;
  if v_code is null then raise exception 'Unknown business for the lot.'; end if;
  v_prefix := v_code || '-LOT-' || yr;
  perform pg_advisory_xact_lock(hashtext('lot:' || v_prefix));
  select coalesce(max(substring(lot_code from length(v_prefix) + 2)::bigint), 0) + 1 into n
    from public.inventory_lots where business_id = p_business and lot_code ~ ('^' || v_prefix || '-[0-9]{6,}$');
  return v_prefix || '-' || lpad(n::text, 6, '0');
end $$;

create or replace function public.inventory_create_lot(p_business uuid, p_item uuid, p_source text, p_qty numeric, p_unit_cost numeric, p_date date,
  p_supplier uuid default null, p_receipt uuid default null, p_receipt_item uuid default null, p_po uuid default null,
  p_count uuid default null, p_count_line uuid default null, p_supplier_lot text default null, p_expiry date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.inventory_lots(business_id, inventory_item_id, lot_code, source, receipt_id, receipt_item_id, purchase_order_id, opening_count_id,
                                    opening_count_line_id, supplier_id, supplier_lot_no, expiry_date, unit_cost, received_date, received_qty, notes, created_by)
  values (p_business, p_item, public.inventory_next_lot_code(p_business), p_source, p_receipt, p_receipt_item, p_po, p_count, p_count_line, p_supplier,
          nullif(btrim(coalesce(p_supplier_lot, '')), ''), p_expiry, round(coalesce(p_unit_cost, 0), 4), coalesce(p_date, (now() at time zone 'Asia/Manila')::date),
          p_qty, p_notes, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- signed quantity of one movement
create or replace function public.stock_qty_sign(p_type text, p_qty numeric)
returns numeric language sql immutable as $$
  select case when p_type in ('receipt','transfer_in','adjustment') then p_qty else -p_qty end;
$$;

-- lot balance at a location (all locations when p_location is null)
create or replace function public.inventory_lot_on_hand(p_lot uuid, p_location uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.stock_qty_sign(movement_type, quantity)), 0)
    from public.logistics_stock_movements
   where lot_id = p_lot and (p_location is null or location_id = p_location);
$$;

-- per lot (or "no lot") balance of one item at one location
create or replace function public.inventory_item_lot_balances(p_business uuid, p_item uuid, p_location uuid)
returns table(lot_id uuid, on_hand numeric) language sql stable security definer set search_path = public as $$
  select sm.lot_id, sum(public.stock_qty_sign(sm.movement_type, sm.quantity))
    from public.logistics_stock_movements sm
   where sm.business_id = p_business and sm.inventory_item_id = p_item and sm.location_id = p_location
   group by sm.lot_id;
$$;

-- oldest lot with stock at the location (first in, first out); null when no lot has stock
create or replace function public.inventory_oldest_lot(p_business uuid, p_item uuid, p_location uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.id from public.inventory_item_lot_balances(p_business, p_item, p_location) b
    join public.inventory_lots l on l.id = b.lot_id
   where b.on_hand > 0
   order by l.received_date, l.lot_code
   limit 1;
$$;

-- balance view: one row per business / item / location / lot (no cost; RLS of the movements applies)
create or replace view public.inventory_lot_balances with (security_invoker = true) as
  select sm.business_id, sm.inventory_item_id, sm.location_id, sm.lot_id,
         sum(public.stock_qty_sign(sm.movement_type, sm.quantity)) as on_hand
    from public.logistics_stock_movements sm
   group by sm.business_id, sm.inventory_item_id, sm.location_id, sm.lot_id;
grant select on public.inventory_lot_balances to authenticated;

-- who may look at lots (quantities, suppliers, dates; cost only with can_view_inventory_cost)
create or replace function public.can_view_lots()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_inventory_cost() or public.can_use_storefront() or public.has_section_access('logistics')
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'logistics');
$$;

-- ---------------------------------------------------------------------------
-- 4. Posting a receipt: every accepted line becomes a lot
-- ---------------------------------------------------------------------------
create or replace function public.post_receipt_to_stock(p_receipt_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l record; v_supplier uuid; v_lot uuid;
begin
  select * into r from public.logistics_receipts where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if not public.is_super_admin() and r.business_id is distinct from public.current_business_id() then
    raise exception 'Receipt does not belong to your business.';
  end if;
  if r.status = 'posted' then return; end if;
  if r.status <> 'approved' then raise exception 'Receipt must be approved before posting.'; end if;
  v_supplier := coalesce(r.supplier_id, (select supplier_id from public.purchase_orders where id = r.purchase_order_id));

  -- LOG-10: only the ACCEPTED quantity enters stock; each line is its own lot
  for l in select ri.* from public.logistics_receipt_items ri where ri.receipt_id = r.id and ri.accepted_qty > 0 order by ri.id loop
    select id into v_lot from public.inventory_lots where receipt_item_id = l.id;
    if v_lot is null then
      v_lot := public.inventory_create_lot(r.business_id, l.inventory_item_id, 'receipt', l.accepted_qty, l.unit_cost, r.receipt_date,
                                           v_supplier, r.id, l.id, r.purchase_order_id, null, null, l.lot_number, l.expiry_date, l.description);
    end if;
    insert into public.logistics_stock_movements(
      business_id, inventory_item_id, location_id, movement_date, movement_type, quantity,
      unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id
    ) values (
      r.business_id, l.inventory_item_id, r.location_id, r.receipt_date, 'receipt', l.accepted_qty,
      coalesce(l.unit_cost, 0), 'logistics_receipts', r.id, r.receipt_number, l.description, p_actor, v_lot
    ) on conflict (source_table, source_record_id, inventory_item_id, location_id, movement_type, (coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      where source_table is not null and source_record_id is not null do nothing;
  end loop;

  update public.logistics_receipts set status = 'posted', posted_at = now(), updated_at = now()
   where id = r.id and status = 'approved';
end $$;

-- weighted average: one cost entry per receipt movement. inventory_cost_receive
-- skips a (source, source_id) it has already costed, and a receipt with two
-- lines of the same item now posts two movements (two lots), so the entry is
-- keyed by the lot (legacy receipt movements without a lot keep the receipt id).
create or replace function public.inventory_cost_on_receipt_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- same lock inventory_cost_receive takes, held before the basis is read
  perform pg_advisory_xact_lock(hashtext('invcost:' || new.business_id::text), hashtext(new.inventory_item_id::text));
  perform public.inventory_cost_receive(
    new.business_id, new.inventory_item_id, new.quantity,
    public.inventory_receipt_unit_cost(new),
    coalesce(new.source_table, 'logistics_stock_movements'),
    coalesce(new.lot_id, new.source_record_id, new.id),
    new.movement_date,
    public.inventory_business_on_hand(new.business_id, new.inventory_item_id, new.id),
    new.id);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Posting a transfer: the chosen lot, or the oldest lots first
-- ---------------------------------------------------------------------------
create or replace function public.post_transfer_to_stock(p_transfer_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; l record; lb record; v_balance numeric; v_left numeric; v_take numeric; v_lot record; a record;
begin
  select * into t from public.logistics_stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found.'; end if;
  if not public.is_super_admin() and t.business_id is distinct from public.current_business_id() then
    raise exception 'Transfer does not belong to your business.';
  end if;
  if t.status = 'posted' then return; end if;
  if t.status <> 'approved' then raise exception 'Transfer must be approved before posting.'; end if;

  create temp table if not exists tmp_transfer_alloc(lot_id uuid, qty numeric) on commit drop;
  for l in select * from public.logistics_stock_transfer_items where transfer_id = t.id order by id loop
    select coalesce(sum(public.stock_qty_sign(sm.movement_type, sm.quantity)), 0) into v_balance
      from public.logistics_stock_movements sm
     where sm.inventory_item_id = l.inventory_item_id and sm.business_id = t.business_id and sm.location_id = t.from_location_id;
    if v_balance < l.quantity then
      raise exception 'Insufficient available stock for transfer item % (requested %, available %).', l.inventory_item_id, l.quantity, v_balance;
    end if;

    delete from tmp_transfer_alloc;
    if l.lot_id is not null then
      select * into v_lot from public.inventory_lots where id = l.lot_id;
      if not found or v_lot.business_id <> t.business_id or v_lot.inventory_item_id <> l.inventory_item_id then
        raise exception 'The lot chosen on a transfer line is not a lot of that item in this store.';
      end if;
      v_take := public.inventory_lot_on_hand(l.lot_id, t.from_location_id);
      if v_take < l.quantity then
        raise exception 'Lot % has only % at the source location (requested %).', v_lot.lot_code, v_take, l.quantity;
      end if;
      insert into tmp_transfer_alloc values (l.lot_id, l.quantity);
    else
      v_left := l.quantity;
      for lb in select b.lot_id, b.on_hand from public.inventory_item_lot_balances(t.business_id, l.inventory_item_id, t.from_location_id) b
                  join public.inventory_lots lo on lo.id = b.lot_id
                 where b.on_hand > 0 order by lo.received_date, lo.lot_code loop
        exit when v_left <= 0;
        v_take := least(v_left, lb.on_hand);
        insert into tmp_transfer_alloc values (lb.lot_id, v_take);
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then insert into tmp_transfer_alloc values (null, v_left); end if;
    end if;

    for a in select * from tmp_transfer_alloc loop
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
      values (t.business_id, l.inventory_item_id, t.from_location_id, t.transfer_date, 'transfer_out', a.qty, 0, 'logistics_stock_transfers', t.id, t.transfer_number, l.notes, p_actor, a.lot_id);
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
      values (t.business_id, l.inventory_item_id, t.to_location_id, t.transfer_date, 'transfer_in', a.qty, 0, 'logistics_stock_transfers', t.id, t.transfer_number, l.notes, p_actor, a.lot_id);
    end loop;
  end loop;

  update public.logistics_stock_transfers set status = 'posted', posted_at = now(), updated_at = now() where id = t.id and status = 'approved';
end $$;

-- a transfer line's lot must be a lot of that item in the transfer's store
create or replace function public.guard_transfer_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare active_item boolean; v_lot record; v_biz uuid;
begin
  select active into active_item from public.logistics_inventory_items where id = new.inventory_item_id;
  if coalesce(active_item, false) = false then raise exception 'Transfer item must be an active inventory item.'; end if;
  if new.quantity <= 0 then raise exception 'Transfer quantity must be greater than zero.'; end if;
  if new.lot_id is not null then
    select business_id into v_biz from public.logistics_stock_transfers where id = new.transfer_id;
    select business_id, inventory_item_id, lot_code into v_lot from public.inventory_lots where id = new.lot_id;
    if not found or v_lot.business_id <> v_biz or v_lot.inventory_item_id <> new.inventory_item_id then
      raise exception 'The lot chosen on a transfer line is not a lot of that item in this store.';
    end if;
    new.lot_code := v_lot.lot_code;
  else
    new.lot_code := null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Opening / stock count: counted stock is matched to the lots
--    Lots with stock keep it, newest first, up to the counted quantity; lots
--    beyond that go to zero; any "No lot" balance is cleared; whatever is
--    counted beyond the lots becomes a new lot at the count's unit cost (the
--    opening lot at go-live, when no lot has stock yet).
-- ---------------------------------------------------------------------------
create or replace function public.inventory_opening_count_decide(p_count uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); c record; l record; lb record; v_inv uuid; v_loc_qty numeric; v_biz_qty numeric; v_delta numeric; v_mov uuid;
        n_in int := 0; n_out int := 0; v_left numeric; v_keep numeric; v_lot uuid; v_had_lots boolean;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'A Business Admin approves the opening count.'; end if;
  select * into c from public.inventory_opening_counts where id = p_count and business_id = b for update;
  if not found then raise exception 'Opening count not found in this store.'; end if;
  if c.status <> 'prepared' then raise exception 'This opening count was already %.', c.status; end if;
  if c.prepared_by = auth.uid() and not public.is_super_admin() then raise exception 'You prepared this count, so another Business Admin must approve it.'; end if;
  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Say why the count is rejected.'; end if;
    update public.inventory_opening_counts set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where id = c.id;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'inventory_opening_counts', c.id, 'opening_count_rejected', jsonb_build_object('count_number', c.count_number, 'note', p_note));
    return jsonb_build_object('status', 'rejected');
  end if;
  for l in select * from public.inventory_opening_count_lines where count_id = c.id order by id loop
    v_inv := public.ensure_inventory_link(l.item_id, b);
    if v_inv is null then continue; end if;
    select coalesce(sum(on_hand) filter (where location_id = c.location_id), 0), coalesce(sum(bal.on_hand), 0) into v_loc_qty, v_biz_qty
      from public.logistics_stock_balance bal join public.logistics_locations lo on lo.id = bal.location_id and lo.business_id = b
     where bal.inventory_item_id = v_inv;
    v_delta := l.counted_qty - v_loc_qty;
    if l.counted_qty > 0 then
      perform public.inventory_cost_receive(b, v_inv, l.counted_qty, l.unit_cost, 'opening_stock', l.id, c.count_date, greatest(v_biz_qty - v_loc_qty, 0), null);
    end if;

    v_mov := null;
    v_left := l.counted_qty;
    select exists (select 1 from public.inventory_lots where business_id = b and inventory_item_id = v_inv) into v_had_lots;
    -- lots with stock here keep it, newest first, up to the count
    for lb in select x.lot_id, x.on_hand from public.inventory_item_lot_balances(b, v_inv, c.location_id) x
                join public.inventory_lots lo on lo.id = x.lot_id
               where x.on_hand > 0 order by lo.received_date desc, lo.lot_code desc loop
      v_keep := least(v_left, lb.on_hand);
      v_left := v_left - v_keep;
      if lb.on_hand - v_keep > 0 then
        insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
        values (b, v_inv, c.location_id, c.count_date, 'issue', lb.on_hand - v_keep, l.unit_cost, 'inventory_opening_counts', c.id, c.count_number,
                'Stock count: lot lowered to ' || v_keep || ' (counted ' || l.counted_qty || ')', auth.uid(), lb.lot_id)
        returning id into v_mov;
      end if;
    end loop;
    -- lots below zero, and the "No lot" balance, go to zero
    for lb in select x.lot_id, x.on_hand from public.inventory_item_lot_balances(b, v_inv, c.location_id) x
               where (x.lot_id is not null and x.on_hand < 0) or (x.lot_id is null and x.on_hand <> 0) loop
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
      values (b, v_inv, c.location_id, c.count_date, case when lb.on_hand < 0 then 'adjustment' else 'issue' end, abs(lb.on_hand), l.unit_cost,
              'inventory_opening_counts', c.id, c.count_number,
              'Stock count: ' || case when lb.lot_id is null then '"No lot" balance' else 'lot below zero' end || ' cleared (was ' || lb.on_hand || ')', auth.uid(), lb.lot_id)
      returning id into v_mov;
    end loop;
    -- the rest of the count is a new lot (the opening lot at go-live)
    if v_left > 0 then
      v_lot := public.inventory_create_lot(b, v_inv, case when v_had_lots then 'count' else 'opening' end, v_left, l.unit_cost, c.count_date,
                                           null, null, null, null, c.id, l.id, null, null,
                                           case when v_had_lots then 'Counted beyond the recorded lots' else 'Opening stock' end || ' (' || c.count_number || ')');
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
      values (b, v_inv, c.location_id, c.count_date, 'adjustment', v_left, l.unit_cost, 'inventory_opening_counts', c.id, c.count_number,
              'Opening stock count: counted ' || l.counted_qty || ', system had ' || v_loc_qty, auth.uid(), v_lot)
      returning id into v_mov;
    end if;
    if v_delta > 0 then n_in := n_in + 1; elsif v_delta < 0 then n_out := n_out + 1; end if;
    update public.inventory_opening_count_lines set inventory_item_id = v_inv, on_hand_before = v_loc_qty, stock_movement_id = v_mov where id = l.id;
  end loop;
  update public.inventory_opening_counts set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = c.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'inventory_opening_counts', c.id, 'opening_count_approved', jsonb_build_object('count_number', c.count_number, 'raised', n_in, 'lowered', n_out));
  return jsonb_build_object('status', 'approved', 'raised', n_in, 'lowered', n_out, 'lines', c.line_count);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Counter sale: stock leaves with the lot on each line (one movement per item + lot)
-- ---------------------------------------------------------------------------
create or replace function public.storefront_post_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record; l record; g record; p jsonb; v_paid numeric := 0; v_inv uuid; v_code text; v_walk uuid; v_mov uuid; v_inv_item uuid; v_unit numeric;
        v_booklet uuid; v_vat_reg boolean; v_vat numeric := 0; v_cost numeric := 0; o record; v_order boolean; v_order_no text; v_terms text;
begin
  select * into s from public.storefront_sales where id = p_sale for update;
  v_order := s.sales_order_id is not null;
  select code into v_code from public.businesses where id = s.business_id;
  select walk_in_customer_id into v_walk from public.storefront_settings where business_id = s.business_id;
  v_booklet := public.sf_booklet_business(s.business_id);
  select vat_registered into v_vat_reg from public.businesses where id = v_booklet;
  if v_order then select * into o from public.sales_orders where id = s.sales_order_id; v_order_no := o.order_number; v_terms := o.payment_terms; end if;

  -- documents
  p_si := nullif(btrim(coalesce(p_si, '')), '');
  if v_order then p_issue_dr := true; end if;
  if not coalesce(p_issue_dr, false) and p_si is null then raise exception 'Choose at least one document: DR and/or SI (enter the SI booklet number).'; end if;
  if p_si is not null and exists (select 1 from public.storefront_sales where coalesce(si_booklet_business_id, business_id) = v_booklet and id <> s.id
                                    and status <> 'cancelled' and lower(btrim(si_number)) = lower(p_si)) then
    raise exception 'SI number % is already used on this SI booklet.', p_si;
  end if;
  if v_order then
    if p_si is not null and coalesce(v_vat_reg, false) <> o.vat_applied then
      raise exception '%', case when o.vat_applied then 'This order is with VAT: its SI must come from a VAT-registered booklet. Issue the DR only, or change the store''s SI booklet.'
                                else 'This order is without VAT: issue the DR only, or use a non-VAT SI booklet.' end;
    end if;
    if o.vat_applied then v_vat := round(s.total * 12 / 112, 2); end if;
  elsif p_si is not null and coalesce(v_vat_reg, false) then v_vat := round(s.total * 12 / 112, 2);
  end if;

  -- payments (checked again by the payment triggers)
  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce(p->>'method', '') not in ('cash','gcash','maya','card','bank_transfer','check') then raise exception 'Unknown payment method %.', p->>'method'; end if;
    if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
    v_paid := v_paid + round((p->>'amount')::numeric, 2);
  end loop;
  if v_paid > s.total then raise exception 'Payments (₱%) are more than the sale total (₱%). Record only the amount applied: enter the cash tendered and the change is worked out.', v_paid, s.total; end if;
  if s.total - v_paid > 0 and s.customer_id = v_walk then
    raise exception 'A charge or partly paid sale needs a named customer, not Walk-in.';
  end if;

  -- cost (weighted average per item per store) on every line
  for l in select * from public.storefront_sale_items where sale_id = s.id loop
    v_inv_item := case when l.item_type <> 'service' and l.item_id is not null then coalesce(l.inventory_item_id, public.ensure_inventory_link(l.item_id, s.business_id)) end;
    v_unit := case when v_inv_item is not null then coalesce(public.inventory_unit_cost(s.business_id, v_inv_item), l.acquisition_cost, 0) else coalesce(l.acquisition_cost, 0) end;
    update public.storefront_sale_items set inventory_item_id = v_inv_item, unit_cost = round(v_unit, 4) where id = l.id;
    if l.item_type <> 'service' then v_cost := v_cost + round(l.quantity * v_unit, 2); end if;
  end loop;
  -- stock: a counter sale issues at once, one movement per item and lot (an order DR issues at the Warehouse release)
  if not v_order then
    for g in select inventory_item_id, lot_id, sum(quantity) as qty, max(unit_cost) as unit_cost
               from public.storefront_sale_items where sale_id = s.id and inventory_item_id is not null group by inventory_item_id, lot_id loop
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
      values (s.business_id, g.inventory_item_id, s.location_id, s.sale_date, 'issue', g.qty, round(coalesce(g.unit_cost, 0), 4), 'storefront_sales', s.id, s.sale_number, 'Storefront sale', auth.uid(), g.lot_id)
      returning id into v_mov;
      update public.storefront_sale_items set stock_movement_id = v_mov
       where sale_id = s.id and inventory_item_id = g.inventory_item_id and lot_id is not distinct from g.lot_id;
    end loop;
  end if;

  update public.storefront_sales
     set status = 'completed', si_number = p_si, issue_dr = coalesce(p_issue_dr, false),
         si_booklet_business_id = case when p_si is not null then v_booklet end, vat_applied = v_vat > 0, vat_amount = v_vat, cost_total = v_cost,
         dr_number = case when coalesce(p_issue_dr, false) then public.storefront_next_number('DR', 'storefront_sales', 'dr_number') end,
         release_status = case when v_order then 'awaiting_release' end,
         amount_paid = v_paid, balance = s.total - v_paid, completed_by = auth.uid(), completed_at = now()
   where id = s.id;

  -- AR invoice: charge / partly paid sales, and every order DR
  if s.total - v_paid > 0 or v_order then
    insert into public.finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, discount_amount, amount_received, status, notes, prepared_by, prepared_at, approved_by, approved_at, created_by)
    values (s.business_id, coalesce(v_code || '-SI-' || p_si, s.sale_number), s.customer_id, s.sale_date,
            case when v_order then s.sale_date + public.payment_terms_days(v_terms) end,
            s.total - v_vat, v_vat, 0, v_paid, 'approved',
            'Storefront sale ' || s.sale_number || coalesce(', SI ' || p_si, '') || case when v_order then ', order ' || v_order_no || coalesce(' (' || v_terms || ')', '') else '' end
              || case when v_vat > 0 then ' (VAT-inclusive; VAT ₱' || v_vat || ')' else '' end,
            auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_inv;
    insert into public.finance_customer_invoice_items(business_id, invoice_id, description, quantity, unit, unit_price)
    select s.business_id, v_inv, description, quantity, unit,
           case when v_vat > 0 then round(unit_price * 100 / 112, 2) else unit_price end
      from public.storefront_sale_items where sale_id = s.id;
    update public.storefront_sales set ar_invoice_id = v_inv where id = s.id;
  end if;

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    perform public.storefront_record_payment(s.business_id, 'sale', p->>'method', (p->>'amount')::numeric, p->>'reference', s.id, v_inv, null,
                                             'Paid at the counter, Storefront sale ' || s.sale_number, nullif(p->>'account', '')::uuid, public.sf_pay_extra(p));
  end loop;
  if v_inv is not null then perform public.recalculate_customer_invoice_received(v_inv); end if;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_completed',
          jsonb_build_object('sale_number', s.sale_number, 'total', s.total, 'paid', v_paid, 'ar_invoice_id', v_inv, 'si_number', p_si, 'vat', v_vat, 'order', v_order_no));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Warehouse release of an order DR: stock leaves with the DR lines' lots
-- ---------------------------------------------------------------------------
create or replace function public.storefront_release_dr(p_sale uuid, p_location uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); s record; l record; g record; v_loc uuid; v_mov uuid; v_open int;
begin
  if not public.can_release_dr() then raise exception 'The Warehouse (Logistics) confirms the release of a DR.'; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'DR not found in this business.'; end if;
  if s.sales_order_id is null or s.status <> 'completed' then raise exception 'Only a DR issued from a sales order is released by the Warehouse.'; end if;
  if s.release_status = 'released' then raise exception 'DR % was already released.', s.dr_number; end if;
  v_loc := coalesce(p_location, s.location_id);
  if not exists (select 1 from public.logistics_locations where id = v_loc and business_id = b and active) then raise exception 'Choose an active location of this business.'; end if;
  for l in select * from public.storefront_sale_items where sale_id = s.id and item_type <> 'service' and item_id is not null and inventory_item_id is null loop
    update public.storefront_sale_items set inventory_item_id = public.ensure_inventory_link(l.item_id, b) where id = l.id;
  end loop;
  -- net of anything returned before the release; one movement per item and lot
  for g in select i.inventory_item_id, i.lot_id, sum(i.quantity - coalesce(r.qty, 0)) as qty, max(coalesce(i.unit_cost, i.acquisition_cost, 0)) as unit_cost
             from public.storefront_sale_items i
             left join lateral (select sum(ri.quantity) as qty from public.storefront_return_items ri where ri.sale_item_id = i.id) r on true
            where i.sale_id = s.id and i.item_type <> 'service' and i.inventory_item_id is not null
            group by i.inventory_item_id, i.lot_id
           having sum(i.quantity - coalesce(r.qty, 0)) > 0 loop
    insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
    values (b, g.inventory_item_id, v_loc, (now() at time zone 'Asia/Manila')::date, 'issue', g.qty, round(g.unit_cost, 4), 'storefront_sales', s.id, s.dr_number,
            'Released by the Warehouse for DR ' || s.dr_number, auth.uid(), g.lot_id)
    returning id into v_mov;
    update public.storefront_sale_items set stock_movement_id = v_mov
     where sale_id = s.id and inventory_item_id = g.inventory_item_id and lot_id is not distinct from g.lot_id;
  end loop;
  update public.storefront_sales set release_status = 'released', released_by = auth.uid(), released_at = now() where id = s.id;
  -- order complete when every line is fully delivered and released
  select count(*) into v_open from public.sales_order_items soi cross join lateral public.sf_order_line_delivered(soi.id) dl
   where soi.order_id = s.sales_order_id and dl.released < soi.quantity;
  if v_open = 0 then update public.sales_orders set status = 'fulfilled', fulfilled_at = now(), updated_at = now() where id = s.sales_order_id; end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_dr_released', jsonb_build_object('dr_number', s.dr_number, 'location', v_loc, 'order_complete', v_open = 0));
  return jsonb_build_object('dr_number', s.dr_number, 'order_complete', v_open = 0);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Returns go back into the lot they were sold from
-- ---------------------------------------------------------------------------
create or replace function public.storefront_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; l record; si record; r jsonb; v_ret uuid; v_no text; v_cond text;
        v_total numeric := 0; v_credit numeric := 0; v_refund numeric := 0; v_paid_refund numeric := 0; v_bal numeric := 0; v_mov uuid; v_inv_item uuid; v_done numeric;
        v_cost numeric := 0; v_damaged numeric := 0; v_vat numeric := 0; v_unit numeric; v_loc uuid;
begin
  select * into s from public.storefront_sales where id = (p->>'sale_id')::uuid and business_id = b for update;
  if not found then raise exception 'Sale not found in this store.'; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be returned.'; end if;
  if coalesce(btrim(p->>'reason'), '') = '' then raise exception 'Enter the reason for the return.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Choose at least one item to return.'; end if;

  v_no := public.storefront_next_number('SFR', 'storefront_returns', 'return_number');
  insert into public.storefront_returns(business_id, return_number, sale_id, reason, created_by)
  values (b, v_no, s.id, btrim(p->>'reason'), auth.uid()) returning id into v_ret;

  for l in select * from jsonb_to_recordset(p->'lines') as x(sale_item_id uuid, quantity numeric, condition text) loop
    if coalesce(l.quantity, 0) <= 0 then continue; end if;
    v_cond := coalesce(nullif(l.condition, ''), 'back_to_stock');
    if v_cond not in ('back_to_stock','damaged','wrong_item') then raise exception 'Mark each returned item as Back to stock, Damaged or Wrong item.'; end if;
    select * into si from public.storefront_sale_items where id = l.sale_item_id and sale_id = s.id;
    if not found then raise exception 'An item on the return is not on sale %.', s.sale_number; end if;
    select coalesce(sum(quantity), 0) into v_done from public.storefront_return_items where sale_item_id = si.id;
    if l.quantity > si.quantity - v_done then
      raise exception 'Only % of % can still be returned.', (si.quantity - v_done)::text, si.description;
    end if;
    v_mov := null;
    v_unit := coalesce(si.unit_cost, si.acquisition_cost, 0);
    if si.item_type <> 'service' then
      -- goods that left the store come back into stock (into their lot) unless damaged; an order DR not yet released never left
      if v_cond <> 'damaged' and si.stock_movement_id is not null then
        v_inv_item := coalesce(si.inventory_item_id, public.ensure_inventory_link(si.item_id, b));
        select location_id into v_loc from public.logistics_stock_movements where id = si.stock_movement_id;
        insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_id)
        values (b, v_inv_item, coalesce(v_loc, s.location_id), (now() at time zone 'Asia/Manila')::date, 'adjustment', l.quantity, round(v_unit, 4), 'storefront_returns', v_ret, v_no,
                'Storefront return of ' || s.sale_number || ' (' || replace(v_cond, '_', ' ') || '): ' || btrim(p->>'reason'), auth.uid(), si.lot_id)
        returning id into v_mov;
      end if;
      v_cost := v_cost + round(l.quantity * v_unit, 2);
      if v_cond = 'damaged' and (si.stock_movement_id is not null) then v_damaged := v_damaged + round(l.quantity * v_unit, 2); end if;
    end if;
    insert into public.storefront_return_items(business_id, return_id, sale_item_id, quantity, unit_price, line_total, stock_movement_id, condition)
    values (b, v_ret, si.id, l.quantity, si.unit_price, round(l.quantity * si.unit_price, 2), v_mov, v_cond);
    v_total := v_total + round(l.quantity * si.unit_price, 2);
  end loop;
  if v_total <= 0 then raise exception 'Choose at least one item to return.'; end if;
  if s.vat_applied then v_vat := round(v_total * 12 / 112, 2); end if;

  if s.ar_invoice_id is not null then
    select balance_due into v_bal from public.finance_customer_invoices where id = s.ar_invoice_id for update;
    v_credit := least(v_total, greatest(coalesce(v_bal, 0), 0));
    if v_credit > 0 then
      update public.finance_customer_invoices
         set discount_amount = discount_amount + v_credit, updated_at = now(),
             notes = coalesce(notes || E'\n', '') || 'Return ' || v_no || ': ₱' || v_credit || ' credited against the balance.'
       where id = s.ar_invoice_id;
      perform public.recalculate_customer_invoice_received(s.ar_invoice_id);
    end if;
  end if;
  v_refund := v_total - v_credit;

  for r in select * from jsonb_array_elements(coalesce(p->'refunds', '[]'::jsonb)) loop
    if coalesce((r->>'amount')::numeric, 0) <= 0 then continue; end if;
    perform public.storefront_record_payment(b, 'refund', r->>'method', (r->>'amount')::numeric, r->>'reference', s.id, null, v_ret, 'Refund for return ' || v_no,
                                             nullif(r->>'account', '')::uuid);
    v_paid_refund := v_paid_refund + round((r->>'amount')::numeric, 2);
  end loop;
  if v_paid_refund <> v_refund then
    raise exception 'Refund to give is ₱% (returned ₱%, of which ₱% reduces the unpaid balance); the refund entered is ₱%.', v_refund, v_total, v_credit, v_paid_refund;
  end if;

  update public.storefront_returns set total = v_total, credit_to_ar = v_credit, refund_total = v_refund, vat_amount = v_vat, cost_total = v_cost, damaged_cost = v_damaged where id = v_ret;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_returns', v_ret, 'storefront_return', jsonb_build_object('return_number', v_no, 'sale_number', s.sale_number, 'total', v_total, 'credit_to_ar', v_credit,
          'refund', v_refund, 'vat', v_vat, 'damaged_cost', v_damaged, 'reason', btrim(p->>'reason')));
  return jsonb_build_object('id', v_ret, 'return_number', v_no, 'total', v_total, 'credit_to_ar', v_credit, 'refund', v_refund, 'damaged_cost', v_damaged);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Reading lots (no cost unless the user may see cost)
-- ---------------------------------------------------------------------------
-- lots of one item with their stock, for the lot pickers (sale, DR, transfer)
create or replace function public.inventory_lots_for_item(p_catalog_item uuid default null, p_location uuid default null, p_inventory_item uuid default null)
returns table(lot_id uuid, lot_code text, received_date date, supplier text, supplier_lot_no text, expiry_date date, age_days int,
              on_hand_here numeric, on_hand_total numeric, unit_cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_inv uuid; v_cost boolean := public.can_view_inventory_cost();
begin
  if auth.uid() is null or not public.can_view_lots() then raise exception 'Access to stock lots is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if p_inventory_item is not null then
    select id into v_inv from public.logistics_inventory_items where id = p_inventory_item and business_id = b;
  else
    select id into v_inv from public.logistics_inventory_items where business_id = b and procurement_item_id = p_catalog_item limit 1;
  end if;
  if v_inv is null then return; end if;
  return query
  select l.id, l.lot_code, l.received_date, s.legal_name, l.supplier_lot_no, l.expiry_date,
         ((now() at time zone 'Asia/Manila')::date - l.received_date)::int,
         coalesce(sum(public.stock_qty_sign(sm.movement_type, sm.quantity)) filter (where p_location is not null and sm.location_id = p_location), 0),
         coalesce(sum(public.stock_qty_sign(sm.movement_type, sm.quantity)), 0),
         case when v_cost then l.unit_cost end
    from public.inventory_lots l
    left join public.finance_suppliers s on s.id = l.supplier_id
    left join public.logistics_stock_movements sm on sm.lot_id = l.id
   where l.business_id = b and l.inventory_item_id = v_inv
   group by l.id, s.legal_name
   order by l.received_date, l.lot_code;
end $$;

-- lot register: one row per lot (optionally one location), with aging
create or replace function public.inventory_lot_register(p_search text default null, p_location uuid default null, p_open_only boolean default true,
                                                         p_limit int default 100, p_offset int default 0)
returns table(lot_id uuid, lot_code text, inventory_item_id uuid, item_code text, item_name text, unit text, source text, received_date date, age_days int,
              age_bucket text, supplier text, supplier_lot_no text, expiry_date date, receipt_number text, received_qty numeric, on_hand numeric,
              by_location jsonb, unit_cost numeric, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_cost boolean := public.can_view_inventory_cost();
        q text := nullif(btrim(coalesce(p_search, '')), ''); v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if auth.uid() is null or not public.can_view_lots() then raise exception 'Access to stock lots is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return query
  with bal as (
    select sm.lot_id, sm.location_id, sum(public.stock_qty_sign(sm.movement_type, sm.quantity)) as qty
      from public.logistics_stock_movements sm
     where sm.business_id = b and sm.lot_id is not null and (p_location is null or sm.location_id = p_location)
     group by sm.lot_id, sm.location_id
  ), agg as (
    select bal.lot_id, sum(bal.qty) as qty,
           jsonb_agg(jsonb_build_object('location', lo.location_code, 'on_hand', bal.qty) order by lo.location_code) filter (where bal.qty <> 0) as by_loc
      from bal join public.logistics_locations lo on lo.id = bal.location_id group by bal.lot_id
  ), rows as (
    select l.*, i.item_code, i.item_name, i.unit, s.legal_name as supplier_name, r.receipt_number, coalesce(a.qty, 0) as qty, coalesce(a.by_loc, '[]'::jsonb) as by_loc
      from public.inventory_lots l
      join public.logistics_inventory_items i on i.id = l.inventory_item_id
      left join public.finance_suppliers s on s.id = l.supplier_id
      left join public.logistics_receipts r on r.id = l.receipt_id
      left join agg a on a.lot_id = l.id
     where l.business_id = b
       and (not coalesce(p_open_only, true) or coalesce(a.qty, 0) <> 0)
       and (p_location is null or a.lot_id is not null)
       and (q is null or l.lot_code ilike '%' || q || '%' or i.item_code ilike '%' || q || '%' or i.item_name ilike '%' || q || '%'
            or coalesce(s.legal_name, '') ilike '%' || q || '%' or coalesce(l.supplier_lot_no, '') ilike '%' || q || '%' or coalesce(r.receipt_number, '') ilike '%' || q || '%')
  )
  select x.id, x.lot_code, x.inventory_item_id, x.item_code, x.item_name, x.unit, x.source, x.received_date, (v_today - x.received_date)::int,
         case when v_today - x.received_date <= 30 then '0-30 days' when v_today - x.received_date <= 90 then '31-90 days'
              when v_today - x.received_date <= 180 then '91-180 days' when v_today - x.received_date <= 365 then '181-365 days' else 'Over 1 year' end,
         x.supplier_name, x.supplier_lot_no, x.expiry_date, x.receipt_number, x.received_qty, x.qty, x.by_loc,
         case when v_cost then x.unit_cost end, count(*) over ()
    from rows x
   order by x.received_date, x.lot_code
   limit greatest(1, least(coalesce(p_limit, 100), 500)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- aging summary: quantity on hand per age bucket (and value for cost users)
create or replace function public.inventory_lot_aging()
returns table(age_bucket text, bucket_order int, lots bigint, on_hand numeric, value numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_cost boolean := public.can_view_inventory_cost(); v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if auth.uid() is null or not public.can_view_lots() then raise exception 'Access to stock lots is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return query
  with lb as (
    select l.id, l.received_date, l.unit_cost, sum(public.stock_qty_sign(sm.movement_type, sm.quantity)) as qty
      from public.inventory_lots l join public.logistics_stock_movements sm on sm.lot_id = l.id
     where l.business_id = b group by l.id
  ), bk as (
    select case when v_today - received_date <= 30 then 1 when v_today - received_date <= 90 then 2 when v_today - received_date <= 180 then 3
                when v_today - received_date <= 365 then 4 else 5 end as o, qty, qty * unit_cost as val
      from lb where qty > 0
  )
  select (array['0-30 days','31-90 days','91-180 days','181-365 days','Over 1 year'])[o], o, count(*), sum(qty), case when v_cost then round(sum(val), 2) end
    from bk group by o order by o;
end $$;

-- trace a lot: where it came from and where every unit went (customers included)
create or replace function public.inventory_lot_trace(p_lot uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); l record; v_cost boolean := public.can_view_inventory_cost();
begin
  if auth.uid() is null or not public.can_view_lots() then raise exception 'Access to stock lots is required.'; end if;
  select lo.*, i.item_code, i.item_name, i.unit, s.legal_name as supplier_name, r.receipt_number, po.po_number, oc.count_number
    into l
    from public.inventory_lots lo
    join public.logistics_inventory_items i on i.id = lo.inventory_item_id
    left join public.finance_suppliers s on s.id = lo.supplier_id
    left join public.logistics_receipts r on r.id = lo.receipt_id
    left join public.purchase_orders po on po.id = lo.purchase_order_id
    left join public.inventory_opening_counts oc on oc.id = lo.opening_count_id
   where lo.id = p_lot and lo.business_id = b;
  if not found then raise exception 'Lot not found in this store.'; end if;
  return jsonb_build_object(
    'lot_id', l.id, 'lot_code', l.lot_code, 'item_code', l.item_code, 'item_name', l.item_name, 'unit', l.unit, 'source', l.source,
    'received_date', l.received_date, 'received_qty', l.received_qty, 'supplier', l.supplier_name, 'supplier_lot_no', l.supplier_lot_no,
    'expiry_date', l.expiry_date, 'receipt_number', l.receipt_number, 'po_number', l.po_number, 'count_number', l.count_number,
    'unit_cost', case when v_cost then l.unit_cost end,
    'on_hand', public.inventory_lot_on_hand(l.id, null),
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', sm.movement_date, 'type', sm.movement_type, 'quantity', sm.quantity, 'signed', public.stock_qty_sign(sm.movement_type, sm.quantity),
               'location', loc.location_code, 'reference', sm.reference_number, 'source_table', sm.source_table, 'source_id', sm.source_record_id,
               'customer', coalesce(c1.legal_name, c2.legal_name), 'dr_number', coalesce(ss.dr_number, ss2.dr_number), 'sale_number', coalesce(ss.sale_number, ss2.sale_number),
               'hardcopy_dr_no', ss.hardcopy_dr_no, 'notes', sm.notes) order by sm.movement_date, sm.created_at)
        from public.logistics_stock_movements sm
        join public.logistics_locations loc on loc.id = sm.location_id
        left join public.storefront_sales ss on sm.source_table = 'storefront_sales' and ss.id = sm.source_record_id
        left join public.finance_customers c1 on c1.id = ss.customer_id
        left join public.storefront_returns rt on sm.source_table = 'storefront_returns' and rt.id = sm.source_record_id
        left join public.storefront_sales ss2 on ss2.id = rt.sale_id
        left join public.finance_customers c2 on c2.id = ss2.customer_id
       where sm.lot_id = l.id), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('customer', x.customer, 'quantity', x.qty, 'sales', x.sales) order by x.customer)
        from (select c.legal_name as customer, sum(sm.quantity) as qty, jsonb_agg(distinct coalesce(ss.dr_number, ss.sale_number)) as sales
                from public.logistics_stock_movements sm
                join public.storefront_sales ss on sm.source_table = 'storefront_sales' and ss.id = sm.source_record_id
                join public.finance_customers c on c.id = ss.customer_id
               where sm.lot_id = l.id and sm.movement_type = 'issue'
               group by c.legal_name) x), '[]'::jsonb));
end $$;

-- purchase-price history of one catalog item from its receipts (lots): Finance / admins
create or replace function public.inventory_item_purchase_history(p_catalog_item uuid)
returns table(lot_id uuid, lot_code text, received_date date, supplier text, receipt_number text, po_number text, received_qty numeric,
              unit_cost numeric, supplier_lot_no text, on_hand numeric, source text)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if auth.uid() is null or not public.can_view_inventory_cost() then raise exception 'Purchase prices are visible to Finance and admins only.'; end if;
  if b is null then return; end if;
  return query
  select l.id, l.lot_code, l.received_date, s.legal_name, r.receipt_number, po.po_number, l.received_qty, l.unit_cost, l.supplier_lot_no,
         public.inventory_lot_on_hand(l.id, null), l.source
    from public.inventory_lots l
    join public.logistics_inventory_items i on i.id = l.inventory_item_id and i.procurement_item_id = p_catalog_item
    left join public.finance_suppliers s on s.id = l.supplier_id
    left join public.logistics_receipts r on r.id = l.receipt_id
    left join public.purchase_orders po on po.id = l.purchase_order_id
   where l.business_id = b
   order by l.received_date desc, l.lot_code desc;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Lots for stock already on record
--     Each posted receipt movement and each opening-count increase becomes a
--     lot (legacy receipts posted one movement per item, so that is the lot).
-- ---------------------------------------------------------------------------
alter table public.logistics_stock_movements disable trigger logistics_stock_movement_guard;
do $$
declare m record; v_lot uuid; v_supplier uuid; v_po uuid; v_src text;
begin
  for m in select sm.* from public.logistics_stock_movements sm
            where sm.lot_id is null
              and ((sm.source_table = 'logistics_receipts' and sm.movement_type = 'receipt')
                   or (sm.source_table = 'inventory_opening_counts' and sm.movement_type = 'adjustment'))
            order by sm.movement_date, sm.created_at loop
    v_supplier := null; v_po := null;
    if m.source_table = 'logistics_receipts' then
      select coalesce(r.supplier_id, po.supplier_id), r.purchase_order_id into v_supplier, v_po
        from public.logistics_receipts r left join public.purchase_orders po on po.id = r.purchase_order_id where r.id = m.source_record_id;
      v_src := 'receipt';
    else
      v_src := 'opening';
    end if;
    insert into public.inventory_lots(business_id, inventory_item_id, lot_code, source, receipt_id, purchase_order_id, opening_count_id, supplier_id,
                                      supplier_lot_no, unit_cost, received_date, received_qty, notes, created_by)
    values (m.business_id, m.inventory_item_id, public.inventory_next_lot_code(m.business_id), v_src,
            case when v_src = 'receipt' then m.source_record_id end, v_po, case when v_src = 'opening' then m.source_record_id end, v_supplier,
            m.lot_number, coalesce(m.unit_cost, 0), m.movement_date, m.quantity, 'Created from stock already on record (Build 78)', m.created_by)
    returning id into v_lot;
    update public.logistics_stock_movements set lot_id = v_lot, lot_number = (select lot_code from public.inventory_lots where id = v_lot) where id = m.id;
  end loop;
end $$;
alter table public.logistics_stock_movements enable trigger logistics_stock_movement_guard;

-- ---------------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.inventory_next_lot_code(uuid) from public, anon, authenticated;
revoke all on function public.inventory_create_lot(uuid, uuid, text, numeric, numeric, date, uuid, uuid, uuid, uuid, uuid, uuid, text, date, text) from public, anon, authenticated;
revoke all on function public.inventory_item_lot_balances(uuid, uuid, uuid) from public, anon;
revoke all on function public.inventory_oldest_lot(uuid, uuid, uuid) from public, anon;
revoke all on function public.inventory_lot_on_hand(uuid, uuid) from public, anon;
grant execute on function public.inventory_lots_for_item(uuid, uuid, uuid) to authenticated;
grant execute on function public.inventory_lot_register(text, uuid, boolean, int, int) to authenticated;
grant execute on function public.inventory_lot_aging() to authenticated;
grant execute on function public.inventory_lot_trace(uuid) to authenticated;
grant execute on function public.inventory_item_purchase_history(uuid) to authenticated;
grant execute on function public.can_view_lots() to authenticated;
