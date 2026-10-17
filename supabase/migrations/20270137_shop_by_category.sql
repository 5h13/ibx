-- Build 136b — public shop: products grouped by category (owner, 2026-10-17).
-- shop_catalog lists by category, then name (so search / filter results group under category headings);
-- shop_catalog_by_category gives the first few products of every category for the shop's front page.

create or replace function public.shop_catalog(p_slug text, p_q text default null, p_category text default null, p_item text default null, p_brand text default null,
                                               p_limit int default 24, p_offset int default 0)
returns table(item_id uuid, item_name text, category text, generic_item text, brand text, unit text, photo_path text, price numeric, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare b uuid := public.shop_business(p_slug); esc text := '\';
        q text := nullif(btrim(coalesce(p_q, '')), ''); it text := nullif(btrim(coalesce(p_item, '')), '');
        br text := nullif(btrim(coalesce(p_brand, '')), ''); ca text := nullif(btrim(coalesce(p_category, '')), '');
begin
  if b is null then return; end if;
  q := left(q, 80);
  it := replace(replace(replace(it, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  br := replace(replace(replace(br, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  return query
  with hits as (
    select i.id, i.item_name, nullif(btrim(i.category), '') category, i.generic_item, i.brand, i.unit, coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) photo, count(*) over () total
      from public.finance_procurement_items i
     where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null
       and (ca is null or lower(i.category) = lower(ca))
       and (it is null or i.generic_item ilike '%' || it || '%')
       and (br is null or i.brand ilike '%' || br || '%')
       and (q is null or public.catalog_words_match(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.description, i.category), q))
     order by nullif(btrim(i.category), '') nulls last, i.item_name
     limit greatest(1, least(coalesce(p_limit, 24), 480)) offset greatest(0, coalesce(p_offset, 0)))
  select h.id, h.item_name, h.category, h.generic_item, h.brand, h.unit, h.photo,
         (select pr.list_price from public.storefront_item_price(h.id, b) pr where pr.list_price > 0), h.total
    from hits h order by h.category nulls last, h.item_name;
end $$;
revoke all on function public.shop_catalog(text, text, text, text, text, int, int) from public;
grant execute on function public.shop_catalog(text, text, text, text, text, int, int) to anon, authenticated;

create or replace function public.shop_catalog_by_category(p_slug text, p_per int default 8)
returns table(category text, item_id uuid, item_name text, brand text, unit text, photo_path text, price numeric, category_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare b uuid := public.shop_business(p_slug);
begin
  if b is null then return; end if;
  return query
  with items as (
    select coalesce(nullif(btrim(i.category), ''), 'Other') cat, i.id, i.item_name, i.brand, i.unit, coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) photo,
           row_number() over (partition by coalesce(nullif(btrim(i.category), ''), 'Other') order by i.item_name) rn,
           count(*) over (partition by coalesce(nullif(btrim(i.category), ''), 'Other')) n
      from public.finance_procurement_items i
     where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null)
  select x.cat, x.id, x.item_name, x.brand, x.unit, x.photo,
         (select pr.list_price from public.storefront_item_price(x.id, b) pr where pr.list_price > 0), x.n
    from items x where x.rn <= greatest(1, least(coalesce(p_per, 8), 12))
   order by (x.cat = 'Other'), x.cat, x.item_name;
end $$;
revoke all on function public.shop_catalog_by_category(text, int) from public;
grant execute on function public.shop_catalog_by_category(text, int) to anon, authenticated;
