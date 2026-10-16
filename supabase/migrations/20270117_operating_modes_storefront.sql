-- Build 116 — MODE-01 part 2: operating modes at the Storefront.
--
-- Decided with the owner 2026-10-16 for a store whose point is set to auto (Single-operator):
--   Locked out (refused, no approver path):
--     * a payment reference used twice (point: price_exception — "counter exceptions")
--     * a refund by a method beyond what the customer paid by it, e.g. cash for a GCash payment (point: returns)
--     * cancelling a completed sale — use Return instead (point: returns)
--     * a counter price below 3% over acquisition cost (point: price_exception)
--   Automatic:
--     * DR release: the person who issues an order DR releases the goods with it (point: dr_release)
--     * daily closing: approved when submitted; a short / over is warned (point: price_exception)
--   Allowed with a warning kept on the record and listed on the Business Admin dashboard:
--     * below the 7% floor (but not below 3%), late entry, no cost on record, reserved stock (point: price_exception)
--     * a quotation with a line below the floor auto-approved (Build 115)
-- Other modes keep today's approver rules unchanged.

create table if not exists public.workflow_warnings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  entity_table text not null,
  entity_id uuid not null,
  document text,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  mode text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists workflow_warnings_business_created on public.workflow_warnings(business_id, created_at desc);
alter table public.workflow_warnings enable row level security;
drop policy if exists workflow_warnings_read on public.workflow_warnings;
create policy workflow_warnings_read on public.workflow_warnings for select to authenticated
  using (public.is_super_admin() or (public.is_business_admin() and business_id = public.current_business_id()));
revoke insert, update, delete on public.workflow_warnings from authenticated, anon;
grant select on public.workflow_warnings to authenticated;

create or replace function public.workflow_warn(p_business uuid, p_table text, p_id uuid, p_document text, p_kind text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_mode text := coalesce((select mode from public.business_operating_modes where business_id = p_business), 'full');
begin
  insert into public.workflow_warnings(business_id, entity_table, entity_id, document, kind, detail, mode, created_by)
  values (p_business, p_table, p_id, p_document, p_kind, coalesce(p_detail, '{}'::jsonb), v_mode, auth.uid());
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), p_table, p_id, 'workflow_warning', jsonb_build_object('kind', p_kind, 'document', p_document, 'mode', v_mode, 'mode_label', public.workflow_mode_label(v_mode)) || coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.workflow_warn(uuid, text, uuid, text, text, jsonb) from public, authenticated;

-- warnings for the Business Admin / Super Admin dashboard
create or replace function public.workflow_recent_warnings(p_days int default 7)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', w.created_at, 'kind', w.kind, 'table', w.entity_table, 'id', w.entity_id, 'document', w.document,
           'detail', w.detail, 'mode_label', public.workflow_mode_label(w.mode), 'store', b.code,
           'by', (select full_name from public.users u where u.id = w.created_by)) order by w.created_at desc), '[]'::jsonb)
    from public.workflow_warnings w join public.businesses b on b.id = w.business_id
   where w.created_at > now() - make_interval(days => greatest(p_days, 1))
     and ((public.is_super_admin() and (public.pricing_business_id() is null or w.business_id = public.pricing_business_id()))
          or (public.is_business_admin() and w.business_id = public.current_business_id()))
$$;
grant execute on function public.workflow_recent_warnings(int) to authenticated;

-- the current store's point settings, for the Storefront screen (hide Cancel, explain auto release)
create or replace function public.workflow_store_points()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('mode', coalesce((select mode from public.business_operating_modes where business_id = public.pricing_business_id()), 'full'),
                            'dr_release', public.workflow_point_setting(public.pricing_business_id(), 'dr_release'),
                            'returns', public.workflow_point_setting(public.pricing_business_id(), 'returns'),
                            'price_exception', public.workflow_point_setting(public.pricing_business_id(), 'price_exception'))
$$;
grant execute on function public.workflow_store_points() to authenticated;

