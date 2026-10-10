-- Build 95 — agent app (mobile): product detail for the agent's catalogue, stock on agent order lines, and turning an
-- agent order into a sales order with "order from supplier" lines (released to Procurement as a PR → PO on approval).

alter table public.agent_orders drop constraint if exists agent_orders_status_check;
alter table public.agent_orders add constraint agent_orders_status_check check (status in ('draft','sent','completed','cancelled','converted'));
alter table public.agent_orders add column if not exists sales_order_id uuid references public.sales_orders(id);

-- order JSON with each line's stock at the store and the sales order it became
create or replace function public.agent_order_json(p_order uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'business_id', o.business_id, 'status', o.status, 'notes', o.notes, 'store_note', o.store_note,
           'total', o.total, 'created_at', o.created_at, 'sent_at', o.sent_at, 'completed_at', o.completed_at,
           'customer_id', o.customer_id, 'customer', c.legal_name, 'customer_code', c.customer_code, 'agent', a.name, 'agent_code', a.agent_code,
           'sale_number', s.sale_number, 'sales_order_number', so.order_number, 'sales_order_status', so.status::text,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'item_code', i.item_code, 'item_name', i.item_name, 'unit', i.unit, 'item_type', i.item_type,
                       'quantity', l.quantity, 'tier', l.tier, 'unit_price', l.unit_price, 'list_price', l.list_price, 'line_total', l.line_total,
                       'available', case when i.item_type = 'service' then null
                                         else coalesce(public.q77_on_hand(o.business_id, l.item_id, st.location_id), 0) - coalesce(public.inventory_reserved(o.business_id, l.item_id), 0) end)
                       order by l.line_no)
                     from public.agent_order_lines l join public.finance_procurement_items i on i.id = l.item_id where l.order_id = o.id), '[]'::jsonb))
    from public.agent_orders o join public.finance_customers c on c.id = o.customer_id join public.sales_agents a on a.id = o.agent_id
    left join public.storefront_sales s on s.id = o.sale_id
    left join public.sales_orders so on so.id = o.sales_order_id
    left join public.storefront_settings st on st.business_id = o.business_id
   where o.id = p_order;
$$;
revoke all on function public.agent_order_json(uuid) from public;

create or replace function public.storefront_agent_orders()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return coalesce((select jsonb_agg(public.agent_order_json(o.id) order by o.sort_at desc)
                     from (select id, coalesce(sent_at, created_at) as sort_at from public.agent_orders
                            where business_id = b and (status = 'sent' or (status in ('completed', 'converted') and updated_at > now() - interval '7 days'))
                            order by 2 desc limit 200) o), '[]'::jsonb);
end $$;

-- agent order → sales order (status prepared: the Sales approver approves; "order from supplier" lines then go to Procurement)
-- p_lines = [{item_id, fulfilment: 'stock' | 'source'}]; missing lines default to source when the store has not enough available
create or replace function public.storefront_agent_order_to_so(p_order uuid, p_lines jsonb default '[]'::jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); o record; v_so uuid; v_no text; l record; v_f text; v_src int := 0; v_sub numeric := 0; v_avail numeric; v_loc uuid;
begin
  select * into o from public.agent_orders where id = p_order and business_id = b for update;
  if not found then raise exception 'Agent order not found in this store.'; end if;
  if o.status <> 'sent' then raise exception 'Agent order % is %.', o.order_number, o.status; end if;
  select location_id into v_loc from public.storefront_settings where business_id = b;
  select coalesce(sum(line_total), 0) into v_sub from public.agent_order_lines where order_id = o.id;
  insert into public.sales_orders(business_id, agent_id, customer_id, order_date, subtotal, discount_amount, tax_amount, other_charges, notes, status, prepared_by, prepared_at, created_by,
                                  go_signal_date, go_signal_via, go_signal_confirmed_by)
  values (b, o.agent_id, o.customer_id, (now() at time zone 'Asia/Manila')::date, v_sub, 0, 0, 0,
          concat_ws(' · ', 'From agent order ' || o.order_number, nullif(btrim(o.notes), ''), nullif(btrim(p_note), '')), 'prepared', auth.uid(), now(), auth.uid(),
          (now() at time zone 'Asia/Manila')::date, 'Agent order', (select name from public.sales_agents where id = o.agent_id))
  returning id, order_number into v_so, v_no;
  for l in select al.*, i.item_type, i.item_name, i.unit as iunit, i.standard_cost from public.agent_order_lines al join public.finance_procurement_items i on i.id = al.item_id
            where al.order_id = o.id order by al.line_no loop
    select x.fulfilment into v_f from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x(item_id uuid, fulfilment text) where x.item_id = l.item_id limit 1;
    if l.item_type = 'service' then v_f := 'service';
    elsif v_f is null then
      v_avail := coalesce(public.q77_on_hand(b, l.item_id, v_loc), 0) - coalesce(public.inventory_reserved(b, l.item_id), 0);
      v_f := case when v_avail >= l.quantity then 'stock' else 'source' end;
    elsif v_f not in ('stock', 'source') then raise exception 'Choose "from stock" or "order from supplier" for %.', l.item_name;
    end if;
    if v_f = 'source' then v_src := v_src + 1; end if;
    insert into public.sales_order_items(business_id, order_id, catalog_item_id, description, quantity, unit, unit_price, notes, fulfilment, estimated_unit_cost)
    values (b, v_so, l.item_id, l.item_name, l.quantity, coalesce(l.iunit, 'unit'), l.unit_price, case when l.tier is not null then 'Tier ' || l.tier end, v_f, round(coalesce(l.standard_cost, 0), 2));
  end loop;
  update public.agent_orders set status = 'converted', sales_order_id = v_so, store_note = nullif(btrim(p_note), ''), updated_at = now() where id = o.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_orders', v_so, 'sales_order_from_agent_order', jsonb_build_object('agent_order', o.order_number, 'order_number', v_no, 'lines_to_source', v_src));
  return jsonb_build_object('id', v_so, 'order_number', v_no, 'lines_to_source', v_src);
