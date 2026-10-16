-- Build 118 — VAT choice on a counter sale.
--
-- The cashier chooses With VAT (prices include 12% VAT: VAT = price × 12/112, as before) or Without VAT on
-- each new counter sale; the choice also applies to a DR-only sale. Until now VAT followed the SI booklet
-- only, so a DR-only sale never had VAT and a store could not issue both kinds.
-- A store may now keep a second SI booklet (e.g. ATON: ISHABELLA's VAT booklet and its own non-VAT booklet).
-- An SI is taken from the store's booklet that matches the choice (VAT-registered for With VAT, non-VAT for
-- Without VAT); SI numbers are still checked per booklet. Sales made before this build (no choice recorded)
-- and sales-order DRs keep their earlier rules (orders follow their quotation's VAT).

alter table public.storefront_settings add column if not exists si_booklet2_business_id uuid references public.businesses(id);
alter table public.storefront_sales add column if not exists vat_choice boolean;

-- the store's booklet that matches a VAT choice (null when the store has none)
create or replace function public.sf_booklet_for(p_business uuid, p_vat boolean)
returns uuid language sql stable security definer set search_path = public as $$
  select x.id from (
    select public.sf_booklet_business(p_business) as id, 1 as ord
    union all
    select si_booklet2_business_id, 2 from public.storefront_settings where business_id = p_business and si_booklet2_business_id is not null
  ) x join public.businesses bz on bz.id = x.id
  where coalesce(bz.vat_registered, false) = coalesce(p_vat, false)
  order by x.ord limit 1
$$;
revoke all on function public.sf_booklet_for(uuid, boolean) from public, anon;
grant execute on function public.sf_booklet_for(uuid, boolean) to authenticated;

-- both booklets of the current store, for Store settings and the New Sale screen
create or replace function public.storefront_booklet_pair()
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (select public.storefront_business() as id)
  select jsonb_build_object(
    'first', (select jsonb_build_object('id', bz.id, 'code', bz.code, 'name', coalesce(bz.trade_name, bz.legal_name), 'vat_registered', coalesce(bz.vat_registered, false))
                from public.businesses bz where bz.id = public.sf_booklet_business((select id from b))),
    'second', (select jsonb_build_object('id', bz.id, 'code', bz.code, 'name', coalesce(bz.trade_name, bz.legal_name), 'vat_registered', coalesce(bz.vat_registered, false))
                 from public.storefront_settings st join public.businesses bz on bz.id = st.si_booklet2_business_id where st.business_id = (select id from b)),
    'vat_booklet', public.sf_booklet_for((select id from b), true),
    'nonvat_booklet', public.sf_booklet_for((select id from b), false))
$$;
grant execute on function public.storefront_booklet_pair() to authenticated;

create or replace function public.storefront_set_booklet2(p_booklet_business uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can change Storefront settings.'; end if;
  if p_booklet_business is not null and not exists (select 1 from public.businesses where id = p_booklet_business and is_active) then raise exception 'Business not found.'; end if;
  if p_booklet_business is not null and coalesce((select vat_registered from public.businesses where id = p_booklet_business), false)
                                        = coalesce((select vat_registered from public.businesses where id = public.sf_booklet_business(b)), false) then
    raise exception 'The second booklet must be the other kind: one VAT-registered and one non-VAT.';
  end if;
  perform public.storefront_walk_in(b);
  update public.storefront_settings set si_booklet2_business_id = p_booklet_business, updated_by = auth.uid(), updated_at = now() where business_id = b;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_settings', b, 'storefront_booklet2_set', jsonb_build_object('booklet_business', p_booklet_business));
end $$;
grant execute on function public.storefront_set_booklet2(uuid) to authenticated;

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
  -- Build 118: the cashier's VAT choice (null = not chosen: the booklet decides, as before)
  if p ? 'vat' and jsonb_typeof(p->'vat') = 'boolean' then
    update public.storefront_sales set vat_choice = (p->>'vat')::boolean where id = v_sale;
  end if;

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

CREATE OR REPLACE FUNCTION public.storefront_post_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; l record; g record; p jsonb; v_paid numeric := 0; v_inv uuid; v_code text; v_walk uuid; v_mov uuid; v_inv_item uuid; v_unit numeric;
        v_booklet uuid; v_vat_reg boolean; v_vat numeric := 0; v_cost numeric := 0; o record; v_order boolean; v_order_no text; v_terms text; v_choice boolean;
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
  -- Build 118: the SI comes from the store's booklet that matches the sale's VAT (counter: the cashier's choice; order: its quotation)
  if v_order then v_choice := o.vat_applied; else v_choice := s.vat_choice; end if;
  if p_si is not null and v_choice is not null then
    v_booklet := public.sf_booklet_for(s.business_id, v_choice);
    if v_booklet is null then
      raise exception '%', case when v_choice
        then 'This store has no VAT-registered SI booklet. Issue the DR only, or a Business Admin adds the VAT booklet in Storefront → Store settings.'
        else 'This store has no non-VAT SI booklet. Issue the DR only, or a Business Admin adds the non-VAT booklet in Storefront → Store settings.' end;
    end if;
    select vat_registered into v_vat_reg from public.businesses where id = v_booklet;
  end if;
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
  elsif s.vat_choice is not null then
    if s.vat_choice then v_vat := round(s.total * 12 / 112, 2); end if;
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
    v_unit := case when v_inv_item is not null then coalesce((select nullif(lo.unit_cost, 0) from public.inventory_lots lo where lo.id = l.lot_id),
                                                             public.inventory_unit_cost(s.business_id, v_inv_item), l.acquisition_cost, 0)
                   else coalesce(l.acquisition_cost, 0) end;
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
end $function$;
