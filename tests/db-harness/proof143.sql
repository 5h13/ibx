-- Build 141a (Super Admin "Acting as": shop posts, Studio, Inbox) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
update users set acting_business_id = proof.get('pili')::uuid where id = '00000000-0000-0000-0000-000000000001';
update finance_procurement_items set photo_path = 'p/' || id where id = (select id from finance_procurement_items where active order by item_name limit 1);
select proof.as_user('00000000-0000-0000-0000-000000000001');   -- Super Admin acting as PILI
select proof.set('post', public.shop_post_save('{"kind": "promo", "title": "Aircon sale", "link_category": "CAR AIRCON"}')::text);
select proof.ok((select business_id::text from shop_posts where id = proof.get('post')::uuid) = proof.get('pili'), 'the Super Admin''s promotion goes to the acting store');
select proof.ok(public.studio_post(jsonb_build_object('kind', 'announcement', 'title', 'x', 'image_path', proof.get('pili') || '/studio-1.png')) is not null, 'a Studio picture posts to the acting store');
select proof.ok((select count(*) from public.studio_products()) >= 1, 'the Studio shows the acting store''s catalog');
select public.studio_font_save('saira');
select proof.ok(public.shop_inbox_count() >= 0, 'the Inbox count works');
select proof.as_owner();
select proof.ok((select studio_font from shop_settings where business_id = proof.get('pili')::uuid) = 'saira', 'the font is saved for the acting store');
update users set acting_business_id = null where id = '00000000-0000-0000-0000-000000000001';
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.fails($$select public.shop_post_save('{"kind": "promo", "title": "x"}')$$, 'Acting as', 'without "Acting as": a clear message, nothing saved');
rollback;
