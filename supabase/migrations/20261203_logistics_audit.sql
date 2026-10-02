-- ============================================================================
-- Build 77 (Logistics audit items) — receiving, stock ledger, locations, cost.
--
--   LOG-10  Receipt lines record delivered = accepted + damaged + rejected.
--           `quantity` stays the DELIVERED quantity (every existing reader
--           keeps working); accepted_qty / damaged_qty / rejected_qty are new.
--           Existing lines are backfilled as fully accepted. Only ACCEPTED
--           quantity goes into stock on posting.
--   LOG-13  Over-receipt is checked in the database: a line's accepted
--           quantity may not exceed the PO line's outstanding quantity
--           (ordered − accepted on every OTHER receipt line of that PO, any
--           status: draft/prepared/reviewed/approved/posted). Damaged and
--           rejected units do not count as received (the supplier still owes
--           them), so a replacement delivery is not an over-receipt. Staff are
--           refused; a logistics approver / Business Admin / Super Admin may
--           pass over_receipt_approved = true, which is stamped and written to
--           audit_log ('over_receipt_approved').
--   LOG-14  (found while here) the posted-receipt line guard the Build 49
--           audit described did not exist in the replayed schema: lines of a
--           posted receipt can no longer be inserted, changed or deleted.
--   LOG-39 / RA-08
--           Receipt line unit_cost comes from the PO line server-side. A user
--           who may not see cost (anyone but Super Admin, Business Admin,
--           Admin, Finance role or a Finance grant) cannot set or change it:
--           on insert the PO cost (or 0 for an ad-hoc receipt) is applied and
--           a different typed cost is refused; on update a change is refused.
--           Cost-privileged users may still enter a cost (e.g. ad-hoc or an
--           invoice price); a blank/0 cost on a PO receipt takes the PO cost.
--           The ledger function returns unit_cost only to cost-privileged
--           users. Server-side trust is decided by current_user (the
--           invoker): service_role / migrations / superuser are trusted.
--   post_receipt_to_stock()
--           re-created from its 20261105 definition. Same checks, idempotency
--           (ON CONFLICT on uq_stock_movement_source_line), lot propagation
--           and grants. Changes: the movement quantity is the ACCEPTED
--           quantity; lines are aggregated per item (that unique index
--           allows ONE receipt movement per receipt+item+location, so a second
--           line for the same item used to be silently dropped by ON
--           CONFLICT); the cost is the accepted-weighted line cost; an item
--           with nothing accepted produces no movement. The weighted-average
--           trigger (inventory_cost_on_receipt_movement) is untouched and
--           fires on the inserted receipt row as before.
--   LOG-05  location_type: the check constraint already exists on fresh
--           replays (20260922) but a pre-existing live table may lack it.
--           Free-text values are mapped (van/truck → transit, shop/branch →
--           store, depot/storage → warehouse, …, anything else → other) and
--           the constraint is (re)created. UI list = same five values.
--   LOG-24  validate_logistics_inventory_uuid() was dead code (never called,
--           never attached) and only checked "is this text a UUID", which
--           uuid columns already guarantee. DROPPED. Replaced with real
--           identifier validation: location codes are trimmed, upper-cased
--           and must match ^[A-Z0-9][A-Z0-9_-]{0,29}$; inventory item codes
--           are trimmed, non-empty, ≤ 64 chars, no control characters
--           (they mirror catalog codes, whose format is the catalog's).
--           Both checks run only when the code is set/changed.
--   LOG-40 / 41 / 35 / 26
--           logistics_stock_ledger(): DB-side search / type / location / item /
--           date filters with paging and a total count; running balance per
--           item+location over the FULL history (filters on search/type/date
--           do not distort it). Item and location filters are applied
--           before the window, so the location view's balance is per item AT
--           that location. SECURITY INVOKER: RLS applies.
--           logistics_stock_balance gains business_id (appended column).
--   LOG-02 / 03 / 07
--           logistics_dashboard_kpis(): one row per visible business, so a
--           Super Admin viewing all businesses sees a per-business breakdown;
--           includes ad-hoc (no-PO) receipt counts. logistics_period_summary()
--           returns DB-side movement totals and receiving quality (delivered /
--           accepted / damaged / rejected, ad-hoc count) for a period —
--           replaces summing ≤1,000 fetched movements in the reports page.
-- ============================================================================

-- ------------------------------------------------------------ access ----
create or replace function public.can_view_inventory_cost()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role in ('admin','finance'))
      or public.has_section_access('finance');