-- Build 115's quotation warning now also goes to the warnings list
create or replace function public.guard_quote_below_floor()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status::text = 'approved' and old.status::text is distinct from 'approved' then
    select count(*) into n from public.sales_quotation_items where quotation_id = new.id and below_floor;
    if n > 0 then
      if coalesce(current_setting('ibx.workflow_auto', true), '') = 'on' then
        insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
        values (coalesce(auth.uid(), new.prepared_by), 'sales_quotations', new.id, 'price_exception_warned',
                jsonb_build_object('lines_below_floor', n, 'note', 'Approved by the operating mode with ' || n || ' line(s) below the 7% floor; no second person checked the price.'));
        perform public.workflow_warn(new.business_id, 'sales_quotations', new.id, new.quotation_number, 'quote_below_floor', jsonb_build_object('lines_below_floor', n));
      elsif auth.uid() is not null and not public.can_approve_storefront() then
        raise exception 'This quotation has % line(s) priced below the floor (7%% over acquisition cost); only a Sales approver or Business Admin can approve it.', n;
      end if;
    end if;
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.storefront_submit_sale(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b uuid := public.storefront_business(); st record; v_sale uuid; v_no text; v_customer uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
        l record; pr record; v_sub numeric := 0; v_tot numeric := 0; v_below boolean := false; v_nocost boolean := false; v_status text;
        v_date date; v_reasons text[] := '{}'; v_inv uuid; v_lot uuid; v_hard text; g record; v_res numeric; v_here numeric; v_lp record; v_reserved jsonb := '[]'::jsonb;
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
    v_inv := case when pr.item_type <> 'service' then public.ensure_inventory_link(pr.item_id, b) end;
    v_lot := public.sf_line_lot(b, v_inv, st.location_id, l.lot_id);
    -- SF-31: the line is priced from the lot sold (its purchase price × add-on × markup)
    select * into v_lp from public.storefront_lot_price(l.item_id, b, v_lot);
    pr.list_price := v_lp.list_price; pr.acquisition_cost := v_lp.acquisition_cost; pr.floor_price := v_lp.floor_price;
    -- CAT-38: an order-only item is sold at the counter only from units on hand
    if pr.item_type <> 'service' and (select stock_type from public.finance_procurement_items where id = pr.item_id) = 'order_only' then
      v_here := public.q77_on_hand(b, pr.item_id, st.location_id) - coalesce((select sum(quantity) from public.storefront_sale_items where sale_id = v_sale and item_id = pr.item_id), 0);
      if l.quantity > greatest(v_here, 0) then
        raise exception '% is an order-only item with % on hand at the store: make a quotation so it is ordered from the supplier.', pr.item_name, greatest(v_here, 0)::text;
      end if;
    end if;
    l.unit_price := round(coalesce(l.unit_price, pr.list_price), 2);
    if l.unit_price < 0 then raise exception 'Price for % cannot be negative.', pr.item_name; end if;
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
  -- MODE-01 part 2: under Single-operator (counter exceptions = auto) the sale completes with a warning on its record;
  -- a price below 3% over acquisition cost is refused outright.
  if cardinality(v_reasons) > 0 and public.workflow_point_setting(b, 'price_exception') = 'auto' then
    if exists (select 1 from public.storefront_sale_items where sale_id = v_sale and coalesce(acquisition_cost, 0) > 0 and unit_price < round(acquisition_cost * 1.03, 2)) then
      raise exception '% is priced below 3%% over its cost (lowest allowed ₱%). In Single-operator mode a price that low is not allowed.',
        (select description from public.storefront_sale_items where sale_id = v_sale and coalesce(acquisition_cost, 0) > 0 and unit_price < round(acquisition_cost * 1.03, 2) limit 1),
        (select round(acquisition_cost * 1.03, 2) from public.storefront_sale_items where sale_id = v_sale and coalesce(acquisition_cost, 0) > 0 and unit_price < round(acquisition_cost * 1.03, 2) limit 1);
    end if;
    perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', coalesce((p->>'issue_dr')::boolean, true));
    v_status := 'completed';
    perform public.workflow_warn(b, 'storefront_sales', v_sale, v_no, 'counter_sale',
      jsonb_build_object('reasons', v_reasons, 'total', v_tot, 'sale_date', v_date, 'late_reason', case when v_date < v_today then btrim(p->>'late_reason') end, 'reserved_stock', v_reserved));
  elsif cardinality(v_reasons) > 0 then
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'storefront_sales', v_sale, 'storefront_sale_approval_requested',
            jsonb_build_object('sale_number', v_no, 'total', v_tot, 'reasons', v_reasons, 'sale_date', v_date, 'reserved_stock', v_reserved));
    v_status := 'pending_approval';
  else
    perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', coalesce((p->>'issue_dr')::boolean, true));
    v_status := 'completed';
  end if;
  return jsonb_build_object('id', v_sale, 'sale_number', v_no, 'status', v_status, 'total', v_tot, 'reasons', v_reasons, 'reserved_stock', v_reserved);
end $function$;

