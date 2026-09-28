-- ============================================================================
-- Build 66 — hardening (user request, 2026-09-28)
--
-- 1. Duplicate-item guard. Only ONE active catalog item may exist per
--    name + category + unit (ignoring capitals and extra spaces anywhere in the text). Enforced by
--    a unique index, so even two imports running at the same moment cannot
--    both create an item. Existing active duplicates are resolved first: the
--    oldest copy is kept, the others are deactivated (never deleted; history
--    and references stay) and each is written to audit_log.
--    catalog_insert_items(jsonb) inserts a batch and silently skips rows that
--    already exist (used by the CSV import).
--
-- 2. Catalog -> inventory linking. Stock is recorded per business against a
--    Logistics inventory item linked to the catalog item. Before this build
--    every link was made by hand, and a second business could never link an
--    item because inventory item codes were unique across ALL businesses.
--      * inventory item code is now unique per business;
--      * one inventory item per business per catalog item;
--      * a catalog item is linked automatically for a business when it is put
--        on that business's purchase order (so the PO can be received);
--      * existing PO lines are linked now (backfill);
--      * renaming a catalog item updates its linked inventory items;
--      * Product Search tells "Not stocked" (never linked for this business)
--        apart from "Out of stock" (linked, zero on hand).
-- ============================================================================

-- ---------------------------------------------------------------- 1. dupes --
-- Normalised identity text: lower case, trimmed, runs of spaces collapsed.
create or replace function public.catalog_norm(t text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(lower(btrim(coalesce(t, ''))), '\s+', ' ', 'g');
$$;

do $$
declare r record; n int := 0;
begin
  for r in
    with ranked as (
      select id, item_code, item_name,
             first_value(id) over w as keep_id,
             row_number() over w as rn
        from public.finance_procurement_items
       where active
      window w as (partition by public.catalog_norm(item_name), public.catalog_norm(category), public.catalog_norm(unit) order by created_at, id)
    )
    select * from ranked where rn > 1
  loop
    update public.finance_procurement_items set active = false, updated_at = now() where id = r.id;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (null, 'finance_procurement_items', r.id, 'duplicate_catalog_item_deactivated',
            jsonb_build_object('item_code', r.item_code, 'item_name', r.item_name, 'kept_item_id', r.keep_id, 'by', 'migration 20261117'));
    n := n + 1;
  end loop;
  raise notice 'Duplicate catalog items deactivated: %', n;
end $$;

create unique index if not exists finance_procurement_items_active_identity
  on public.finance_procurement_items (public.catalog_norm(item_name), public.catalog_norm(category), public.catalog_norm(unit))
  where active;

-- Batch insert for the CSV import: rows that already exist are skipped (no
-- error), so two imports running together cannot create duplicates.
-- SECURITY INVOKER: the caller's own insert rights (RLS) apply.
create or replace function public.catalog_insert_items(p_rows jsonb)
returns table(id uuid, item_code text, item_name text, category text, unit text)
language sql volatile security invoker set search_path = public as $$
  insert into public.finance_procurement_items as i
    (item_name, category, unit, generic_item, brand, description, default_supplier_id, standard_cost, item_type, created_by)
  select r.item_name, r.category, r.unit, r.generic_item, r.brand, r.description, r.default_supplier_id,
         coalesce(r.standard_cost, 0), coalesce(r.item_type, 'product'), auth.uid()
    from jsonb_to_recordset(p_rows) as r(item_name text, category text, unit text, generic_item text, brand text,
                                         description text, default_supplier_id uuid, standard_cost numeric, item_type text)
  on conflict (public.catalog_norm(item_name), public.catalog_norm(category), public.catalog_norm(unit)) where active do nothing
  returning i.id, i.item_code, i.item_name, i.category, i.unit;
$$;
grant execute on function public.catalog_insert_items(jsonb) to authenticated;

-- Find active items by the same identity rule (for the import's "already
-- exists?" check and to pick up ids of rows another import just created).
create or replace function public.catalog_lookup_items(p_rows jsonb)
returns table(id uuid, item_code text, identity_key text)
language sql stable security invoker set search_path = public as $$
  select i.id, i.item_code,
         public.catalog_norm(i.item_name) || '|' || public.catalog_norm(i.category) || '|' || public.catalog_norm(i.unit)
    from public.finance_procurement_items i
    join jsonb_to_recordset(p_rows) as r(item_name text, category text, unit text)
      on public.catalog_norm(i.item_name) = public.catalog_norm(r.item_name)
     and public.catalog_norm(i.category) = public.catalog_norm(r.category)
     and public.catalog_norm(i.unit) = public.catalog_norm(r.unit)
   where i.active;
$$;
grant execute on function public.catalog_lookup_items(jsonb) to authenticated;

-- ------------------------------------------------------- 2. inventory links --
alter table public.logistics_inventory_items drop constraint if exists logistics_inventory_items_item_code_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'logistics_inventory_items_business_code_key') then
    alter table public.logistics_inventory_items add constraint logistics_inventory_items_business_code_key unique (business_id, item_code);
  end if;
end $$;

do $$
begin
  if exists (select 1 from public.logistics_inventory_items where procurement_item_id is not null
              group by business_id, procurement_item_id having count(*) > 1) then
    raise notice 'Some catalog items are linked twice to inventory in one business; the one-link-per-business rule was NOT added. Merge them, then re-run this block.';
  else
    create unique index if not exists logistics_inventory_items_business_catalog
      on public.logistics_inventory_items (business_id, procurement_item_id) where procurement_item_id is not null;
  end if;
end $$;

-- the identity guard lets the catalog sync (below) update name / code
create or replace function public.guard_inventory_quantity_mutation()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or
    new.procurement_item_id is distinct from old.procurement_item_id or
    ((new.item_code is distinct from old.item_code or new.item_name is distinct from old.item_name)
      and coalesce(current_setting('ibx.inventory_catalog_sync', true), '') <> 'on')
  ) then
    raise exception 'Inventory identity is catalog-controlled; change the Product/Inventory reference through the authorized catalog workflow.';
  end if;
  return new;