$$;
revoke all on function public.can_view_inventory_cost() from public, anon;
grant execute on function public.can_view_inventory_cost() to authenticated, service_role;

create or replace function public.can_approve_logistics_exceptions()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                   join public.users u on u.id = ua.user_id
                  where ua.user_id = auth.uid() and u.is_active and s.code = 'logistics' and ua.workflow_role = 'approver');
$$;
revoke all on function public.can_approve_logistics_exceptions() from public, anon;
grant execute on function public.can_approve_logistics_exceptions() to authenticated, service_role;

-- ------------------------------------------------- LOG-10 columns -------
alter table public.logistics_receipt_items
  add column if not exists accepted_qty numeric(14,3),
  add column if not exists damaged_qty numeric(14,3) not null default 0,
  add column if not exists rejected_qty numeric(14,3) not null default 0,
  add column if not exists over_receipt_approved boolean not null default false,
  add column if not exists over_receipt_approved_by uuid references public.users(id),
  add column if not exists over_receipt_approved_at timestamptz;

update public.logistics_receipt_items
   set accepted_qty = quantity - coalesce(damaged_qty,0) - coalesce(rejected_qty,0)
 where accepted_qty is null;
alter table public.logistics_receipt_items alter column accepted_qty set not null;

alter table public.logistics_receipt_items drop constraint if exists logistics_receipt_items_qty_split;
alter table public.logistics_receipt_items add constraint logistics_receipt_items_qty_split
  check (accepted_qty >= 0 and damaged_qty >= 0 and rejected_qty >= 0
         and accepted_qty + damaged_qty + rejected_qty = quantity);

comment on column public.logistics_receipt_items.quantity is 'Delivered quantity (= accepted_qty + damaged_qty + rejected_qty).';
comment on column public.logistics_receipt_items.accepted_qty is 'LOG-10: accepted quantity; the only part posted to stock.';

-- ------------------------------------- PO receiving status (LOG-13/15) --
-- Per inventory item on a PO: ordered, accepted on receipts (any status),
-- outstanding. Optionally excludes one receipt line (the one being checked).
create or replace function public.logistics_po_line_outstanding(p_po uuid, p_inventory_item uuid, p_exclude_line uuid default null)
returns table(ordered numeric, received numeric, outstanding numeric)
language sql stable security definer set search_path = public as $$
  with o as (
    select coalesce(sum(poi.quantity),0) as ordered
      from public.purchase_order_items poi
      join public.logistics_inventory_items ii on ii.id = p_inventory_item and ii.procurement_item_id = poi.item_id
     where poi.purchase_order_id = p_po
  ), r as (
    select coalesce(sum(ri.accepted_qty),0) as received
      from public.logistics_receipt_items ri
      join public.logistics_receipts rc on rc.id = ri.receipt_id
     where rc.purchase_order_id = p_po and ri.inventory_item_id = p_inventory_item
       and (p_exclude_line is null or ri.id <> p_exclude_line)
  )
  select o.ordered, r.received, greatest(o.ordered - r.received, 0) from o, r
   where exists (select 1 from public.purchase_orders po where po.id = p_po and public.business_row_visible(po.business_id));
$$;
-- called from the (invoker) receipt-line trigger, so authenticated needs
-- EXECUTE; it answers only for a PO in a business the caller can see.
revoke all on function public.logistics_po_line_outstanding(uuid, uuid, uuid) from public, anon;
grant execute on function public.logistics_po_line_outstanding(uuid, uuid, uuid) to authenticated, service_role;