end $$;
revoke all on function public.storefront_agent_order_to_so(uuid, jsonb, text) from public;
grant execute on function public.storefront_agent_order_to_so(uuid, jsonb, text) to authenticated;

-- one product for the agent's app: photos, details, stock and prices (client price when a client is picked)
create or replace function public.agent_product_detail(p_business uuid, p_item uuid, p_customer uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require(); i record; pr record; c public.finance_customers; v_loc uuid; v_on numeric; v_res numeric; v_client numeric; v_disc numeric;
begin
  perform public.agent_check_store(p_business);
  select * into i from public.finance_procurement_items where id = p_item and active;
  if not found then raise exception 'Product not found.'; end if;
  select * into pr from public.storefront_item_price(p_item, p_business);
  select location_id into v_loc from public.storefront_settings where business_id = p_business;
  if i.item_type <> 'service' then
    v_on := coalesce(public.q77_on_hand(p_business, p_item, v_loc), 0);
    v_res := coalesce(public.inventory_reserved(p_business, p_item), 0);
  end if;
  if p_customer is not null then
    c := public.agent_client(p_customer, p_business);
    v_client := public.agent_client_price(p_business, c.id, p_item, c.price_tier, pr.list_price, pr.acquisition_cost, pr.floor_price);
    select d.discount_percent into v_disc from public.finance_catalog_customer_discounts d
     where d.business_id = p_business and d.customer_id = c.id and d.item_id = p_item and d.active and d.effective_from <= current_date order by d.effective_from desc limit 1;
  end if;
  return jsonb_build_object('item_id', i.id, 'item_code', i.item_code, 'item_name', i.item_name, 'category', i.category, 'generic_item', i.generic_item, 'brand', i.brand,
    'description', i.description, 'specification', i.specification, 'unit', i.unit, 'item_type', i.item_type, 'stock_type', i.stock_type,
    'photo_paths', to_jsonb(array_remove(array[i.photo_path, i.photo_path_2, i.photo_path_3], null)),
    'on_hand', v_on, 'reserved', v_res, 'available', case when v_on is null then null else v_on - v_res end,
    'list_price', pr.list_price, 'acquisition_cost', pr.acquisition_cost, 'floor_price', pr.floor_price,
    'markup_percent', case when pr.acquisition_cost > 0 then round((pr.list_price / pr.acquisition_cost - 1) * 100, 4) end,
    'tier2', public.tier_price(p_business, 2, pr.list_price, pr.acquisition_cost, pr.floor_price),
    'tier3', public.tier_price(p_business, 3, pr.list_price, pr.acquisition_cost, pr.floor_price),
    'tier4', public.tier_price(p_business, 4, pr.list_price, pr.acquisition_cost, pr.floor_price),
    'client_tier', c.price_tier, 'client_price', v_client, 'client_discount', v_disc);
end $$;
revoke all on function public.agent_product_detail(uuid, uuid, uuid) from public;
grant execute on function public.agent_product_detail(uuid, uuid, uuid) to authenticated;
