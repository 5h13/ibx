-- ============================================================================
-- Build 78 — stock reservation (U063), lot picking at the counter and on DRs,
-- hardcopy DR number on Storefront sales (SF-29). Decided by the owner
-- 2026-10-02.
--
-- Reservation
--   • The "from stock" lines of approved sales orders (approved / processing)
--     reserve their quantity until the Warehouse releases their DR; an order
--     cancellation releases what is left. Nothing is stored: reserved =
--     ordered − released, computed live.
--   • The counter and Product Search show On hand, Reserved and Available
--     (on hand − reserved).
--   • A counter sale that would take reserved stock needs an approver
--     (approval reason "reserved_stock"). Negative stock stays a warning.
--
-- Lots at the counter and on DRs
--   • Every product line carries a lot. The cashier picks it; the oldest lot
--     with stock at the store is filled in (server-side too, when none is
--     sent). For a supplier ("order from supplier") line of a sales order the
--     lot received on that order's PO is filled in first.
--   • A line's lot must be a lot of that item in this store; one item may be
--     sold from several lots on separate lines.
--
-- Hardcopy DR no.
--   • Optional on a Storefront sale (counter sale or order DR): the number of
--     the handwritten DR used on site. Unique per store, searchable in the
--     register and when finding a sale for a return, shown on the DR print
--     and in lot traces.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Hardcopy DR number
-- ---------------------------------------------------------------------------
alter table public.storefront_sales add column if not exists hardcopy_dr_no text;
alter table public.storefront_sales drop constraint if exists storefront_sales_hardcopy_dr_len;
alter table public.storefront_sales add constraint storefront_sales_hardcopy_dr_len check (hardcopy_dr_no is null or char_length(hardcopy_dr_no) between 1 and 40);
create or replace function public.sf_hardcopy_key(p text)
returns text language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g')), '') $$;
create unique index if not exists storefront_sales_hardcopy_dr_key
  on public.storefront_sales (business_id, public.sf_hardcopy_key(hardcopy_dr_no))
  where hardcopy_dr_no is not null and status <> 'cancelled';

-- the lot code on the sale line, for screens and prints of users who cannot read lot rows
alter table public.storefront_sale_items add column if not exists lot_code text;
update public.storefront_sale_items i set lot_code = l.lot_code from public.inventory_lots l where l.id = i.lot_id and i.lot_code is null;

create or replace function public.sf_check_hardcopy(p_business uuid, p_no text, p_sale uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := nullif(btrim(coalesce(p_no, '')), ''); v_other text;
begin
  if v is null then return null; end if;
  if char_length(v) > 40 then raise exception 'The hardcopy DR no. is too long (40 characters at most).'; end if;
  select sale_number into v_other from public.storefront_sales
   where business_id = p_business and status <> 'cancelled' and public.sf_hardcopy_key(hardcopy_dr_no) = public.sf_hardcopy_key(v)
     and (p_sale is null or id <> p_sale) limit 1;
  if v_other is not null then raise exception 'Hardcopy DR no. % is already recorded on sale % in this store.', v, v_other; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Reservation
-- ---------------------------------------------------------------------------
-- quantity of a catalog item reserved by approved orders' "from stock" lines
create or replace function public.inventory_reserved(p_business uuid, p_catalog_item uuid, p_exclude_order uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(soi.quantity - dl.released, 0)), 0)
    from public.sales_order_items soi
    join public.sales_orders so on so.id = soi.order_id
    cross join lateral public.sf_order_line_delivered(soi.id) dl
   where so.business_id = p_business and so.status::text in ('approved', 'processing')
     and soi.fulfilment = 'stock' and soi.catalog_item_id = p_catalog_item
     and (p_exclude_order is null or so.id <> p_exclude_order);
$$;

