-- ============================================================================
-- Build 79 (decided by the owner 2026-10-02)
--   SF-31  Price and cost follow the lot (reverses the "weighted average" choice
--          for sales costing): a counter line is priced from the purchase price
--          of the lot sold (x category add-on x item markup); its cost and the
--          7% floor use that lot. Elsewhere (Product Search, product page,
--          quotations, Price Review) the price comes from the oldest lot with
--          stock, or the current Supplier Cost when no lot has stock.
--          Weighted average stays as the fallback for stock without a priced lot.
--   CAT-38 Stock item / Order only (one setting per catalog item).
--   CAT-37 Delete unused deactivated catalog items (Super Admin).
--   Fix    the catalog export wrote the Add on as a peso amount while the
--          import reads a percentage; the export now writes the percentage (app).
-- ============================================================================

-- CAT-38: stock type on the catalog item
alter table public.finance_procurement_items add column if not exists stock_type text not null default 'stock';
alter table public.finance_procurement_items drop constraint if exists finance_procurement_items_stock_type_chk;
alter table public.finance_procurement_items add constraint finance_procurement_items_stock_type_chk check (stock_type in ('stock', 'order_only'));
comment on column public.finance_procurement_items.stock_type is
  'Build 79 (CAT-38): stock = kept in stock; order_only = bought against a client PO (orders default to "order from supplier", no stock / reorder warnings, counter sale only from units on hand).';

-- SF-31: cost basis of an item = purchase price of the oldest lot with stock (else the current cost)
create or replace function public.catalog_cost_basis(p_item uuid, p_business uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when i.item_type = 'service' then coalesce(i.service_cost_basis, 0)
              else coalesce((select l.unit_cost from public.inventory_lots l
                               join public.logistics_inventory_items ii on ii.id = l.inventory_item_id and ii.procurement_item_id = i.id
                              where p_business is not null and l.business_id = p_business and l.unit_cost > 0
                                and public.inventory_lot_on_hand(l.id, null) > 0
                              order by l.received_date, l.lot_code limit 1), i.standard_cost, 0) end::numeric
    from public.finance_procurement_items i where i.id = p_item;
$$;
revoke all on function public.catalog_cost_basis(uuid, uuid) from public, anon;

-- price of an item from a lot's purchase price (no lot, or a lot without a price: the item's cost basis)
create or replace function public.storefront_lot_price(p_item uuid, p_business uuid, p_lot uuid)
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, acquisition_cost numeric, floor_price numeric,
              addon_percent numeric, markup_percent numeric, cost_basis numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.item_code, i.item_name, i.unit, i.item_type, x.list, x.acq, least(round(x.acq * 1.07, 2), x.list),
         coalesce(cp.addon_percent, 0), coalesce(ip.markup_percent, 0), b.base
    from public.finance_procurement_items i
    cross join lateral (select case when i.item_type <> 'service' and p_lot is not null
                                     then coalesce((select nullif(l.unit_cost, 0) from public.inventory_lots l where l.id = p_lot and l.business_id = p_business),
                                                   public.catalog_cost_basis(i.id, p_business))
                                     else public.catalog_cost_basis(i.id, p_business) end as base) b
    left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = p_business
    left join public.finance_catalog_item_pricing ip on ip.item_id = i.id and ip.active and ip.business_id = p_business
    cross join lateral (select coalesce(b.base, 0) * (1 + coalesce(cp.addon_percent, 0) / 100) as acq,
                               round(coalesce(b.base, 0) * (1 + coalesce(cp.addon_percent, 0) / 100) * (1 + coalesce(ip.markup_percent, 0) / 100), 2) as list) x
   where i.id = p_item and i.active;
$$;
revoke all on function public.storefront_lot_price(uuid, uuid, uuid) from public, anon;

-- the store price of an item = its price from the oldest lot with stock (or the current cost)
create or replace function public.storefront_item_price(p_item uuid, p_business uuid)
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, acquisition_cost numeric, floor_price numeric)
language sql stable security definer set search_path = public as $$
  select item_id, item_code, item_name, unit, item_type, list_price, acquisition_cost, floor_price from public.storefront_lot_price(p_item, p_business, null);
