-- Build 136b (shop grouped by category) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
update shop_settings set enabled = true where business_id = proof.get('pili')::uuid;
update finance_procurement_items set photo_path = null, photo_path_2 = null, photo_path_3 = null;
update finance_procurement_items set photo_path = 'p/' || id, category = 'Parts' where id in (select id from finance_procurement_items where active order by item_name limit 12);
update finance_procurement_items set category = 'Refrigerant' where id in (select id from finance_procurement_items where active and photo_path like 'p/%' order by item_name limit 10);
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok((select count(*) from public.shop_catalog_by_category('pili', 2) where category = 'Refrigerant') = 2, 'the front page shows the first few products of each category');
select proof.ok((select max(category_count) from public.shop_catalog_by_category('pili', 2) where category = 'Refrigerant') = 4, 'with the category''s full count (for "See all")');
select proof.ok((select count(*) from public.shop_catalog('pili', null, 'Refrigerant', null, null, 60, 0)) = 4, 'See all lists the whole category');
select proof.ok((select bool_and(ok) from (select category is not distinct from lag(category) over () or lag(category) over () is null or category > lag(category) over () or category is null as ok
                  from public.shop_catalog('pili', null, null, null, null, 60, 0)) z), 'search / filter results come grouped by category');
select proof.ok(not exists (select 1 from public.shop_catalog_by_category('aton', 8)), 'a shop that is off shows nothing');
rollback;