-- the orders holding a reservation on an item (for the screens)
create or replace function public.inventory_reservations(p_catalog_item uuid)
returns table(order_id uuid, order_number text, customer text, order_date date, reserved numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if auth.uid() is null or not (public.can_view_lots() or public.can_read_shared_catalog()) then raise exception 'Access required.'; end if;
  if b is null then return; end if;
  return query
  select so.id, so.order_number, c.legal_name, so.order_date, sum(greatest(soi.quantity - dl.released, 0))
    from public.sales_order_items soi
    join public.sales_orders so on so.id = soi.order_id
    join public.finance_customers c on c.id = so.customer_id
    cross join lateral public.sf_order_line_delivered(soi.id) dl
   where so.business_id = b and so.status::text in ('approved', 'processing') and soi.fulfilment = 'stock' and soi.catalog_item_id = p_catalog_item
   group by so.id, c.legal_name
  having sum(greatest(soi.quantity - dl.released, 0)) > 0
   order by so.order_date, so.order_number;
end $$;

-- cancel a sales order (releases its reservation). Only while no DR is out for it.
create or replace function public.sales_order_cancel(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); o record; v_drs int; v_pr text;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver, a Business Admin or the Super Admin can cancel a sales order.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the order is cancelled.'; end if;
  select * into o from public.sales_orders where id = p_order and business_id = b for update;
  if not found then raise exception 'Sales order not found in this business.'; end if;
  if o.status::text in ('cancelled', 'fulfilled') then raise exception 'Order % is already %.', o.order_number, o.status; end if;
  select count(*) into v_drs
    from public.storefront_sales s
   where s.sales_order_id = o.id and s.status = 'completed'
     and exists (select 1 from public.storefront_sale_items i
                  where i.sale_id = s.id and i.quantity > coalesce((select sum(ri.quantity) from public.storefront_return_items ri where ri.sale_item_id = i.id), 0));
  if v_drs > 0 then
    raise exception 'Order % already has % DR(s) issued; return or cancel those sales at the Storefront first.', o.order_number, v_drs;
  end if;
  update public.sales_orders set status = 'cancelled', updated_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Cancelled ' || to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD') || ': ' || btrim(p_reason)
   where id = o.id;
  select pr_number into v_pr from public.purchase_requisitions where id = o.purchase_requisition_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_orders', o.id, 'sales_order_cancelled', jsonb_build_object('order_number', o.order_number, 'reason', btrim(p_reason), 'previous_status', o.status, 'pr_number', v_pr));
  return jsonb_build_object('order_number', o.order_number, 'pr_number', v_pr);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Lot of a sale line: validate, or fill in the default
-- ---------------------------------------------------------------------------
create or replace function public.sf_line_lot(p_business uuid, p_inv uuid, p_location uuid, p_lot uuid, p_order_item uuid default null)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_lot record; v_id uuid;
begin
  if p_inv is null then
    if p_lot is not null then raise exception 'A service line has no lot.'; end if;
    return null;
  end if;
  if p_lot is not null then
    select business_id, inventory_item_id, lot_code into v_lot from public.inventory_lots where id = p_lot;
    if not found or v_lot.business_id <> p_business or v_lot.inventory_item_id <> p_inv then
      raise exception 'The lot chosen is not a lot of this item in this store.';
    end if;
    return p_lot;
  end if;
  -- a supplier line of an order: the lot received on that order's PO, when it still has stock here
  if p_order_item is not null then
    select l.id into v_id
      from public.sales_order_items soi
      join public.purchase_order_items poi on poi.source_requisition_item_id = soi.purchase_requisition_item_id
      join public.inventory_lots l on l.purchase_order_id = poi.purchase_order_id and l.inventory_item_id = p_inv and l.business_id = p_business
     where soi.id = p_order_item and soi.purchase_requisition_item_id is not null
       and public.inventory_lot_on_hand(l.id, p_location) > 0
     order by l.received_date, l.lot_code limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  return public.inventory_oldest_lot(p_business, p_inv, p_location);
end $$;

-- lots with stock at a location, for a picker (no cost)
create or replace function public.sf_lot_options(p_business uuid, p_inv uuid, p_location uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot_code', l.lot_code, 'received_date', l.received_date, 'on_hand', b.on_hand,
                                               'supplier_lot_no', l.supplier_lot_no, 'expiry_date', l.expiry_date) order by l.received_date, l.lot_code), '[]'::jsonb)
    from public.inventory_item_lot_balances(p_business, p_inv, p_location) b
    join public.inventory_lots l on l.id = b.lot_id
   where b.on_hand > 0;
$$;

-- ---------------------------------------------------------------------------
-- 4. Counter sale: lots, reservation check, hardcopy DR no.
-- ---------------------------------------------------------------------------
create or replace function public.storefront_submit_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); st record; v_sale uuid; v_no text; v_customer uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
        l record; pr record; v_sub numeric := 0; v_tot numeric := 0; v_below boolean := false; v_nocost boolean := false; v_status text;
        v_date date; v_reasons text[] := '{}'; v_inv uuid; v_lot uuid; v_hard text; g record; v_res numeric; v_here numeric; v_reserved jsonb := '[]'::jsonb;