$$;


-- ---------------------------------------------------------------------------
-- SF-31: Product Search, product page and quotes price from the cost basis
-- ---------------------------------------------------------------------------

drop function if exists public.catalog_product_search(text, text, text, text, boolean, integer, integer);
CREATE FUNCTION public.catalog_product_search(p_q text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_item text DEFAULT NULL::text, p_brand text DEFAULT NULL::text, p_in_stock_only boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(item_id uuid, item_code text, item_name text, category text, generic_item text, brand text, description text, unit text, item_type text, photo_path text, store_price numeric, stocked boolean, on_hand numeric, stock_by_location jsonb, reserved numeric, available numeric, stock_type text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
              else round(public.catalog_cost_basis(h.id, v_business)
                         * (1 + coalesce(cp.addon_percent, 0) / 100)
                         * (1 + coalesce(ip.markup_percent, 0) / 100), 2) end,
         coalesce(lk.yes, false),
         case when v_business is null or h.item_type = 'service' or lk.yes is null then null else coalesce(s.on_hand, 0) end,
         coalesce(s.by_loc, '[]'::jsonb),
         case when v_business is null or h.item_type = 'service' then null else coalesce(r.qty, 0) end,
         case when v_business is null or h.item_type = 'service' or lk.yes is null then null else coalesce(s.on_hand, 0) - coalesce(r.qty, 0) end,
         h.stock_type,
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
$function$;
grant execute on function public.catalog_product_search(text, text, text, text, boolean, integer, integer) to authenticated;

CREATE OR REPLACE FUNCTION public.catalog_product_detail(p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_business uuid := public.pricing_business_id(); i record; v_price numeric; v_stock jsonb; v_on_hand numeric; v_stocked boolean; v_res numeric;
begin
  if auth.uid() is null or not public.can_read_shared_catalog() then raise exception 'Catalog access required.'; end if;
  select * into i from public.finance_procurement_items where id = p_item and active;
  if not found then raise exception 'Product not found.'; end if;
  if v_business is not null then
    select round(public.catalog_cost_basis(i.id, v_business)
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
    'stock_by_location', coalesce(v_stock, '[]'::jsonb), 'stock_type', i.stock_type);
end $function$;

CREATE OR REPLACE FUNCTION public.get_catalog_sales_price(p_item_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_supplier_cost numeric DEFAULT NULL::numeric)
 RETURNS TABLE(item_type text, supplier_cost numeric, service_cost_basis numeric, category_addon_percent numeric, acquisition_cost numeric, item_markup_percent numeric, srp numeric, customer_discount_percent numeric, customer_price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with biz as (
    select coalesce(public.pricing_business_id(),
                    (select fc.business_id from public.finance_customers fc where fc.id = p_customer_id)) as id
  ), base as (
    select i.item_type,
           case when i.item_type='service' then 0::numeric else coalesce(p_supplier_cost,public.catalog_cost_basis(i.id,(select id from biz)),0)::numeric end as product_cost,
           case when i.item_type='service' then coalesce(i.service_cost_basis,0)::numeric else 0::numeric end as service_basis,
           coalesce((select cp.addon_percent from public.finance_catalog_category_pricing cp
                      join public.finance_catalog_categories c on c.id=cp.category_id
                     where lower(trim(c.name))=lower(trim(i.category)) and cp.active
                       and cp.business_id = (select id from biz) limit 1),0)::numeric as addon,
           coalesce((select ip.markup_percent from public.finance_catalog_item_pricing ip
                     where ip.item_id=i.id and ip.active and ip.business_id = (select id from biz) limit 1),0)::numeric as markup
    from public.finance_procurement_items i
    where i.id=p_item_id
  ), priced as (
    select *,
      case when item_type='service' then null::numeric else product_cost*(1+addon/100) end as acq,
      case when item_type='service' then service_basis*(1+addon/100) else product_cost*(1+addon/100) end as pricing_base
    from base
  ), final as (
    select p.*, p.pricing_base*(1+p.markup/100) as sell,
      coalesce((select d.discount_percent from public.finance_catalog_customer_discounts d
                 where d.customer_id=p_customer_id and d.item_id=p_item_id and d.active
                   and d.business_id = (select id from biz) limit 1),0)::numeric as discount
    from priced p
  )
  select item_type, product_cost, service_basis, addon, acq, markup, sell, discount, sell*(1-discount/100)
  from final;
$function$;

drop function if exists public.sales_quote_order_lines(uuid);
CREATE FUNCTION public.sales_quote_order_lines(p_quote uuid)
 RETURNS TABLE(quotation_item_id uuid, catalog_item_id uuid, description text, quantity numeric, unit text, unit_price numeric, item_type text, on_hand numeric, current_cost numeric, stock_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b uuid := public.sales_doc_business();
begin
  if not exists (select 1 from public.sales_quotations where id = p_quote and business_id = b) then raise exception 'Quotation not found in this business.'; end if;
  return query
  select qi.id, qi.catalog_item_id, qi.description, qi.quantity, qi.unit, qi.unit_price,
         case when qi.catalog_item_id is null then 'custom' else coalesce(i.item_type, qi.pricing_item_type, 'product') end,
         case when qi.catalog_item_id is null or coalesce(i.item_type, 'product') = 'service' then null
              else coalesce((select sum(bal.on_hand) from public.logistics_inventory_items inv
                               join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id
                              where inv.business_id = b and inv.procurement_item_id = qi.catalog_item_id), 0) end,
         coalesce(qi.pricing_supplier_cost, i.standard_cost)::numeric,
         coalesce(i.stock_type, 'stock')
    from public.sales_quotation_items qi
    left join public.finance_procurement_items i on i.id = qi.catalog_item_id
   where qi.quotation_id = p_quote
   order by qi.created_at, qi.id;
end $function$;
grant execute on function public.sales_quote_order_lines(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- SF-31: lot options carry supplier, purchase price and the price from that
-- lot, sorted by supplier then purchase date; the counter line starts on the
-- oldest lot and is priced from it
-- ---------------------------------------------------------------------------
create or replace function public.sf_lot_options(p_business uuid, p_inv uuid, p_location uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('lot_id', l.id, 'lot_code', l.lot_code, 'received_date', l.received_date, 'on_hand', b.on_hand,
                                               'supplier_lot_no', l.supplier_lot_no, 'expiry_date', l.expiry_date, 'supplier', s.legal_name,
                                               'unit_cost', l.unit_cost, 'list_price', pr.list_price, 'floor_price', pr.floor_price, 'acquisition_cost', pr.acquisition_cost)
                            order by coalesce(s.legal_name, ''), l.received_date, l.lot_code), '[]'::jsonb)
    from public.inventory_item_lot_balances(p_business, p_inv, p_location) b
    join public.inventory_lots l on l.id = b.lot_id
    join public.logistics_inventory_items ii on ii.id = l.inventory_item_id
    left join public.finance_suppliers s on s.id = l.supplier_id
    left join lateral public.storefront_lot_price(ii.procurement_item_id, p_business, l.id) pr on true
   where b.on_hand > 0;
$$;

drop function if exists public.storefront_price_lines(uuid[]);
create function public.storefront_price_lines(p_items uuid[])
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, floor_price numeric, on_hand numeric, no_cost boolean,
              reserved numeric, available numeric, default_lot_id uuid, lots jsonb, stock_type text)
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
         d.lot,
         case when p.item_type = 'service' or loc is null or inv.id is null then '[]'::jsonb else public.sf_lot_options(b, inv.id, loc) end,
         fi.stock_type
    from unnest(p_items) x(id)
    join public.finance_procurement_items fi on fi.id = x.id
    left join lateral (select ii.id from public.logistics_inventory_items ii where ii.business_id = b and ii.procurement_item_id = x.id limit 1) inv on true
    left join lateral (select case when fi.item_type = 'service' or loc is null or inv.id is null then null else public.sf_line_lot(b, inv.id, loc, null) end as lot) d on true
    cross join lateral public.storefront_lot_price(x.id, b, d.lot) p;
end $$;
grant execute on function public.storefront_price_lines(uuid[]) to authenticated;

-- Price Review: every purchase price of an item, by supplier then date (lots, plus PO prices not yet received)
create or replace function public.price_review_purchases(p_item uuid)
returns table(supplier text, purchase_date date, unit_cost numeric, quantity numeric, source text, reference text, lot_code text, on_hand numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.price_review_business();
begin
  return query
  select x.* from (
    select s.legal_name as sup, l.received_date as d, l.unit_cost, l.received_qty,
           case l.source when 'receipt' then 'Received' when 'opening' then 'Opening stock' when 'count' then 'Stock count' else 'Earlier stock' end,
           coalesce(r.receipt_number, oc.count_number), l.lot_code, public.inventory_lot_on_hand(l.id, null)
      from public.inventory_lots l
      join public.logistics_inventory_items ii on ii.id = l.inventory_item_id and ii.procurement_item_id = p_item
      left join public.finance_suppliers s on s.id = l.supplier_id
      left join public.logistics_receipts r on r.id = l.receipt_id
      left join public.inventory_opening_counts oc on oc.id = l.opening_count_id
     where l.business_id = b
    union all
    select s.legal_name, h.purchase_date, h.effective_unit_price, h.quantity, 'Ordered (PO)', po.po_number, null::text, null::numeric
      from public.finance_item_supplier_price_history h
      left join public.finance_suppliers s on s.id = h.supplier_id
      left join public.purchase_orders po on po.id = h.purchase_order_id
     where h.business_id = b and h.item_id = p_item
       and not exists (select 1 from public.inventory_lots l join public.logistics_inventory_items ii on ii.id = l.inventory_item_id
                        where l.business_id = b and ii.procurement_item_id = p_item and l.purchase_order_id = h.purchase_order_id)
  ) x order by coalesce(x.sup, ''), x.d;
end $$;
grant execute on function public.price_review_purchases(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- SF-31 / CAT-38: counter sale priced from the lot; order-only items only from stock on hand
-- ---------------------------------------------------------------------------

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
end $function$;


-- ---------------------------------------------------------------------------
-- SF-31: cost of a sold line = purchase price of its lot (weighted average only without a priced lot)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.storefront_post_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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


-- ---------------------------------------------------------------------------
-- SF-31: Price Review prices from the oldest lot with stock, current cost beside it
-- ---------------------------------------------------------------------------

drop function if exists public.price_review_items(text, text, text, uuid, int, int);
CREATE FUNCTION public.price_review_items(p_q text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_brand text DEFAULT NULL::text, p_supplier uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(item_id uuid, item_code text, item_name text, category text, category_id uuid, brand text, unit text, item_type text, supplier text, supplier_cost numeric, cost_basis numeric, cost_age_days int, addon_percent numeric, acquisition_cost numeric, markup_percent numeric, store_price numeric, below_7 boolean, last_changed_at timestamp with time zone, last_changed_by text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b uuid := public.price_review_business(); esc text := '\';
        q text := nullif(btrim(coalesce(p_q, '')), ''); br text := nullif(btrim(coalesce(p_brand, '')), ''); ca text := nullif(btrim(coalesce(p_category, '')), '');
begin
  q  := replace(replace(replace(q,  esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  br := replace(replace(replace(br, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  return query
  with base as (
    select i.*, cat.id as cat_id, coalesce(cp.addon_percent, 0) as addon, coalesce(ip.markup_percent, 0) as markup,
           coalesce(case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end, 0)::numeric as cur_cost,
           public.catalog_cost_basis(i.id, b) as cost
      from public.finance_procurement_items i
      left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
      left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = b
      left join public.finance_catalog_item_pricing ip on ip.item_id = i.id and ip.active and ip.business_id = b
     where i.active
       and (ca is null or lower(i.category) = lower(ca))
       and (br is null or i.brand ilike '%' || br || '%')
       and (p_supplier is null or i.default_supplier_id = p_supplier
            or exists (select 1 from public.finance_procurement_item_suppliers s where s.item_id = i.id and s.supplier_id = p_supplier and s.active))
       and (q is null or i.item_name ilike '%' || q || '%' or i.item_code ilike '%' || q || '%' or coalesce(i.generic_item, '') ilike '%' || q || '%'
            or coalesce(i.brand, '') ilike '%' || q || '%')
  )
  select x.id, x.item_code, x.item_name, x.category, x.cat_id, x.brand, x.unit, x.item_type, s.legal_name, x.cur_cost, x.cost,
         case when x.cost_updated_at is null then null else ((now() at time zone 'Asia/Manila')::date - (x.cost_updated_at at time zone 'Asia/Manila')::date)::int end,
         x.addon, round(x.cost * (1 + x.addon / 100), 2), round(x.markup, 4), round(x.cost * (1 + x.addon / 100) * (1 + x.markup / 100), 2),
         x.markup < 7, lc.changed_at, lc.who, count(*) over ()
    from base x
    left join public.finance_suppliers s on s.id = x.default_supplier_id
    left join lateral (select c.changed_at, u.full_name as who from public.catalog_price_changes c left join public.users u on u.id = c.changed_by
                        where c.business_id = b and c.item_id = x.id order by c.changed_at desc limit 1) lc on true
   order by x.item_name
   limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end $function$;
grant execute on function public.price_review_items(text, text, text, uuid, int, int) to authenticated;


-- ---------------------------------------------------------------------------
-- CAT-38: no reorder warning for order-only items
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.logistics_dashboard_kpis()
 RETURNS TABLE(business_id uuid, business_code text, business_name text, active_locations bigint, active_items bigint, receipts_in_workflow bigint, receipts_awaiting_post bigint, adhoc_receipts_open bigint, transfers_pending bigint, low_stock_items bigint, on_hand_qty numeric, on_hand_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
       left join public.finance_procurement_items fpi on fpi.id = i.procurement_item_id
       join public.logistics_locations l on l.id = s.location_id and l.active
       left join bal on bal.inventory_item_id = s.inventory_item_id and bal.location_id = s.location_id
      where s.active and s.reorder_level > 0 and coalesce(bal.on_hand, 0) <= s.reorder_level and coalesce(fpi.stock_type, 'stock') = 'stock'),
    (select coalesce(sum(bal.on_hand), 0) from bal where bal.business_id = biz.id),
    case when public.can_view_inventory_cost() then
      (select coalesce(sum(bal.on_hand * c.avg_cost), 0) from bal
         join public.inventory_item_costs c on c.business_id = bal.business_id and c.item_id = bal.inventory_item_id
        where bal.business_id = biz.id and bal.on_hand > 0) end
  from biz order by biz.code;
$function$;


-- ---------------------------------------------------------------------------
-- CAT-38: the catalog upload sets the stock type
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.catalog_import_update_items(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update public.finance_procurement_items i set
      item_name = case when r ? 'item_name' and coalesce(btrim(r->>'item_name'), '') <> '' then btrim(r->>'item_name') else i.item_name end,
      category = case when r ? 'category' and coalesce(btrim(r->>'category'), '') <> '' then btrim(r->>'category') else i.category end,
      unit = case when r ? 'unit' and coalesce(btrim(r->>'unit'), '') <> '' then btrim(r->>'unit') else i.unit end,
      generic_item = case when r ? 'generic_item' then nullif(btrim(r->>'generic_item'), '') else i.generic_item end,
      brand = case when r ? 'brand' then nullif(btrim(r->>'brand'), '') else i.brand end,
      description = case when r ? 'description' then nullif(btrim(r->>'description'), '') else i.description end,
      specification = case when r ? 'specification' then nullif(btrim(r->>'specification'), '') else i.specification end,
      default_supplier_id = case when r ? 'default_supplier_id' then coalesce(nullif(r->>'default_supplier_id', '')::uuid, i.default_supplier_id) else i.default_supplier_id end,
      stock_type = case when r ? 'stock_type' and r->>'stock_type' in ('stock', 'order_only') then r->>'stock_type' else i.stock_type end,
      active = case when r ? 'reactivate' and (r->>'reactivate')::boolean then true else i.active end,
      updated_at = now()
     where i.id = (r->>'id')::uuid;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;


-- ---------------------------------------------------------------------------
-- Catalog price list view: stock type added at the end (export)
-- ---------------------------------------------------------------------------

create or replace view public.finance_catalog_price_list with (security_invoker = true) as
WITH b AS (
         SELECT pricing_business_id() AS id
        )
 SELECT i.id,
    i.item_code,
    i.item_name,
    i.description,
    i.category,
    i.unit,
    i.default_supplier_id,
    i.standard_cost,
    i.active,
    i.created_by,
    i.created_at,
    i.updated_at,
    i.item_type,
    i.service_cost_basis,
    i.cost_updated_at,
    i.cost_source_quote_id,
    i.generic_item,
    i.brand,
    i.photo_path,
    s.supplier_code,
    s.legal_name AS supplier_name,
    isup.supplier_item_code,
        CASE
            WHEN i.item_type = 'service'::text THEN i.service_cost_basis
            ELSE i.standard_cost
        END AS supplier_cost,
    ( SELECT b.id
           FROM b) AS pricing_business_id,
    cp.addon_percent,
    round(
        CASE
            WHEN i.item_type = 'service'::text THEN i.service_cost_basis
            ELSE i.standard_cost
        END * COALESCE(cp.addon_percent, 0::numeric) / 100::numeric, 2) AS addon_amount,
        CASE
            WHEN i.item_type = 'service'::text THEN NULL::numeric
            ELSE round(i.standard_cost * (1::numeric + COALESCE(cp.addon_percent, 0::numeric) / 100::numeric), 2)
        END AS acquisition_cost,
    ip.markup_percent,
        CASE
            WHEN (( SELECT b.id
               FROM b)) IS NULL THEN NULL::numeric
            ELSE round(
            CASE
                WHEN i.item_type = 'service'::text THEN i.service_cost_basis
                ELSE i.standard_cost
            END * (1::numeric + COALESCE(cp.addon_percent, 0::numeric) / 100::numeric) * (1::numeric + COALESCE(ip.markup_percent, 0::numeric) / 100::numeric), 2)
        END AS store_price,
    i.specification,
    i.photo_path_2,
    i.photo_path_3,
    i.stock_type
   FROM finance_procurement_items i
     LEFT JOIN finance_suppliers s ON s.id = i.default_supplier_id
     LEFT JOIN finance_procurement_item_suppliers isup ON isup.item_id = i.id AND isup.supplier_id = i.default_supplier_id
     LEFT JOIN finance_catalog_categories cat ON lower(TRIM(BOTH FROM cat.name)) = lower(TRIM(BOTH FROM i.category))
     LEFT JOIN finance_catalog_category_pricing cp ON cp.category_id = cat.id AND cp.active AND cp.business_id = (( SELECT b.id
           FROM b))
     LEFT JOIN finance_catalog_item_pricing ip ON ip.item_id = i.id AND ip.active AND ip.business_id = (( SELECT b.id
           FROM b));


-- ---------------------------------------------------------------------------
-- CAT-37: delete unused deactivated catalog items (Super Admin)
-- ---------------------------------------------------------------------------
-- the no-delete guard lets catalog_purge_unused through (and nothing else)
create or replace function public.guard_procurement_item_deactivation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('ibx.catalog_purge', true), '') <> 'on' then
    raise exception 'Catalog items cannot be deleted; deactivate them instead.';
  end if;
  return coalesce(new, old);
end $$;

-- A deactivated item with no history is deleted together with its own settings (store markups, customer
-- discounts, pricing / cost history, supplier links, unused inventory links). An item used in any
-- transaction (Storefront sales, quotations, sales orders, PR / PO lines, supplier quotes, purchase-price
-- history, opening counts, stock records) stays deactivated and is listed with the reason.
-- p_apply = false only lists what would happen.
create or replace function public.catalog_purge_unused(p_apply boolean default false)
returns table(item_id uuid, item_code text, item_name text, deleted boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare it record; v_reason text; inv uuid; n_del int := 0; n_kept int := 0;
begin
  if not public.is_super_admin() then raise exception 'Only the Super Admin can delete catalog items (the catalog is shared by all stores).'; end if;
  for it in select i.id, i.item_code, i.item_name from public.finance_procurement_items i where not i.active order by i.item_code loop
    v_reason := concat_ws(', ',
      case when exists (select 1 from public.storefront_sale_items x where x.item_id = it.id) then 'Storefront sales' end,
      case when exists (select 1 from public.sales_quotation_items x where x.catalog_item_id = it.id) then 'quotations' end,
      case when exists (select 1 from public.sales_order_items x where x.catalog_item_id = it.id) then 'sales orders' end,
      case when exists (select 1 from public.purchase_requisition_items x where x.item_id = it.id) then 'PRs' end,
      case when exists (select 1 from public.purchase_order_items x where x.item_id = it.id) then 'POs' end,
      case when exists (select 1 from public.finance_supplier_quote_log x where x.item_id = it.id) then 'supplier quotes' end,
      case when exists (select 1 from public.finance_item_supplier_price_history x where x.item_id = it.id) then 'purchase-price history' end,
      case when exists (select 1 from public.inventory_opening_count_lines x where x.item_id = it.id) then 'opening counts' end,
      case when exists (select 1 from public.logistics_inventory_items ii where ii.procurement_item_id = it.id
                          and (exists (select 1 from public.logistics_stock_movements m where m.inventory_item_id = ii.id)
                            or exists (select 1 from public.inventory_lots m where m.inventory_item_id = ii.id)
                            or exists (select 1 from public.logistics_receipt_items m where m.inventory_item_id = ii.id)
                            or exists (select 1 from public.logistics_stock_transfer_items m where m.inventory_item_id = ii.id)
                            or exists (select 1 from public.logistics_delivery_order_items m where m.inventory_item_id = ii.id))) then 'stock records' end);
    item_id := it.id; item_code := it.item_code; item_name := it.item_name;
    if nullif(v_reason, '') is not null then
      deleted := false; reason := 'Kept: used in ' || v_reason; n_kept := n_kept + 1; return next; continue;
    end if;
    if not p_apply then deleted := false; reason := 'Will be deleted'; return next; continue; end if;
    begin
      perform set_config('ibx.catalog_purge', 'on', true);
      for inv in select ii.id from public.logistics_inventory_items ii where ii.procurement_item_id = it.id loop
        delete from public.logistics_inventory_location_settings x where x.inventory_item_id = inv;
        delete from public.inventory_cost_history x where x.item_id = inv;
        delete from public.inventory_item_costs x where x.item_id = inv;
        delete from public.logistics_inventory_items x where x.id = inv;
      end loop;
      delete from public.catalog_price_changes x where x.item_id = it.id;
      delete from public.finance_catalog_customer_discounts x where x.item_id = it.id;
      delete from public.finance_catalog_item_pricing x where x.item_id = it.id;
      delete from public.finance_catalog_pricing_history x where x.item_id = it.id;
      delete from public.finance_item_cost_history x where x.item_id = it.id;
      delete from public.finance_procurement_item_suppliers x where x.item_id = it.id;
      delete from public.finance_procurement_items x where x.id = it.id;
      perform set_config('ibx.catalog_purge', 'off', true);
      deleted := true; reason := 'Deleted'; n_del := n_del + 1; return next;
    exception when foreign_key_violation then
      perform set_config('ibx.catalog_purge', 'off', true);
      deleted := false; reason := 'Kept: still referenced (' || sqlerrm || ')'; n_kept := n_kept + 1; return next;
    end;
  end loop;
  if p_apply then
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'finance_procurement_items', auth.uid(), 'catalog_unused_items_deleted', jsonb_build_object('deleted', n_del, 'kept', n_kept));
  end if;
end $$;
revoke all on function public.catalog_purge_unused(boolean) from public, anon;
grant execute on function public.catalog_purge_unused(boolean) to authenticated;
