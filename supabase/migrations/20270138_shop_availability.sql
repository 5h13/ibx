-- Build 136c — public shop: "Available" when the store has the item on hand (on hand less what approved orders
-- have set aside), otherwise "By order" (owner, 2026-10-17). Never the quantity. Services: no label.

create or replace function public.shop_in_stock(p_business uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select sum(bal.on_hand)
                     from public.logistics_inventory_items inv
                     join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id
                     join public.logistics_locations l on l.id = bal.location_id and l.active
                    where inv.active and inv.business_id = p_business and l.business_id = p_business and inv.procurement_item_id = p_item), 0)
       - coalesce((select sum(greatest(soi.quantity - dl.released, 0))
                     from public.sales_order_items soi
                     join public.sales_orders so on so.id = soi.order_id
                     cross join lateral public.sf_order_line_delivered(soi.id) dl
                    where so.business_id = p_business and so.status::text in ('approved', 'processing') and soi.fulfilment = 'stock' and soi.catalog_item_id = p_item), 0) > 0;
$$;
revoke all on function public.shop_in_stock(uuid, uuid) from public;

drop function if exists public.shop_catalog(text, text, text, text, text, int, int);
create function public.shop_catalog(p_slug text, p_q text default null, p_category text default null, p_item text default null, p_brand text default null,
                                    p_limit int default 24, p_offset int default 0)
returns table(item_id uuid, item_name text, category text, generic_item text, brand text, unit text, photo_path text, price numeric, available boolean, total_count bigint)
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
    select i.id, i.item_name, nullif(btrim(i.category), '') category, i.generic_item, i.brand, i.unit, i.item_type,
           coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) photo, count(*) over () total
      from public.finance_procurement_items i
     where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null
       and (ca is null or lower(i.category) = lower(ca))
       and (it is null or i.generic_item ilike '%' || it || '%')
       and (br is null or i.brand ilike '%' || br || '%')
       and (q is null or public.catalog_words_match(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.description, i.category), q))
     order by nullif(btrim(i.category), '') nulls last, i.item_name
     limit greatest(1, least(coalesce(p_limit, 24), 480)) offset greatest(0, coalesce(p_offset, 0)))
  select h.id, h.item_name, h.category, h.generic_item, h.brand, h.unit, h.photo,
         (select pr.list_price from public.storefront_item_price(h.id, b) pr where pr.list_price > 0),
         case when h.item_type = 'service' then null else public.shop_in_stock(b, h.id) end, h.total
    from hits h order by h.category nulls last, h.item_name;
end $$;
revoke all on function public.shop_catalog(text, text, text, text, text, int, int) from public;
grant execute on function public.shop_catalog(text, text, text, text, text, int, int) to anon, authenticated;

drop function if exists public.shop_catalog_by_category(text, int);
create function public.shop_catalog_by_category(p_slug text, p_per int default 8)
returns table(category text, item_id uuid, item_name text, brand text, unit text, photo_path text, price numeric, available boolean, category_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare b uuid := public.shop_business(p_slug);
begin
  if b is null then return; end if;
  return query
  with items as (
    select coalesce(nullif(btrim(i.category), ''), 'Other') cat, i.id, i.item_name, i.brand, i.unit, i.item_type, coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) photo,
           row_number() over (partition by coalesce(nullif(btrim(i.category), ''), 'Other') order by i.item_name) rn,
           count(*) over (partition by coalesce(nullif(btrim(i.category), ''), 'Other')) n
      from public.finance_procurement_items i
     where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null)
  select x.cat, x.id, x.item_name, x.brand, x.unit, x.photo,
         (select pr.list_price from public.storefront_item_price(x.id, b) pr where pr.list_price > 0),
         case when x.item_type = 'service' then null else public.shop_in_stock(b, x.id) end, x.n
    from items x where x.rn <= greatest(1, least(coalesce(p_per, 8), 12))
   order by (x.cat = 'Other'), x.cat, x.item_name;
end $$;
revoke all on function public.shop_catalog_by_category(text, int) from public;
grant execute on function public.shop_catalog_by_category(text, int) to anon, authenticated;

create or replace function public.shop_item(p_slug text, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.shop_business(p_slug);
begin
  if b is null then return null; end if;
  return (
    select jsonb_build_object('id', i.id, 'name', i.item_name, 'category', i.category, 'generic_item', i.generic_item, 'brand', i.brand, 'unit', i.unit,
             'description', i.description, 'specification', i.specification, 'item_type', i.item_type,
             'photos', to_jsonb(array_remove(array[i.photo_path, i.photo_path_2, i.photo_path_3], null)),
             'price', (select pr.list_price from public.storefront_item_price(i.id, b) pr where pr.list_price > 0),
             'available', case when i.item_type = 'service' then null else public.shop_in_stock(b, i.id) end)
      from public.finance_procurement_items i
     where i.id = p_item and i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null);
end $$;
revoke all on function public.shop_item(text, uuid) from public;
grant execute on function public.shop_item(text, uuid) to anon, authenticated;