begin
  select * into st from public.storefront_settings where business_id = b;
  if st.location_id is null then raise exception 'The Storefront has no stock location yet: a Business Admin sets it in Storefront settings.'; end if;
  v_customer := coalesce(nullif(p->>'customer_id', '')::uuid, public.storefront_walk_in(b));
  if not exists (select 1 from public.finance_customers where id = v_customer and business_id = b and active) then
    raise exception 'Customer not found in this business.';
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  v_date := coalesce(nullif(p->>'sale_date', '')::date, v_today);
  if v_date > v_today then raise exception 'The sale date cannot be in the future.'; end if;
  if v_date < v_today and coalesce(btrim(p->>'late_reason'), '') = '' then raise exception 'Say why this sale is entered late (e.g. system was down, sale made off-site).'; end if;
  v_hard := public.sf_check_hardcopy(b, p->>'hardcopy_dr_no');

  v_no := public.storefront_next_number('SF', 'storefront_sales', 'sale_number');
  insert into public.storefront_sales(business_id, sale_number, sale_date, customer_id, location_id, status, notes, created_by, late_entry, late_reason, hardcopy_dr_no)
  values (b, v_no, v_date, v_customer, st.location_id, 'pending_approval', nullif(btrim(p->>'notes'), ''), auth.uid(), v_date < v_today,
          case when v_date < v_today then btrim(p->>'late_reason') end, v_hard)
  returning id into v_sale;

  for l in select * from jsonb_to_recordset(p->'lines') as x(item_id uuid, quantity numeric, unit_price numeric, lot_id uuid) loop
    select * into pr from public.storefront_item_price(l.item_id, b);
    if not found then raise exception 'An item on the sale is not an active catalog item.'; end if;
    if coalesce(l.quantity, 0) <= 0 then raise exception 'Quantity for % must be more than zero.', pr.item_name; end if;
    l.unit_price := round(coalesce(l.unit_price, pr.list_price), 2);
    if l.unit_price < 0 then raise exception 'Price for % cannot be negative.', pr.item_name; end if;
    v_inv := case when pr.item_type <> 'service' then public.ensure_inventory_link(pr.item_id, b) end;
    v_lot := public.sf_line_lot(b, v_inv, st.location_id, l.lot_id);
    if exists (select 1 from public.storefront_sale_items where sale_id = v_sale and item_id = pr.item_id and lot_id is not distinct from v_lot) then
      raise exception '% is on the sale twice from the same lot: put the quantity on one line.', pr.item_name;
    end if;
    insert into public.storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, acquisition_cost, floor_price, below_floor, line_total,
                                             inventory_item_id, lot_id, lot_code)
    values (b, v_sale, pr.item_id, pr.item_code, pr.item_name, pr.unit, pr.item_type, l.quantity, pr.list_price, l.unit_price, pr.acquisition_cost, pr.floor_price,
            l.unit_price < pr.floor_price or coalesce(pr.acquisition_cost, 0) <= 0, round(l.quantity * l.unit_price, 2), v_inv, v_lot,
            (select lot_code from public.inventory_lots where id = v_lot));
    v_sub := v_sub + round(l.quantity * pr.list_price, 2);
    v_tot := v_tot + round(l.quantity * l.unit_price, 2);
    v_below := v_below or l.unit_price < pr.floor_price;
    v_nocost := v_nocost or coalesce(pr.acquisition_cost, 0) <= 0;
  end loop;

  -- reserved stock: taking more than on hand − reserved at the store needs an approver
  for g in select item_id, max(description) as name, sum(quantity) as qty from public.storefront_sale_items
            where sale_id = v_sale and item_type <> 'service' and item_id is not null group by item_id loop
    v_res := public.inventory_reserved(b, g.item_id);
    if v_res > 0 then
      v_here := public.q77_on_hand(b, g.item_id, st.location_id);
      if g.qty > greatest(v_here - v_res, 0) then
        v_reserved := v_reserved || jsonb_build_object('item', g.name, 'quantity', g.qty, 'on_hand', v_here, 'reserved', v_res, 'available', greatest(v_here - v_res, 0));
      end if;
    end if;
  end loop;

  if v_below then v_reasons := array_append(v_reasons, 'below_floor'); end if;
  if v_nocost then v_reasons := array_append(v_reasons, 'no_cost'); end if;
  if v_date < v_today then v_reasons := array_append(v_reasons, 'late_entry'); end if;
  if jsonb_array_length(v_reserved) > 0 then v_reasons := array_append(v_reasons, 'reserved_stock'); end if;
  update public.storefront_sales set subtotal = v_sub, total = v_tot, discount_total = greatest(v_sub - v_tot, 0), below_floor = v_below or v_nocost,
                                     approval_reasons = v_reasons where id = v_sale;
  if cardinality(v_reasons) > 0 then
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'storefront_sales', v_sale, 'storefront_sale_approval_requested',
            jsonb_build_object('sale_number', v_no, 'total', v_tot, 'reasons', v_reasons, 'sale_date', v_date, 'reserved_stock', v_reserved));
    v_status := 'pending_approval';
  else
    perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', coalesce((p->>'issue_dr')::boolean, true));
    v_status := 'completed';
  end if;
  return jsonb_build_object('id', v_sale, 'sale_number', v_no, 'status', v_status, 'total', v_tot, 'reasons', v_reasons, 'reserved_stock', v_reserved);
