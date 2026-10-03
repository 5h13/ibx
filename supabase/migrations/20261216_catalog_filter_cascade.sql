-- ============================================================================
-- Build 84 — cascading catalog filters (owner, 2026-10-03)
--   The CATEGORY / ITEM / BRAND / SUPPLIER pick-lists narrow to what the other
--   selected filters allow: pick a category and the Item list shows only that
--   category's items, the Brand list only the brands carried for it, etc.
--   Each list is filtered by the OTHER selections (so the current choice can
--   still be changed). Item / brand match the way the searches do (contains,
--   case-insensitive). Replaces the zero-argument version; existing calls with
--   no arguments still work (every argument defaults to null).
--   SECURITY INVOKER as before: the caller's catalog read access (RLS) applies.
--   Kind 'supplier' returns supplier ids (labels come from the supplier list
--   the page already has).
-- ============================================================================
drop function if exists public.catalog_filter_values();

create or replace function public.catalog_filter_values(
  p_category text default null, p_item text default null, p_brand text default null, p_supplier text default null)
returns table(kind text, value text)
language plpgsql stable security invoker set search_path = public as $$
declare
  esc constant text := '\';
  ca text := nullif(btrim(coalesce(p_category, '')), '');
  it text := nullif(btrim(coalesce(p_item, '')), '');
  br text := nullif(btrim(coalesce(p_brand, '')), '');
  su text := nullif(btrim(coalesce(p_supplier, '')), '');
  sid uuid;
begin
  it := replace(replace(replace(it, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  br := replace(replace(replace(br, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  if su is not null and su <> 'none' then
    begin sid := su::uuid; exception when others then su := null; end;
  end if;

  return query
  with base as (
    select btrim(i.category) as category, btrim(i.generic_item) as generic_item, btrim(i.brand) as brand, i.default_supplier_id,
           (ca is null or lower(i.category) = lower(ca)) as m_ca,
           (it is null or i.generic_item ilike '%' || it || '%') as m_it,
           (br is null or i.brand ilike '%' || br || '%') as m_br,
           (su is null or (su = 'none' and i.default_supplier_id is null) or i.default_supplier_id = sid) as m_su
      from public.finance_procurement_items i
     where i.active
  )
  select x.kind, x.value from (
    select distinct 'category'::text as kind, b.category as value from base b
     where m_it and m_br and m_su and coalesce(b.category, '') <> ''
       and exists (select 1 from public.finance_catalog_categories c where c.active and lower(c.name) = lower(b.category))
    union
    select distinct 'item', b.generic_item from base b where m_ca and m_br and m_su and coalesce(b.generic_item, '') <> ''
    union
    select distinct 'brand', b.brand from base b where m_ca and m_it and m_su and coalesce(b.brand, '') <> ''
    union
    select distinct 'supplier', b.default_supplier_id::text from base b where m_ca and m_it and m_br and b.default_supplier_id is not null
  ) x
  order by 1, 2;
end $$;
grant execute on function public.catalog_filter_values(text, text, text, text) to authenticated;
