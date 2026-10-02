-- ============================================================================
-- Build 76 — catalog readiness for go-live (user, 2026-09-29):
--   • the cleaned, price-confirmed catalog is re-uploaded offline-prepared and
--     overwrites the current one, matched by ITEM CODE (rows without a code are
--     new items; items missing from the file can be deactivated);
--   • a SPECIFICATION per item (from the file or the item form);
--   • up to 3 photos per item (added in the app);
--   • starting stock (LOG-46) comes in the same upload as an OPENING STOCK
--     column: it is recorded as an opening count for one store location, and a
--     Business Admin approves it before the stock and the starting (weighted
--     average) costs post;
--   • a product detail page (specification, larger photos) behind every
--     Product Search card.
-- ============================================================================

alter table public.finance_procurement_items
  add column if not exists specification text,
  add column if not exists photo_path_2 text,
  add column if not exists photo_path_3 text;

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
            WHEN (i.item_type = 'service'::text) THEN i.service_cost_basis
            ELSE i.standard_cost
        END AS supplier_cost,
    ( SELECT b.id
           FROM b) AS pricing_business_id,
    cp.addon_percent,
    round(((
        CASE
            WHEN (i.item_type = 'service'::text) THEN i.service_cost_basis
            ELSE i.standard_cost
        END * COALESCE(cp.addon_percent, (0)::numeric)) / (100)::numeric), 2) AS addon_amount,
        CASE
            WHEN (i.item_type = 'service'::text) THEN NULL::numeric
            ELSE round((i.standard_cost * ((1)::numeric + (COALESCE(cp.addon_percent, (0)::numeric) / (100)::numeric))), 2)
        END AS acquisition_cost,
    ip.markup_percent,
        CASE
            WHEN (( SELECT b.id
               FROM b) IS NULL) THEN NULL::numeric
            ELSE round(((
            CASE
                WHEN (i.item_type = 'service'::text) THEN i.service_cost_basis
                ELSE i.standard_cost
            END * ((1)::numeric + (COALESCE(cp.addon_percent, (0)::numeric) / (100)::numeric))) * ((1)::numeric + (COALESCE(ip.markup_percent, (0)::numeric) / (100)::numeric))), 2)
        END AS store_price
    ,i.specification,
    i.photo_path_2,
    i.photo_path_3
   FROM (((((finance_procurement_items i
     LEFT JOIN finance_suppliers s ON ((s.id = i.default_supplier_id)))
     LEFT JOIN finance_procurement_item_suppliers isup ON (((isup.item_id = i.id) AND (isup.supplier_id = i.default_supplier_id))))
     LEFT JOIN finance_catalog_categories cat ON ((lower(TRIM(BOTH FROM cat.name)) = lower(TRIM(BOTH FROM i.category)))))
     LEFT JOIN finance_catalog_category_pricing cp ON (((cp.category_id = cat.id) AND cp.active AND (cp.business_id = ( SELECT b.id
           FROM b)))))
     LEFT JOIN finance_catalog_item_pricing ip ON (((ip.item_id = i.id) AND ip.active AND (ip.business_id = ( SELECT b.id
           FROM b)))));

-- ------------------------------------------------ upload: update by ITEM CODE --
-- rows: [{id, item_name, category, unit, generic_item, brand, description,
--         specification, default_supplier_id}] — runs with the caller's rights
-- (catalog RLS decides who may change items). A key that is absent is left alone.
create or replace function public.catalog_import_update_items(p_rows jsonb)
returns int language plpgsql security invoker set search_path = public as $$
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
      active = case when r ? 'reactivate' and (r->>'reactivate')::boolean then true else i.active end,
      updated_at = now()
     where i.id = (r->>'id')::uuid;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function public.catalog_import_update_items(jsonb) to authenticated;

