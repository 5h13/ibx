-- ============================================================================
-- Build 62 (user requests, 2026-09-27)
--
-- 1. Product Search — the catalog surfaced to Sales and other users as a
--    VIEW-ONLY lookup: search products, check the store price, check stock.
--    Sales and most staff have no read access to Logistics stock tables, and
--    must not see supplier cost / add-on / markup. So the lookup is one
--    SECURITY DEFINER function that:
--      * requires catalog read access (can_read_shared_catalog());
--      * returns only view-safe fields: item details, photo path, unit,
--        STORE PRICE and stock on hand (total + per location);
--      * prices and stock are for the caller's business only (own business,
--        or the Super Admin's "Acting as" business via pricing_business_id();
--        none selected -> no price / stock);
--      * escapes search text (no wildcard injection), caps page size.
--
-- 2. Business logo upload (Branding) — public bucket business-logos. Logos
--    are shown in the header on every page and are not sensitive; uploads are
--    done server-side by the Global Super Admin only (service role, after the
--    app's role check), so no storage write policy is granted to users.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do update set public = true;

create or replace function public.catalog_product_search(
  p_q text default null,
  p_category text default null,
  p_item text default null,
  p_brand text default null,
  p_in_stock_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table(
  item_id uuid, item_code text, item_name text, category text, generic_item text, brand text,
  description text, unit text, item_type text, photo_path text,
  store_price numeric, on_hand numeric, stock_by_location jsonb, total_count bigint
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
  with stock as (
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
         case when v_business is null or h.item_type = 'service' then null else coalesce(s.on_hand, 0) end,
         coalesce(s.by_loc, '[]'::jsonb),
         count(*) over ()
    from hits h
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