end $function$;

-- Link one catalog item to inventory for one business (idempotent). Internal:
-- called only by the triggers below and the backfill, never by users.
create or replace function public.ensure_inventory_link(p_item uuid, p_business uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; c record;
begin
  if p_item is null or p_business is null then return null; end if;
  select id into v_id from public.logistics_inventory_items where business_id = p_business and procurement_item_id = p_item limit 1;
  if v_id is not null then return v_id; end if;
  select id, item_code, item_name, description, category, unit, item_type, active into c
    from public.finance_procurement_items where id = p_item;
  if not found or c.item_type = 'service' then return null; end if;
  insert into public.logistics_inventory_items(business_id, item_code, item_name, description, category, unit, procurement_item_id, reorder_level)
  values (p_business, c.item_code, c.item_name, c.description, c.category, c.unit, c.id, 0)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.logistics_inventory_items where business_id = p_business and procurement_item_id = p_item limit 1;
  end if;
  return v_id;
end $$;
revoke all on function public.ensure_inventory_link(uuid, uuid) from public, authenticated;

-- PO line -> link its catalog item for the PO's business
create or replace function public.link_po_line_to_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_business uuid;
begin
  if new.item_id is null then return new; end if;
  select business_id into v_business from public.purchase_orders where id = new.purchase_order_id;
  perform public.ensure_inventory_link(new.item_id, coalesce(v_business, new.business_id));
  return new;
end $$;
drop trigger if exists purchase_order_items_link_inventory on public.purchase_order_items;
create trigger purchase_order_items_link_inventory
  after insert or update of item_id on public.purchase_order_items
  for each row execute function public.link_po_line_to_inventory();

-- catalog rename / edit -> linked inventory items follow
create or replace function public.sync_inventory_from_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.item_name, new.item_code, new.description, new.category, new.unit)
     is distinct from (old.item_name, old.item_code, old.description, old.category, old.unit) then
    perform set_config('ibx.inventory_catalog_sync', 'on', true);
    update public.logistics_inventory_items
       set item_name = new.item_name, item_code = new.item_code, description = new.description,
           category = new.category, unit = new.unit, updated_at = now()
     where procurement_item_id = new.id;
    perform set_config('ibx.inventory_catalog_sync', 'off', true);
  end if;
  return new;
end $$;
drop trigger if exists finance_procurement_items_sync_inventory on public.finance_procurement_items;
create trigger finance_procurement_items_sync_inventory
  after update on public.finance_procurement_items
  for each row execute function public.sync_inventory_from_catalog();

-- backfill: every catalog item already on a purchase order
do $$
declare r record; n int := 0;
begin
  for r in
    select distinct poi.item_id, coalesce(po.business_id, poi.business_id) as business_id
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.purchase_order_id
     where poi.item_id is not null
  loop
    if public.ensure_inventory_link(r.item_id, r.business_id) is not null then n := n + 1; end if;
  end loop;
  raise notice 'PO catalog items linked to inventory: %', n;
end $$;

-- ------------------------------------------- Product Search: "Not stocked" --
drop function if exists public.catalog_product_search(text, text, text, text, boolean, int, int);
create function public.catalog_product_search(
  p_q text default null, p_category text default null, p_item text default null, p_brand text default null,
  p_in_stock_only boolean default false, p_limit int default 50, p_offset int default 0
)
returns table(
  item_id uuid, item_code text, item_name text, category text, generic_item text, brand text,
  description text, unit text, item_type text, photo_path text,
  store_price numeric, stocked boolean, on_hand numeric, stock_by_location jsonb, total_count bigint
)
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
         count(*) over ()
    from hits h
    left join linked lk on lk.pid = h.id
    left join stock_agg s on s.pid = h.id
    left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(h.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = v_business
    left join public.finance_catalog_item_pricing ip on ip.item_id = h.id and ip.active and ip.business_id = v_business
   where not coalesce(p_in_stock_only, false) or coalesce(s.on_hand, 0) > 0
   order by h.item_name
   limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.catalog_product_search(text, text, text, text, boolean, int, int) from public;
grant execute on function public.catalog_product_search(text, text, text, text, boolean, int, int) to authenticated;
