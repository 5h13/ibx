-- Build 137 (shop layouts, Facebook link, sections, posts, slideshow) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
update shop_settings set enabled = true where business_id = proof.get('pili')::uuid;
update finance_procurement_items set photo_path = null, photo_path_2 = null, photo_path_3 = null;
update finance_procurement_items set photo_path = 'p/' || id, category = 'Parts', brand = 'Toyota', generic_item = 'Blower Motor'
 where id in (select id from finance_procurement_items where active order by item_name limit 3);
select proof.set('it', (select id::text from finance_procurement_items where photo_path like 'p/%' order by item_name limit 1));
select proof.set('nophoto', (select id::text from finance_procurement_items where active and photo_path is null limit 1));

\echo == A. settings
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"layout": "X"}')$$, 'layout A, B or C', 'only layouts A, B, C');
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"facebook_url": "https://evil.example/page"}')$$, 'Facebook page', 'only a facebook.com link');
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, jsonb_build_object('featured_item_id', proof.get('nophoto')))$$, 'with a photo', 'the featured product needs a photo');
select public.shop_settings_save(proof.get('pili')::uuid, jsonb_build_object('layout', 'B', 'facebook_url', 'https://www.facebook.com/Pili.Aire/', 'featured_item_id', proof.get('it'),
       'slideshow_category', 'Parts', 'slideshow_item', '', 'slideshow_brand', 'Toyota'));
select proof.ok((select (public.shop_admin_filters('Parts', null, 'Toyota')->>'count')::int) = 3, 'the slideshow choice shows how many products it will cycle');

\echo == B. posts
select proof.set('ann', public.shop_post_save('{"kind": "announcement", "title": "Open Sundays", "body": "Until December"}')::text);
select public.shop_post_save('{"kind": "announcement", "title": "Old news", "starts_on": "2026-01-01", "ends_on": "2026-01-31"}');
select proof.set('promo', public.shop_post_save(jsonb_build_object('kind', 'promo', 'title', '10% off compressors', 'item_id', proof.get('it'), 'link_category', 'Parts'))::text);
select proof.fails($$select public.shop_post_save('{"kind": "announcement", "title": "  "}')$$, 'Enter a title', 'a post needs a title');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.shop_post_save('{"kind": "announcement", "title": "x"}')$$, 'Business Admin', 'a cashier cannot post');

\echo == C. what a visitor sees
select proof.as_owner();
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_store('pili')->>'layout' = 'B' and public.shop_store('pili')->>'facebook_url' = 'https://www.facebook.com/Pili.Aire/', 'the shop knows its layout and Facebook page');
select proof.ok(public.shop_home('pili')->'promo'->>'title' = '10% off compressors' and (public.shop_home('pili')->'promo'->'item'->>'photo_path') is not null, 'the promotion shows, with its product photo');
select proof.ok(jsonb_array_length(public.shop_home('pili')->'announcements') = 1, 'current announcements only (an expired one is hidden)');
select proof.ok(public.shop_home('pili')->'featured'->>'item_id' = proof.get('it'), 'the featured product shows');
select proof.ok(jsonb_array_length(public.shop_home('pili')->'slideshow'->'items') = 3 and public.shop_home('pili')->'slideshow'->>'title' = 'Toyota Parts', 'the slideshow cycles Parts / – / Toyota (3 products)');
select proof.ok(not (public.shop_home('pili')->'featured' ?| array['standard_cost', 'acquisition_cost', 'on_hand']), 'no cost or stock quantity in the cards');

\echo == D. sections switched off
select proof.as_owner();
update shop_settings set show_promo = false, show_announcements = false, show_featured = false, show_slideshow = false where business_id = proof.get('pili')::uuid;
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_home('pili')->'promo' = 'null'::jsonb and jsonb_array_length(public.shop_home('pili')->'announcements') = 0
  and public.shop_home('pili')->'featured' = 'null'::jsonb and public.shop_home('pili')->'slideshow' = 'null'::jsonb, 'switched-off sections do not show');
rollback;