end $$;

-- ---------------------------------------------------------------------------
-- 5. DR from a sales order: lot per line (a line may be split across lots), hardcopy DR no.
-- ---------------------------------------------------------------------------
create or replace function public.storefront_order_dr(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); st record; o record; l record; oi record; dl record; v_sale uuid; v_no text; v_tot numeric := 0; v_recv numeric;
        pr record; v_type text; v_any boolean := false; v_inv uuid; v_lot uuid; v_hard text; t record;
begin
  select * into st from public.storefront_settings where business_id = b;
  if st.location_id is null then raise exception 'The Storefront has no stock location yet: a Business Admin sets it in Storefront settings.'; end if;
  select * into o from public.sales_orders where id = nullif(p->>'order_id', '')::uuid and business_id = b for update;
  if not found then raise exception 'Sales order not found in this business.'; end if;
  if o.status::text not in ('approved','processing') then raise exception 'Order % is %; DRs are issued for approved orders only.', o.order_number, o.status; end if;
  v_hard := public.sf_check_hardcopy(b, p->>'hardcopy_dr_no');

  -- quantities per order line (one line may come in several rows, one per lot)
  for t in select x.sales_order_item_id, sum(x.quantity) as qty
             from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) as x(sales_order_item_id uuid, quantity numeric, lot_id uuid)
            where coalesce(x.quantity, 0) > 0 group by x.sales_order_item_id loop
    select * into oi from public.sales_order_items where id = t.sales_order_item_id and order_id = o.id;
    if not found then raise exception 'A line is not on order %.', o.order_number; end if;
    select * into dl from public.sf_order_line_delivered(oi.id);
    if t.qty > oi.quantity - dl.delivered then
      raise exception '%: only % left to deliver on this order.', oi.description, (oi.quantity - dl.delivered)::text;
    end if;
    if oi.fulfilment = 'source' then
      v_recv := public.sf_order_line_received(oi.id);
      if t.qty > v_recv - dl.delivered then
        raise exception '%: % received from the supplier so far and % already delivered; deliver the rest after its PO is received.', oi.description, v_recv::text, dl.delivered::text;
      end if;
    end if;
  end loop;

  v_no := public.storefront_next_number('SF', 'storefront_sales', 'sale_number');
  insert into public.storefront_sales(business_id, sale_number, customer_id, location_id, status, notes, created_by, sales_order_id, hardcopy_dr_no)
  values (b, v_no, o.customer_id, st.location_id, 'pending_approval',
          coalesce(nullif(btrim(p->>'notes'), '') || ' · ', '') || 'Order ' || o.order_number || coalesce(', client PO ' || o.client_po_number, ''), auth.uid(), o.id, v_hard)
  returning id into v_sale;

  for l in select * from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) as x(sales_order_item_id uuid, quantity numeric, lot_id uuid) loop
    if coalesce(l.quantity, 0) <= 0 then continue; end if;
    select * into oi from public.sales_order_items where id = l.sales_order_item_id and order_id = o.id;
    pr := null;
    if oi.catalog_item_id is not null then select * into pr from public.storefront_item_price(oi.catalog_item_id, b); end if;
    v_type := case when oi.catalog_item_id is null or oi.fulfilment = 'service' then 'service' else coalesce(pr.item_type, 'product') end;
    v_inv := case when v_type <> 'service' then public.ensure_inventory_link(oi.catalog_item_id, b) end;
    v_lot := public.sf_line_lot(b, v_inv, st.location_id, l.lot_id, oi.id);
    if exists (select 1 from public.storefront_sale_items where sale_id = v_sale and sales_order_item_id = oi.id and lot_id is not distinct from v_lot) then
      raise exception '% is on the DR twice from the same lot: put the quantity on one row.', oi.description;
    end if;
    insert into public.storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, acquisition_cost,
                                             floor_price, below_floor, line_total, sales_order_item_id, inventory_item_id, lot_id, lot_code)
    values (b, v_sale, oi.catalog_item_id, pr.item_code, oi.description, oi.unit, v_type, l.quantity, oi.unit_price, oi.unit_price,
            coalesce(pr.acquisition_cost, oi.estimated_unit_cost), null, false, round(l.quantity * oi.unit_price, 2), oi.id, v_inv, v_lot,
            (select lot_code from public.inventory_lots where id = v_lot));
    v_tot := v_tot + round(l.quantity * oi.unit_price, 2);
    v_any := true;
  end loop;
  if not v_any then raise exception 'Enter the quantity to deliver on at least one line.'; end if;

  update public.storefront_sales set subtotal = v_tot, total = v_tot where id = v_sale;
  perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', true);
  if o.status::text = 'approved' then update public.sales_orders set status = 'processing', updated_at = now() where id = o.id; end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', v_sale, 'storefront_order_dr_issued', jsonb_build_object('sale_number', v_no, 'order_number', o.order_number, 'total', v_tot, 'hardcopy_dr_no', v_hard));
  return (select jsonb_build_object('id', id, 'sale_number', sale_number, 'dr_number', dr_number, 'total', total, 'balance', balance) from public.storefront_sales where id = v_sale);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Counter price lines: on hand, reserved, available, lots