-- For the receiving form: every PO line with its inventory item and
-- outstanding quantity. Invoker: the caller must be able to read the PO.
create or replace function public.logistics_po_receiving_status(p_po uuid)
returns table(inventory_item_id uuid, procurement_item_id uuid, description text, ordered numeric, received numeric, outstanding numeric)
language sql stable security invoker set search_path = public as $$
  select ii.id, poi.item_id, min(poi.description), sum(poi.quantity),
         coalesce((select sum(ri.accepted_qty) from public.logistics_receipt_items ri
                     join public.logistics_receipts rc on rc.id = ri.receipt_id
                    where rc.purchase_order_id = p_po and ri.inventory_item_id = ii.id), 0),
         greatest(sum(poi.quantity) - coalesce((select sum(ri.accepted_qty) from public.logistics_receipt_items ri
                     join public.logistics_receipts rc on rc.id = ri.receipt_id
                    where rc.purchase_order_id = p_po and ri.inventory_item_id = ii.id), 0), 0)
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    left join public.logistics_inventory_items ii on ii.procurement_item_id = poi.item_id and ii.business_id = po.business_id
   where poi.purchase_order_id = p_po
   group by ii.id, poi.item_id;
$$;
revoke all on function public.logistics_po_receiving_status(uuid) from public, anon;
grant execute on function public.logistics_po_receiving_status(uuid) to authenticated, service_role;

-- ------------------------------------------ receipt line guard ----------
-- SECURITY INVOKER on purpose: current_user tells a session user
-- (authenticated) from a trusted server context (service_role, migrations).
-- Lookups go through definer helpers so RLS cannot hide PO lines from it.
create or replace function public.logistics_receipt_item_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_trusted boolean := current_user not in ('authenticated', 'anon');
  v_receipt record;
  v_po_cost numeric;
  v_cost_ok boolean;
  v_out record;
  v_check boolean;
