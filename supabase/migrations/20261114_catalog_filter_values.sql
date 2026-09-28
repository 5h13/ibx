-- ============================================================================
-- Build 61 — catalog search filters (CATEGORY, ITEM, BRAND, SUPPLIER).
-- Distinct ITEM (generic_item) and BRAND values for the filter pick-lists.
-- A plain select would be cut off at the API row limit (1,000) on a full
-- catalog, so the distinct lists come from this function. SECURITY INVOKER:
-- the caller's catalog read access (RLS) applies.
-- ============================================================================
create or replace function public.catalog_filter_values()
returns table(kind text, value text)
language sql stable security invoker set search_path = public as $$
  select 'item'::text, v from (
    select distinct btrim(generic_item) as v from public.finance_procurement_items
     where active and coalesce(btrim(generic_item), '') <> '') x
  union all
  select 'brand'::text, v from (
    select distinct btrim(brand) as v from public.finance_procurement_items
     where active and coalesce(btrim(brand), '') <> '') y
  order by 1, 2;
$$;
grant execute on function public.catalog_filter_values() to authenticated;