-- ---------------------------------------------------------------------------
drop function if exists public.storefront_price_lines(uuid[]);
create function public.storefront_price_lines(p_items uuid[])
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, floor_price numeric, on_hand numeric, no_cost boolean,
              reserved numeric, available numeric, default_lot_id uuid, lots jsonb)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); loc uuid;
begin
  select location_id into loc from public.storefront_settings where business_id = b;
  return query
  select p.item_id, p.item_code, p.item_name, p.unit, p.item_type, p.list_price, p.floor_price,
         case when p.item_type = 'service' then null else public.q77_on_hand(b, p.item_id, loc) end,
         coalesce(p.acquisition_cost, 0) <= 0,
         case when p.item_type = 'service' then null else public.inventory_reserved(b, p.item_id) end,
         case when p.item_type = 'service' then null else public.q77_on_hand(b, p.item_id, loc) - public.inventory_reserved(b, p.item_id) end,
         case when p.item_type = 'service' or loc is null then null else public.sf_line_lot(b, inv.id, loc, null) end,
         case when p.item_type = 'service' or loc is null or inv.id is null then '[]'::jsonb else public.sf_lot_options(b, inv.id, loc) end
    from unnest(p_items) x(id)
    cross join lateral public.storefront_item_price(x.id, b) p
    left join lateral (select ii.id from public.logistics_inventory_items ii where ii.business_id = b and ii.procurement_item_id = p.item_id limit 1) inv on true;