CREATE OR REPLACE FUNCTION public.guard_storefront_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ref text; v_dup text; v_inv uuid; v_paid numeric; v_refunded numeric; v_label text;
begin
  v_label := case new.method when 'cash' then 'cash' when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' when 'check' then 'check' else 'bank transfer' end;
  if new.kind <> 'refund' and new.method <> 'cash' and nullif(regexp_replace(coalesce(new.reference_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null then
    v_ref := lower(regexp_replace(new.reference_number, '[^A-Za-z0-9]', '', 'g'));
    select payment_number into v_dup from public.storefront_payments
     where business_id = new.business_id and method = new.method and kind <> 'refund'
       and lower(regexp_replace(reference_number, '[^A-Za-z0-9]', '', 'g')) = v_ref limit 1;
    -- Build 88: the later parts of one payment split over several invoices (oldest first) share its reference
    if v_dup is not null and coalesce(current_setting('ibx.ar_split_ref', true), '') = v_ref then v_dup := null; end if;
    if v_dup is not null then
      -- MODE-01 part 2: locked out under Single-operator (no approver to check it)
      if public.workflow_point_setting(new.business_id, 'price_exception') = 'auto' then
        raise exception '% reference % was already used on payment %. In Single-operator mode a reference cannot be used twice; check the reference.', v_label, new.reference_number, v_dup;
      end if;
      if not public.can_approve_storefront() then
        raise exception '% reference % was already used on payment %. Check the reference; if one transfer really covers several payments, ask an approver to record it.', v_label, new.reference_number, v_dup;
      end if;
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'storefront_payments', new.id, 'storefront_reference_reused', jsonb_build_object('method', new.method, 'reference', new.reference_number, 'first_payment', v_dup));
    end if;
  end if;
  if new.kind = 'refund' and new.sale_id is not null then
    select ar_invoice_id into v_inv from public.storefront_sales where id = new.sale_id;
    select coalesce(sum(amount), 0) into v_paid from public.storefront_payments
     where business_id = new.business_id and method = new.method
       and ((kind = 'sale' and sale_id = new.sale_id) or (kind = 'ar_collection' and v_inv is not null and ar_invoice_id = v_inv));
    select coalesce(sum(amount), 0) into v_refunded from public.storefront_payments
     where business_id = new.business_id and method = new.method and kind = 'refund' and sale_id = new.sale_id;
    if v_refunded + new.amount > v_paid then
      if public.workflow_point_setting(new.business_id, 'returns') = 'auto' then
        raise exception 'Refund by % (₱%) is more than the customer paid by % on this sale (₱% paid, ₱% already refunded). In Single-operator mode refunds go back the way the customer paid.',
          v_label, new.amount, v_label, v_paid, v_refunded;
      end if;
      if not public.can_approve_storefront() then
        raise exception 'Refund by % (₱%) is more than the customer paid by % on this sale (₱% paid, ₱% already refunded). Refund the way the customer paid, or ask an approver to process this return.',
          v_label, new.amount, v_label, v_paid, v_refunded;
      end if;
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'storefront_payments', new.id, 'storefront_refund_method_override',
              jsonb_build_object('method', new.method, 'amount', new.amount, 'paid_by_method', v_paid, 'already_refunded', v_refunded, 'sale_id', new.sale_id));
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.storefront_request_cancel(p_sale uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b uuid := public.storefront_business(); s record;
begin
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale is cancelled this way (a sale not yet completed is simply cancelled).'; end if;
  if s.cancel_status in ('requested','approved') then raise exception 'Cancellation of % is already %.', s.sale_number, s.cancel_status; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the sale is cancelled.'; end if;
  if public.workflow_point_setting(b, 'returns') = 'auto' then
    raise exception 'In Single-operator mode a completed sale is not cancelled: use Return to take back everything on % (stock back, AR credited, refund by the way the customer paid).', s.sale_number;
  end if;
  update public.storefront_sales set cancel_status = 'requested', cancel_reason = btrim(p_reason), cancel_requested_by = auth.uid(), cancel_requested_at = now(),
                                     cancel_decided_by = null, cancel_decided_at = null, cancel_note = null where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_cancel_requested', jsonb_build_object('sale_number', s.sale_number, 'reason', btrim(p_reason)));
end $function$;

CREATE OR REPLACE FUNCTION public.storefront_order_dr(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- MODE-01 part 2: DR release automatic (the person who issues the DR releases the goods)
  if public.workflow_point_setting(b, 'dr_release') = 'auto' then
    perform set_config('ibx.workflow_auto', 'on', true);
    perform public.storefront_release_dr(v_sale, null);
    perform set_config('ibx.workflow_auto', '', true);
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', v_sale, 'storefront_order_dr_issued', jsonb_build_object('sale_number', v_no, 'order_number', o.order_number, 'total', v_tot, 'hardcopy_dr_no', v_hard));
  return (select jsonb_build_object('id', id, 'sale_number', sale_number, 'dr_number', dr_number, 'total', total, 'balance', balance) from public.storefront_sales where id = v_sale);
end $function$;

CREATE OR REPLACE FUNCTION public.storefront_release_dr(p_sale uuid, p_location uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b uuid := public.pricing_business_id(); s record; l record; g record; v_loc uuid; v_mov uuid; v_open int;
begin
  if not public.can_release_dr() and coalesce(current_setting('ibx.workflow_auto', true), '') <> 'on' then raise exception 'The Warehouse (Logistics) confirms the release of a DR.'; end if;
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
            case when coalesce(current_setting('ibx.workflow_auto', true), '') = 'on' then 'Released with the DR (Single-operator mode) for DR ' else 'Released by the Warehouse for DR ' end || s.dr_number, auth.uid(), g.lot_id)
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
end $function$;

CREATE OR REPLACE FUNCTION public.storefront_close_day(p_date date, p_counted_cash numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b uuid := public.storefront_business(); t jsonb; v_id uuid; v_no text; v_var numeric;
begin
  if p_date is null or p_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Choose today or an earlier date.'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the cash counted in the drawer.'; end if;
  if exists (select 1 from public.storefront_closings where business_id = b and closing_date = p_date and status <> 'returned') then
    raise exception 'This day is already closed (or waiting for approval).';
  end if;
  v_no := public.storefront_next_number('SFC', 'storefront_closings', 'closing_number');
  insert into public.storefront_closings(business_id, closing_number, closing_date, counted_cash, notes, submitted_by)
  values (b, v_no, p_date, round(p_counted_cash, 2), nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;
  update public.storefront_payments set closing_id = v_id where business_id = b and closing_id is null and (received_at at time zone 'Asia/Manila')::date <= p_date;
  update public.storefront_sales set closing_id = v_id where business_id = b and status = 'completed' and closing_id is null and sale_date <= p_date;
  update public.storefront_returns set closing_id = v_id where business_id = b and closing_id is null and return_date <= p_date;
  update public.storefront_cash_movements set closing_id = v_id where business_id = b and closing_id is null and movement_date <= p_date;
  t := public.storefront_closing_totals(b, p_date, v_id);
  v_var := round(p_counted_cash, 2) - (t->>'expected_cash')::numeric;
  update public.storefront_closings
     set sales_count = (t->>'sales_count')::int, sales_total = (t->>'sales_total')::numeric, returns_total = (t->>'returns_total')::numeric,
         charged_to_ar = (t->>'charged_to_ar')::numeric, ar_collected = (t->>'ar_collected')::numeric, by_method = t->'by_method',
         float_total = (t->>'float_total')::numeric, cash_out_total = (t->>'cash_out_total')::numeric, vat_total = (t->>'vat_total')::numeric,
         expected_cash = (t->>'expected_cash')::numeric, variance = v_var
   where id = v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', v_id, 'storefront_day_closed', jsonb_build_object('closing_number', v_no, 'date', p_date, 'expected_cash', t->>'expected_cash', 'counted_cash', p_counted_cash));
  -- MODE-01 part 2: auto-approved under Single-operator; a short / over is warned on the dashboard.
  -- If posting cannot be done (e.g. a receiving account is missing) the closing stays submitted with a warning.
  if public.workflow_point_setting(b, 'price_exception') = 'auto' then
    begin
      update public.storefront_closings set status = 'approved', decided_by = auth.uid(), decided_at = now(),
             decision_note = 'Approved automatically (Single-operator mode)' where id = v_id;
      perform public.storefront_post_closing(v_id);
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'storefront_closings', v_id, 'auto_approved', jsonb_build_object('closing_number', v_no, 'variance', v_var, 'note', 'auto-approved under Single-operator mode'));
      if v_var <> 0 then
        perform public.workflow_warn(b, 'storefront_closings', v_id, v_no, 'closing_variance',
          jsonb_build_object('date', p_date, 'expected_cash', t->>'expected_cash', 'counted_cash', round(p_counted_cash, 2), 'variance', v_var));
      end if;
      return jsonb_build_object('id', v_id, 'closing_number', v_no, 'variance', v_var, 'auto_approved', true);
    exception when others then
      perform public.workflow_warn(b, 'storefront_closings', v_id, v_no, 'closing_not_posted', jsonb_build_object('date', p_date, 'variance', v_var, 'error', sqlerrm));
      return jsonb_build_object('id', v_id, 'closing_number', v_no, 'variance', v_var, 'auto_approved', false, 'error', sqlerrm);
    end;
  end if;
  return jsonb_build_object('id', v_id, 'closing_number', v_no, 'variance', v_var);
end $function$;