begin
  select id, status, purchase_order_id, receipt_number, business_id into v_receipt
    from public.logistics_receipts where id = coalesce(new.receipt_id, old.receipt_id);

  -- LOG-14: posted receipts are immutable
  if v_receipt.status = 'posted' then
    raise exception 'Receipt % is posted; its lines can no longer be added, changed or deleted.', v_receipt.receipt_number;
  end if;
  if tg_op = 'DELETE' then return old; end if;

  -- LOG-10: delivered = accepted + damaged + rejected
  new.damaged_qty := coalesce(new.damaged_qty, 0);
  new.rejected_qty := coalesce(new.rejected_qty, 0);
  if new.accepted_qty is null
     or (tg_op = 'UPDATE' and new.quantity is distinct from old.quantity
         and new.accepted_qty is not distinct from old.accepted_qty
         and new.damaged_qty is not distinct from old.damaged_qty
         and new.rejected_qty is not distinct from old.rejected_qty) then
    new.accepted_qty := new.quantity - new.damaged_qty - new.rejected_qty;
  end if;
  if new.accepted_qty < 0 or new.damaged_qty < 0 or new.rejected_qty < 0
     or new.accepted_qty + new.damaged_qty + new.rejected_qty <> new.quantity then
    raise exception 'Accepted (%), damaged (%) and rejected (%) quantities must be zero or more and add up to the delivered quantity (%).',
      new.accepted_qty, new.damaged_qty, new.rejected_qty, new.quantity;
  end if;

  -- LOG-39: unit cost comes from the PO line; cost-blind users cannot set it
  if v_receipt.purchase_order_id is not null then
    select nullif(max(poi.unit_cost), 0) into v_po_cost
      from public.purchase_order_items poi
      join public.logistics_inventory_items ii on ii.id = new.inventory_item_id and ii.procurement_item_id = poi.item_id
     where poi.purchase_order_id = v_receipt.purchase_order_id;
  end if;
  v_cost_ok := v_trusted or public.can_view_inventory_cost();
  if tg_op = 'INSERT' then
    if v_cost_ok then
      if coalesce(new.unit_cost, 0) = 0 then new.unit_cost := coalesce(v_po_cost, 0); end if;
    else
      if coalesce(new.unit_cost, 0) <> 0 and new.unit_cost is distinct from v_po_cost then
        raise exception 'Unit cost is taken from the purchase order; Logistics cannot enter or change it.';
      end if;
      new.unit_cost := coalesce(v_po_cost, 0);
    end if;
  elsif new.unit_cost is distinct from old.unit_cost and not v_cost_ok then
    raise exception 'Unit cost is taken from the purchase order; Logistics cannot enter or change it.';
  end if;

  -- LOG-13: over-receipt against the PO's outstanding quantity
  v_check := v_receipt.purchase_order_id is not null
         and (tg_op = 'INSERT'
              or new.accepted_qty is distinct from old.accepted_qty
              or new.inventory_item_id is distinct from old.inventory_item_id
              or new.over_receipt_approved is distinct from old.over_receipt_approved);
  if v_check then
    perform pg_advisory_xact_lock(hashtext('po-receive:' || v_receipt.purchase_order_id::text));
    select * into v_out from public.logistics_po_line_outstanding(v_receipt.purchase_order_id, new.inventory_item_id, new.id);
    if not found then raise exception 'Purchase order not found.'; end if;
    if new.accepted_qty > v_out.outstanding then
      if not new.over_receipt_approved then
        raise exception 'Over-receipt: accepted quantity % exceeds the outstanding % on the purchase order (ordered %, already received %). A logistics approver or Business Admin must approve the over-receipt.',
          new.accepted_qty, v_out.outstanding, v_out.ordered, v_out.received
          using errcode = 'P0001', hint = 'over_receipt';
      end if;
      if not (v_trusted or public.can_approve_logistics_exceptions()) then
        raise exception 'Only a logistics approver or Business Admin can approve an over-receipt (accepted %, outstanding %).',
          new.accepted_qty, v_out.outstanding;
      end if;
      new.over_receipt_approved_by := auth.uid();
      new.over_receipt_approved_at := now();
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'logistics_receipt_items', new.id, 'over_receipt_approved',
              jsonb_build_object('receipt_id', new.receipt_id, 'receipt_number', v_receipt.receipt_number,
                                 'purchase_order_id', v_receipt.purchase_order_id,
                                 'inventory_item_id', new.inventory_item_id,
                                 'accepted_qty', new.accepted_qty, 'ordered', v_out.ordered,
                                 'already_received', v_out.received, 'outstanding', v_out.outstanding,
                                 'over_by', new.accepted_qty - v_out.outstanding));
    else
      new.over_receipt_approved := false;
      new.over_receipt_approved_by := null;
      new.over_receipt_approved_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists logistics_receipt_item_guard on public.logistics_receipt_items;
create trigger logistics_receipt_item_guard
  before insert or update or delete on public.logistics_receipt_items
  for each row execute function public.logistics_receipt_item_guard();