end $$;
grant execute on function public.storefront_price_lines(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Orders tab: reserved per line, lots to pick for each line
-- ---------------------------------------------------------------------------
create or replace function public.storefront_orders(p_include_done boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); loc uuid;
begin
  if not public.can_view_storefront() then raise exception 'Storefront access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select location_id into loc from public.storefront_settings where business_id = b;
  return coalesce((
    select jsonb_agg(x.o order by x.d desc) from (
      select so.order_date as d, jsonb_build_object(
        'id', so.id, 'order_number', so.order_number, 'order_date', so.order_date, 'status', so.status, 'quotation_number', q.quotation_number,
        'customer_id', so.customer_id, 'customer', c.legal_name, 'client_po', so.client_po_number, 'payment_terms', so.payment_terms,
        'vat_applied', so.vat_applied, 'total', so.total_amount, 'delivery_address', so.delivery_address, 'requested_delivery_date', so.requested_delivery_date,
        'pr_number', pr.pr_number,
        'po_numbers', coalesce((select jsonb_agg(distinct po.po_number) from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
                                  join public.purchase_requisition_items pri on pri.id = poi.source_requisition_item_id where pri.requisition_id = so.purchase_requisition_id), '[]'::jsonb),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', soi.id, 'description', soi.description, 'unit', soi.unit, 'ordered', soi.quantity, 'unit_price', soi.unit_price, 'fulfilment', soi.fulfilment,
                   'catalog_item_id', soi.catalog_item_id, 'delivered', dl.delivered, 'released', dl.released,
                   'received', case when soi.fulfilment = 'source' then public.sf_order_line_received(soi.id) end,
                   'on_hand', case when soi.catalog_item_id is null or soi.fulfilment = 'service' then null else public.q77_on_hand(b, soi.catalog_item_id, loc) end,
                   'reserved_here', case when soi.fulfilment = 'stock' then greatest(soi.quantity - dl.released, 0) else 0 end,
                   'reserved_total', case when soi.catalog_item_id is null or soi.fulfilment = 'service' then null else public.inventory_reserved(b, soi.catalog_item_id) end,
                   'default_lot_id', case when inv.id is null or loc is null then null else public.sf_line_lot(b, inv.id, loc, null, soi.id) end,
                   'lots', case when inv.id is null or loc is null then '[]'::jsonb else public.sf_lot_options(b, inv.id, loc) end
                 ) order by soi.ctid)
                 from public.sales_order_items soi
                 cross join lateral public.sf_order_line_delivered(soi.id) dl
                 left join lateral (select ii.id from public.logistics_inventory_items ii
                                     where ii.business_id = b and ii.procurement_item_id = soi.catalog_item_id and soi.fulfilment <> 'service' limit 1) inv on true
                where soi.order_id = so.id), '[]'::jsonb),
        'drs', coalesce((select jsonb_agg(jsonb_build_object('sale_id', s.id, 'sale_number', s.sale_number, 'dr_number', s.dr_number, 'si_number', s.si_number,
                   'sale_date', s.sale_date, 'total', s.total, 'release_status', s.release_status, 'released_at', s.released_at, 'hardcopy_dr_no', s.hardcopy_dr_no,
                   'invoice_number', inv.invoice_number, 'invoice_status', inv.status, 'balance_due', inv.balance_due, 'due_date', inv.due_date) order by s.created_at)
                 from public.storefront_sales s left join public.finance_customer_invoices inv on inv.id = s.ar_invoice_id
                where s.sales_order_id = so.id and s.status = 'completed'), '[]'::jsonb)
      ) as o
      from public.sales_orders so
      join public.finance_customers c on c.id = so.customer_id
      left join public.sales_quotations q on q.id = so.quotation_id
      left join public.purchase_requisitions pr on pr.id = so.purchase_requisition_id
     where so.business_id = b and so.status::text in ('approved','processing') or (so.business_id = b and p_include_done and so.status::text = 'fulfilled')
    ) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Return lookup: also by hardcopy DR no.; lines show their lot
-- ---------------------------------------------------------------------------
create or replace function public.storefront_sale_for_return(p_sale_number text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; v_bal numeric := 0; v_key text := upper(btrim(coalesce(p_sale_number, ''))); n int;
begin
  if v_key = '' then raise exception 'Enter the sale, DR, SI or hardcopy DR number.'; end if;
  select count(*) into n from public.storefront_sales ss
   where ss.business_id = b and (upper(ss.sale_number) = v_key or upper(ss.dr_number) = v_key or upper(btrim(ss.si_number)) = v_key
                                 or upper(btrim(ss.si_number)) = regexp_replace(v_key, '^SI[- ]?', '')
                                 or public.sf_hardcopy_key(ss.hardcopy_dr_no) = public.sf_hardcopy_key(v_key));
  if n > 1 then raise exception 'More than one sale matches %; use the sale number.', p_sale_number; end if;
  select ss.*, c.legal_name into s from public.storefront_sales ss join public.finance_customers c on c.id = ss.customer_id
   where ss.business_id = b and (upper(ss.sale_number) = v_key or upper(ss.dr_number) = v_key or upper(btrim(ss.si_number)) = v_key
                                 or upper(btrim(ss.si_number)) = regexp_replace(v_key, '^SI[- ]?', '')
                                 or public.sf_hardcopy_key(ss.hardcopy_dr_no) = public.sf_hardcopy_key(v_key));
  if not found then raise exception 'No sale with sale, DR, SI or hardcopy DR number % in this store.', p_sale_number; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be returned (this one is %).', replace(s.status, '_', ' '); end if;
  if s.ar_invoice_id is not null then select balance_due into v_bal from public.finance_customer_invoices where id = s.ar_invoice_id; end if;
  return jsonb_build_object('id', s.id, 'sale_number', s.sale_number, 'dr_number', s.dr_number, 'si_number', s.si_number, 'sale_date', s.sale_date,
    'hardcopy_dr_no', s.hardcopy_dr_no,
    'customer', s.legal_name, 'total', s.total, 'ar_balance', coalesce(v_bal, 0), 'order_dr', s.sales_order_id is not null,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sale_item_id', i.id, 'description', i.description, 'unit', i.unit, 'item_type', i.item_type,
                'sold', i.quantity, 'unit_price', i.unit_price, 'released', i.stock_movement_id is not null, 'lot_code', lo.lot_code,
                'returned', coalesce((select sum(ri.quantity) from public.storefront_return_items ri where ri.sale_item_id = i.id), 0)) order by i.description, lo.lot_code)
              from public.storefront_sale_items i left join public.inventory_lots lo on lo.id = i.lot_id where i.sale_id = s.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 9. Product Search and product detail: reserved and available