-- Items missing from a full-catalog upload are deactivated (never deleted, so
-- sales, stock and price history stay). Super Admin only: the catalog is shared.
create or replace function public.catalog_deactivate_missing(p_keep uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_super_admin() then raise exception 'Only the Super Admin can deactivate items missing from the upload (the catalog is shared by all stores).'; end if;
  if coalesce(cardinality(p_keep), 0) < 1 then raise exception 'The upload has no items; nothing was deactivated.'; end if;
  update public.finance_procurement_items set active = false, updated_at = now() where active and not (id = any(p_keep));
  get diagnostics n = row_count;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_procurement_items', auth.uid(), 'catalog_items_deactivated_by_upload', jsonb_build_object('count', n, 'kept', cardinality(p_keep)));
  return n;
end $$;
grant execute on function public.catalog_deactivate_missing(uuid[]) to authenticated;

-- ------------------------------------------------------ product detail page --
create or replace function public.catalog_product_detail(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_business uuid := public.pricing_business_id(); i record; v_price numeric; v_stock jsonb; v_on_hand numeric; v_stocked boolean;
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
  end if;
  return jsonb_build_object('id', i.id, 'item_code', i.item_code, 'item_name', i.item_name, 'category', i.category, 'generic_item', i.generic_item,
    'brand', i.brand, 'unit', i.unit, 'item_type', i.item_type, 'description', i.description, 'specification', i.specification,
    'photo_paths', to_jsonb(array_remove(array[i.photo_path, i.photo_path_2, i.photo_path_3], null)),
    'store_price', v_price, 'priced', v_business is not null,
    'stocked', coalesce(v_stocked, false), 'on_hand', case when v_business is null or i.item_type = 'service' or not coalesce(v_stocked, false) then null else v_on_hand end,
    'stock_by_location', coalesce(v_stock, '[]'::jsonb));
end $$;
grant execute on function public.catalog_product_detail(uuid) to authenticated;

-- ------------------------------------------------ opening counts (LOG-46) --
create table if not exists public.inventory_opening_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  count_number text not null unique,
  location_id uuid not null references public.logistics_locations(id),
  count_date date not null,
  status text not null default 'prepared' check (status in ('prepared','approved','rejected')),
  source text,
  line_count int not null default 0,
  total_qty numeric(16,3) not null default 0,
  total_value numeric(16,2) not null default 0,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create table if not exists public.inventory_opening_count_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  count_id uuid not null references public.inventory_opening_counts(id) on delete cascade,
  item_id uuid not null references public.finance_procurement_items(id),
  counted_qty numeric(14,3) not null check (counted_qty >= 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  inventory_item_id uuid references public.logistics_inventory_items(id),
  on_hand_before numeric(14,3),
  stock_movement_id uuid references public.logistics_stock_movements(id),
  unique (count_id, item_id)
);
create index if not exists inventory_opening_count_lines_count on public.inventory_opening_count_lines (count_id);
do $$
declare t text;
begin
  foreach t in array array['inventory_opening_counts','inventory_opening_count_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_business_isolation', t);
    execute format('create policy %I on public.%I as restrictive for all using (public.business_row_visible(business_id)) with check (public.business_row_visible(business_id))', t || '_business_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_super_admin() or public.is_business_admin() or public.has_section_access(''finance''))', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- p = {location_id, count_date, source, lines: [{item_id, qty, unit_cost}]}
-- unit_cost defaults to the item's Supplier Cost (the category add-on is a
-- pricing margin, not cost — SF-23).
create or replace function public.inventory_opening_count_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_id uuid; v_no text; v_code text; v_loc uuid := nullif(p->>'location_id', '')::uuid;
        v_date date := coalesce(nullif(p->>'count_date', '')::date, (now() at time zone 'Asia/Manila')::date); l record; it record; n int := 0;
begin
  if not (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')) then
    raise exception 'Only Finance or a Business Admin can record an opening count.';
  end if;
  if b is null then raise exception 'Select a business in "Acting as" first: the opening stock belongs to one store.'; end if;
  if not exists (select 1 from public.logistics_locations where id = v_loc and business_id = b and active) then raise exception 'Choose an active stock location of this store for the opening stock.'; end if;
  if v_date > (now() at time zone 'Asia/Manila')::date then raise exception 'The count date cannot be in the future.'; end if;
  if exists (select 1 from public.inventory_opening_counts where business_id = b and location_id = v_loc and status = 'prepared') then
    raise exception 'An opening count for this location is already waiting for approval; approve or reject it first.';
  end if;
  select code into v_code from public.businesses where id = b;
  perform pg_advisory_xact_lock(hashtext('OPC:' || v_code));
  select v_code || '-OPC-' || lpad((coalesce(max(substring(count_number from '[0-9]+$')::int), 0) + 1)::text, 5, '0') into v_no
    from public.inventory_opening_counts where business_id = b;
  insert into public.inventory_opening_counts(business_id, count_number, location_id, count_date, source, prepared_by)
  values (b, v_no, v_loc, v_date, nullif(btrim(coalesce(p->>'source', '')), ''), auth.uid()) returning id into v_id;
  for l in select * from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) as x(item_id uuid, qty numeric, unit_cost numeric) loop
    select id, item_name, item_type, standard_cost, active into it from public.finance_procurement_items where id = l.item_id;
    if not found then raise exception 'An item in the opening count is not in the catalog.'; end if;
    if it.item_type = 'service' then continue; end if;
    if l.qty is null then continue; end if;
    if l.qty < 0 then raise exception 'Opening stock for % cannot be negative.', it.item_name; end if;
    if coalesce(l.unit_cost, 0) < 0 then raise exception 'Unit cost for % cannot be negative.', it.item_name; end if;
    insert into public.inventory_opening_count_lines(business_id, count_id, item_id, counted_qty, unit_cost)
    values (b, v_id, it.id, round(l.qty, 3), round(coalesce(nullif(l.unit_cost, 0), it.standard_cost, 0), 4))
    on conflict (count_id, item_id) do update set counted_qty = excluded.counted_qty, unit_cost = excluded.unit_cost;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'The opening count has no stock lines.'; end if;
  update public.inventory_opening_counts c set line_count = x.n, total_qty = x.q, total_value = x.v
    from (select count(*) n, sum(counted_qty) q, round(sum(counted_qty * unit_cost), 2) v from public.inventory_opening_count_lines where count_id = v_id) x
   where c.id = v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'inventory_opening_counts', v_id, 'opening_count_prepared', jsonb_build_object('count_number', v_no, 'lines', n, 'location', v_loc));
  return (select jsonb_build_object('id', id, 'count_number', count_number, 'lines', line_count, 'total_qty', total_qty, 'total_value', total_value)
            from public.inventory_opening_counts where id = v_id);
end $$;

-- Approving posts: each item's stock at the location becomes the counted
-- quantity (an adjustment in, or an issue out, for the difference), and the
-- counted quantity at its unit cost sets the starting weighted average cost.
create or replace function public.inventory_opening_count_decide(p_count uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); c record; l record; v_inv uuid; v_loc_qty numeric; v_biz_qty numeric; v_delta numeric; v_mov uuid; n_in int := 0; n_out int := 0;
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
    if v_delta <> 0 then
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
      values (b, v_inv, c.location_id, c.count_date, case when v_delta > 0 then 'adjustment' else 'issue' end, abs(v_delta), l.unit_cost,
              'inventory_opening_counts', c.id, c.count_number, 'Opening stock count: counted ' || l.counted_qty || ', system had ' || v_loc_qty, auth.uid())
      returning id into v_mov;
      if v_delta > 0 then n_in := n_in + 1; else n_out := n_out + 1; end if;
    end if;
    update public.inventory_opening_count_lines set inventory_item_id = v_inv, on_hand_before = v_loc_qty, stock_movement_id = v_mov where id = l.id;
  end loop;
  update public.inventory_opening_counts set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = c.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'inventory_opening_counts', c.id, 'opening_count_approved', jsonb_build_object('count_number', c.count_number, 'raised', n_in, 'lowered', n_out));
  return jsonb_build_object('status', 'approved', 'raised', n_in, 'lowered', n_out, 'lines', c.line_count);
end $$;
grant execute on function public.inventory_opening_count_create(jsonb), public.inventory_opening_count_decide(uuid, boolean, text) to authenticated;

-- locations of the current store, for choosing where the opening stock goes
-- (Finance may not read Logistics tables directly)
create or replace function public.inventory_count_locations()
returns table(id uuid, location_code text, location_name text)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')) then raise exception 'Finance or Business Admin access is required.'; end if;
  return query select l.id, l.location_code, l.location_name from public.logistics_locations l where l.business_id = b and l.active order by l.location_code;
end $$;
grant execute on function public.inventory_count_locations() to authenticated;