-- --------------------------------------------- post_receipt_to_stock ----
create or replace function public.post_receipt_to_stock(p_receipt_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare r record; l record;
begin
  select * into r from public.logistics_receipts where id=p_receipt_id for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if not public.is_super_admin() and r.business_id is distinct from public.current_business_id() then
    raise exception 'Receipt does not belong to your business.';
  end if;
  if r.status='posted' then return; end if;
  if r.status <> 'approved' then raise exception 'Receipt must be approved before posting.'; end if;

  -- LOG-10: only the ACCEPTED quantity enters stock. One movement per item
  -- (uq_stock_movement_source_line allows one per receipt+item+location).
  for l in
    select ri.inventory_item_id,
           sum(ri.accepted_qty) as qty,
           round(sum(ri.accepted_qty * ri.unit_cost) / nullif(sum(ri.accepted_qty), 0), 2) as unit_cost,
           case when count(distinct coalesce(ri.lot_number, '')) = 1 then max(ri.lot_number) end as lot_number,
           string_agg(distinct ri.description, '; ') as description
      from public.logistics_receipt_items ri
     where ri.receipt_id = r.id
     group by ri.inventory_item_id
    having sum(ri.accepted_qty) > 0
  loop
    insert into public.logistics_stock_movements(
      business_id, inventory_item_id, location_id, movement_date, movement_type, quantity,
      unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_number
    ) values (
      r.business_id, l.inventory_item_id, r.location_id, r.receipt_date, 'receipt', l.qty,
      coalesce(l.unit_cost, 0), 'logistics_receipts', r.id, r.receipt_number, l.description, p_actor, l.lot_number
    ) on conflict (source_table, source_record_id, inventory_item_id, location_id, movement_type)
      where source_table is not null and source_record_id is not null do nothing;
  end loop;

  update public.logistics_receipts set status='posted', posted_at=now(), updated_at=now()
   where id=r.id and status='approved';
end $function$;
revoke all on function public.post_receipt_to_stock(uuid, uuid) from public, anon;
grant execute on function public.post_receipt_to_stock(uuid, uuid) to authenticated, service_role;

-- --------------------------------------------------- LOG-05 types -------
update public.logistics_locations set location_type = case
    when lower(btrim(location_type)) in ('warehouse','store','office','transit','other') then lower(btrim(location_type))
    when lower(btrim(location_type)) in ('wh','warehouse ','storage','stockroom','stock room','depot','bodega','main warehouse') then 'warehouse'
    when lower(btrim(location_type)) in ('shop','branch','showroom','retail','outlet','counter','storefront') then 'store'
    when lower(btrim(location_type)) in ('admin','head office','main office','hq') then 'office'
    when lower(btrim(location_type)) in ('van','truck','vehicle','in transit','in-transit','jobsite','job site','site') then 'transit'
    else 'other' end
 where location_type is null
    or location_type not in ('warehouse','store','office','transit','other');
alter table public.logistics_locations alter column location_type set default 'warehouse';
alter table public.logistics_locations drop constraint if exists logistics_locations_location_type_check;
alter table public.logistics_locations add constraint logistics_locations_location_type_check
  check (location_type in ('warehouse','store','office','transit','other'));

-- --------------------------------------------------- LOG-24 codes -------
drop function if exists public.validate_logistics_inventory_uuid(text, text);

create or replace function public.logistics_location_code_format()
returns trigger language plpgsql set search_path = public as $$
begin
  new.location_code := upper(btrim(coalesce(new.location_code, '')));
  if new.location_code !~ '^[A-Z0-9][A-Z0-9_-]{0,29}$' then
    raise exception 'Location code "%" is not valid: use 1–30 letters, digits, "-" or "_" (e.g. WH-001).', new.location_code;
  end if;
  return new;
end $$;
-- fires before logistics_locations_guard (alphabetical), so the duplicate
-- check sees the normalised code
drop trigger if exists logistics_location_code_format on public.logistics_locations;
create trigger logistics_location_code_format before insert or update of location_code
  on public.logistics_locations for each row execute function public.logistics_location_code_format();

create or replace function public.logistics_inventory_code_format()
returns trigger language plpgsql set search_path = public as $$
begin
  new.item_code := btrim(coalesce(new.item_code, ''));
  if new.item_code = '' or length(new.item_code) > 64 or new.item_code ~ '[[:cntrl:]]' then
    raise exception 'Inventory item code "%" is not valid: 1–64 printable characters.', new.item_code;
  end if;
  return new;
end $$;
drop trigger if exists logistics_inventory_code_format on public.logistics_inventory_items;
create trigger logistics_inventory_code_format before insert or update of item_code
  on public.logistics_inventory_items for each row execute function public.logistics_inventory_code_format();

-- ------------------------------------- balance view gets business_id ----
create or replace view public.logistics_stock_balance as
 select sm.inventory_item_id, sm.location_id,
    coalesce(sum(case when sm.movement_type in ('receipt','transfer_in','adjustment') then sm.quantity else 0 end), 0) as total_in,
    coalesce(sum(case when sm.movement_type in ('issue','transfer_out') then sm.quantity else 0 end), 0) as total_out,
    coalesce(sum(case when sm.movement_type in ('receipt','transfer_in','adjustment') then sm.quantity else -sm.quantity end), 0) as on_hand,
    sm.business_id
   from public.logistics_stock_movements sm
  group by sm.inventory_item_id, sm.location_id, sm.business_id;
alter view public.logistics_stock_balance set (security_invoker = true);

-- ----------------------------------------------- LOG-40 ledger ----------
create or replace function public.logistics_stock_ledger(
  p_search text default null, p_movement_type text default null, p_location uuid default null,
  p_item uuid default null, p_date_from date default null, p_date_to date default null,
  p_limit integer default 50, p_offset integer default 0)
returns table(
  id uuid, movement_number text, movement_date date, movement_type text,
  inventory_item_id uuid, item_code text, item_name text, unit text,
  location_id uuid, location_code text, location_name text, lot_number text,
  quantity numeric, signed_quantity numeric, running_balance numeric, unit_cost numeric,
  source_table text, source_record_id uuid, reference_number text, notes text,
  created_at timestamptz, total_count bigint)
language sql stable security invoker set search_path = public as $$
  with base as (
    select sm.*,
           case when sm.movement_type in ('receipt','transfer_in','adjustment') then sm.quantity else -sm.quantity end as signed_qty
      from public.logistics_stock_movements sm
     where (p_item is null or sm.inventory_item_id = p_item)
       and (p_location is null or sm.location_id = p_location)
  ), bal as (
    select b.*, sum(b.signed_qty) over (partition by b.inventory_item_id, b.location_id
                                        order by b.movement_date, b.created_at, b.id
                                        rows between unbounded preceding and current row) as running_balance
      from base b
  ), f as (
    select bal.*, ii.item_code, ii.item_name, ii.unit, lo.location_code, lo.location_name
      from bal
      join public.logistics_inventory_items ii on ii.id = bal.inventory_item_id
      join public.logistics_locations lo on lo.id = bal.location_id
     where (p_movement_type is null or p_movement_type = '' or bal.movement_type = p_movement_type)
       and (p_date_from is null or bal.movement_date >= p_date_from)
       and (p_date_to is null or bal.movement_date <= p_date_to)
       and (coalesce(btrim(p_search), '') = ''
            or concat_ws(' ', bal.movement_number, bal.reference_number, bal.lot_number, ii.item_code, ii.item_name, lo.location_code)
               ilike '%' || btrim(p_search) || '%')
  )
  select f.id, f.movement_number, f.movement_date, f.movement_type,
         f.inventory_item_id, f.item_code, f.item_name, f.unit,
         f.location_id, f.location_code, f.location_name, f.lot_number,
         f.quantity, f.signed_qty, f.running_balance,
         case when public.can_view_inventory_cost() then f.unit_cost end,
         f.source_table, f.source_record_id, f.reference_number, f.notes, f.created_at,
         count(*) over ()
    from f
   order by f.movement_date desc, f.created_at desc, f.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.logistics_stock_ledger(text, text, uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.logistics_stock_ledger(text, text, uuid, uuid, date, date, integer, integer) to authenticated, service_role;

-- ------------------------------------------- LOG-02/03/07 dashboard -----
create or replace function public.logistics_dashboard_kpis()
returns table(business_id uuid, business_code text, business_name text,
              active_locations bigint, active_items bigint,
              receipts_in_workflow bigint, receipts_awaiting_post bigint, adhoc_receipts_open bigint,
              transfers_pending bigint, low_stock_items bigint,
              on_hand_qty numeric, on_hand_value numeric)
language sql stable security invoker set search_path = public as $$
  with bal as (
    select sm.business_id, sm.inventory_item_id, sm.location_id,
           sum(case when sm.movement_type in ('receipt','transfer_in','adjustment') then sm.quantity else -sm.quantity end) as on_hand
      from public.logistics_stock_movements sm group by 1,2,3
  ), biz as (
    select b.id, b.code, coalesce(b.trade_name, b.legal_name, b.code) as name
      from public.businesses b
     where public.business_row_visible(b.id)
       and (exists (select 1 from public.logistics_locations l where l.business_id = b.id)
            or exists (select 1 from public.logistics_inventory_items i where i.business_id = b.id)
            or b.id = public.current_business_id())
  )
  select biz.id, biz.code, biz.name,
    (select count(*) from public.logistics_locations l where l.business_id = biz.id and l.active),
    (select count(*) from public.logistics_inventory_items i where i.business_id = biz.id and i.active),
    (select count(*) from public.logistics_receipts r where r.business_id = biz.id and r.status in ('draft','prepared','reviewed')),
    (select count(*) from public.logistics_receipts r where r.business_id = biz.id and r.status = 'approved'),
    (select count(*) from public.logistics_receipts r where r.business_id = biz.id and r.purchase_order_id is null and r.status <> 'posted'),
    (select count(*) from public.logistics_stock_transfers t where t.business_id = biz.id and t.status <> 'posted'),
    (select count(distinct s.inventory_item_id) from public.logistics_inventory_location_settings s
       join public.logistics_inventory_items i on i.id = s.inventory_item_id and i.business_id = biz.id and i.active
       join public.logistics_locations l on l.id = s.location_id and l.active
       left join bal on bal.inventory_item_id = s.inventory_item_id and bal.location_id = s.location_id
      where s.active and s.reorder_level > 0 and coalesce(bal.on_hand, 0) <= s.reorder_level),
    (select coalesce(sum(bal.on_hand), 0) from bal where bal.business_id = biz.id),
    case when public.can_view_inventory_cost() then
      (select coalesce(sum(bal.on_hand * c.avg_cost), 0) from bal
         join public.inventory_item_costs c on c.business_id = bal.business_id and c.item_id = bal.inventory_item_id
        where bal.business_id = biz.id and bal.on_hand > 0) end
  from biz order by biz.code;
$$;
revoke all on function public.logistics_dashboard_kpis() from public, anon;
grant execute on function public.logistics_dashboard_kpis() to authenticated, service_role;

create or replace function public.logistics_period_summary(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'movements', coalesce((select jsonb_object_agg(movement_type, jsonb_build_object('qty', qty, 'count', n))
                             from (select sm.movement_type, sum(sm.quantity) as qty, count(*) as n
                                     from public.logistics_stock_movements sm
                                    where sm.movement_date between p_from and p_to group by 1) m), '{}'::jsonb),
    'receiving', (select jsonb_build_object(
                    'receipts', count(distinct r.id),
                    'adhoc_receipts', count(distinct r.id) filter (where r.purchase_order_id is null),
                    'po_receipts', count(distinct r.id) filter (where r.purchase_order_id is not null),
                    'posted', count(distinct r.id) filter (where r.status = 'posted'),
                    'delivered', coalesce(sum(ri.quantity), 0),
                    'accepted', coalesce(sum(ri.accepted_qty), 0),
                    'damaged', coalesce(sum(ri.damaged_qty), 0),
                    'rejected', coalesce(sum(ri.rejected_qty), 0),
                    'over_receipts', count(*) filter (where ri.over_receipt_approved))
                  from public.logistics_receipts r
                  left join public.logistics_receipt_items ri on ri.receipt_id = r.id
                 where r.receipt_date between p_from and p_to));
$$;
revoke all on function public.logistics_period_summary(date, date) from public, anon;
grant execute on function public.logistics_period_summary(date, date) to authenticated, service_role;