-- ---------------------------------------------------------------------------
drop function if exists public.catalog_product_search(text, text, text, text, boolean, integer, integer);
create function public.catalog_product_search(p_q text default null, p_category text default null, p_item text default null, p_brand text default null,
                                              p_in_stock_only boolean default false, p_limit integer default 50, p_offset integer default 0)
returns table(item_id uuid, item_code text, item_name text, category text, generic_item text, brand text, description text, unit text, item_type text, photo_path text,
              store_price numeric, stocked boolean, on_hand numeric, stock_by_location jsonb, reserved numeric, available numeric, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_business uuid := public.pricing_business_id();
  esc text := '\';
  q text := nullif(btrim(coalesce(p_q, '')), '');
  it text := nullif(btrim(coalesce(p_item, '')), '');
  br text := nullif(btrim(coalesce(p_brand, '')), '');
  ca text := nullif(btrim(coalesce(p_category, '')), '');
begin
  if auth.uid() is null or not public.can_read_shared_catalog() then
    raise exception 'Catalog access required.';
  end if;
  q  := replace(replace(replace(q,  esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  it := replace(replace(replace(it, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  br := replace(replace(replace(br, esc, esc || esc), '%', esc || '%'), '_', esc || '_');

  return query
  with linked as (
    select inv.procurement_item_id as pid, bool_or(true) as yes
      from public.logistics_inventory_items inv
     where v_business is not null and inv.active and inv.business_id = v_business and inv.procurement_item_id is not null
     group by 1
  ), stock as (
    select inv.procurement_item_id as pid, l.location_name, sum(bal.on_hand) as qty
      from public.logistics_inventory_items inv
      join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id
      join public.logistics_locations l on l.id = bal.location_id and l.active
     where v_business is not null
       and inv.active and inv.business_id = v_business and l.business_id = v_business
       and inv.procurement_item_id is not null
     group by 1, 2
  ), stock_agg as (
    select pid, sum(qty) as on_hand,
           jsonb_agg(jsonb_build_object('location', location_name, 'on_hand', qty) order by location_name)
             filter (where qty <> 0) as by_loc
      from stock group by pid
  ), res as (
    select soi.catalog_item_id as pid, sum(greatest(soi.quantity - dl.released, 0)) as qty
      from public.sales_order_items soi
      join public.sales_orders so on so.id = soi.order_id
      cross join lateral public.sf_order_line_delivered(soi.id) dl
     where v_business is not null and so.business_id = v_business and so.status::text in ('approved', 'processing') and soi.fulfilment = 'stock'
     group by 1
  ), hits as (
    select i.*
      from public.finance_procurement_items i
     where i.active
       and (ca is null or lower(i.category) = lower(ca))
       and (it is null or i.generic_item ilike '%' || it || '%')
       and (br is null or i.brand ilike '%' || br || '%')
       and (q is null or i.item_name ilike '%' || q || '%' or i.item_code ilike '%' || q || '%'
            or i.generic_item ilike '%' || q || '%' or i.brand ilike '%' || q || '%'
            or i.description ilike '%' || q || '%' or i.category ilike '%' || q || '%')
  )
  select h.id, h.item_code, h.item_name, h.category, h.generic_item, h.brand, h.description, h.unit, h.item_type, h.photo_path,
         case when v_business is null then null
              else round(case when h.item_type = 'service' then h.service_cost_basis else h.standard_cost end
                         * (1 + coalesce(cp.addon_percent, 0) / 100)
                         * (1 + coalesce(ip.markup_percent, 0) / 100), 2) end,
         coalesce(lk.yes, false),
         case when v_business is null or h.item_type = 'service' or lk.yes is null then null else coalesce(s.on_hand, 0) end,
         coalesce(s.by_loc, '[]'::jsonb),
         case when v_business is null or h.item_type = 'service' then null else coalesce(r.qty, 0) end,
         case when v_business is null or h.item_type = 'service' or lk.yes is null then null else coalesce(s.on_hand, 0) - coalesce(r.qty, 0) end,
         count(*) over ()
    from hits h
    left join linked lk on lk.pid = h.id
    left join stock_agg s on s.pid = h.id
    left join res r on r.pid = h.id
    left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(h.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = v_business
    left join public.finance_catalog_item_pricing ip on ip.item_id = h.id and ip.active and ip.business_id = v_business
   where not coalesce(p_in_stock_only, false) or coalesce(s.on_hand, 0) - coalesce(r.qty, 0) > 0
   order by h.item_name
   limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
grant execute on function public.catalog_product_search(text, text, text, text, boolean, integer, integer) to authenticated;

create or replace function public.catalog_product_detail(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_business uuid := public.pricing_business_id(); i record; v_price numeric; v_stock jsonb; v_on_hand numeric; v_stocked boolean; v_res numeric;
begin
  if auth.uid() is null or not public.can_read_shared_catalog() then raise exception 'Catalog access required.'; end if;
  select * into i from public.finance_procurement_items where id = p_item and active;
  if not found then raise exception 'Product not found.'; end if;
  if v_business is not null then
    select round(case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end
                 * (1 + coalesce(cp.addon_percent, 0) / 100) * (1 + coalesce(ip.markup_percent, 0) / 100), 2)
      into v_price
      from (select 1) x
      left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
      left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = v_business
      left join public.finance_catalog_item_pricing ip on ip.item_id = i.id and ip.active and ip.business_id = v_business;
    select exists (select 1 from public.logistics_inventory_items inv where inv.business_id = v_business and inv.active and inv.procurement_item_id = i.id) into v_stocked;
    select coalesce(sum(bal.on_hand), 0),
           coalesce(jsonb_agg(jsonb_build_object('location', l.location_name, 'on_hand', bal.on_hand) order by l.location_name) filter (where bal.on_hand <> 0), '[]'::jsonb)
      into v_on_hand, v_stock
      from public.logistics_inventory_items inv
      join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id
      join public.logistics_locations l on l.id = bal.location_id and l.active and l.business_id = v_business
     where inv.business_id = v_business and inv.active and inv.procurement_item_id = i.id;
    v_res := public.inventory_reserved(v_business, i.id);
  end if;
  return jsonb_build_object('id', i.id, 'item_code', i.item_code, 'item_name', i.item_name, 'category', i.category, 'generic_item', i.generic_item,
    'brand', i.brand, 'unit', i.unit, 'item_type', i.item_type, 'description', i.description, 'specification', i.specification,
    'photo_paths', to_jsonb(array_remove(array[i.photo_path, i.photo_path_2, i.photo_path_3], null)),
    'store_price', v_price, 'priced', v_business is not null,
    'stocked', coalesce(v_stocked, false), 'on_hand', case when v_business is null or i.item_type = 'service' or not coalesce(v_stocked, false) then null else v_on_hand end,
    'reserved', case when v_business is null or i.item_type = 'service' then null else coalesce(v_res, 0) end,
    'available', case when v_business is null or i.item_type = 'service' or not coalesce(v_stocked, false) then null else v_on_hand - coalesce(v_res, 0) end,
    'stock_by_location', coalesce(v_stock, '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.sf_check_hardcopy(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.sf_line_lot(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.sf_lot_options(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.inventory_reserved(uuid, uuid, uuid) from public, anon;
grant execute on function public.inventory_reservations(uuid) to authenticated;
grant execute on function public.sales_order_cancel(uuid, text) to authenticated;
grant execute on function public.storefront_submit_sale(jsonb) to authenticated;
grant execute on function public.storefront_order_dr(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Warehouse release list shows each line's lot (the Warehouse picks that lot)
-- ---------------------------------------------------------------------------
create or replace function public.storefront_drs_awaiting_release()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not (public.can_release_dr() or public.can_view_storefront()) then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('sale_id', s.id, 'dr_number', s.dr_number, 'sale_date', s.sale_date, 'order_number', so.order_number,
            'customer', c.legal_name, 'delivery_address', so.delivery_address, 'location', l.location_code || ' — ' || l.location_name, 'hardcopy_dr_no', s.hardcopy_dr_no,
            'lines', (select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity - coalesce((select sum(ri.quantity) from public.storefront_return_items ri where ri.sale_item_id = i.id), 0),
                                                          'unit', i.unit, 'service', i.item_type = 'service' or i.item_id is null, 'lot_code', i.lot_code)) from public.storefront_sale_items i where i.sale_id = s.id)) order by s.created_at)
     from public.storefront_sales s join public.sales_orders so on so.id = s.sales_order_id join public.finance_customers c on c.id = s.customer_id
     join public.logistics_locations l on l.id = s.location_id
    where s.business_id = b and s.status = 'completed' and s.release_status = 'awaiting_release'), '[]'::jsonb);
end $$;
