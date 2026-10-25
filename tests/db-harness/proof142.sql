-- Build 141 (Studio: products, font, posting pictures on the shop) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('slug', (select slug from shop_settings where business_id = proof.get('pili')::uuid));
update shop_settings set enabled = true, show_promo = false, show_announcements = false where business_id = proof.get('pili')::uuid;
update finance_procurement_items set photo_path = 'p/' || id where id in (select id from finance_procurement_items where active order by item_name limit 2);
select proof.set('it', (select id::text from finance_procurement_items where photo_path like 'p/%' order by item_name limit 1));
select proof.set('img', proof.get('pili') || '/studio-1761370000000.png');

\echo == A. who may use the Studio
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- PILI sales staff
select proof.ok((select count(*) from public.studio_products()) = 2, 'sales staff see the catalog items with photos');
select proof.ok((select code from public.studio_products() limit 1) is not null and not exists (
  select 1 from information_schema.routines r where r.routine_name = 'studio_products' and r.data_type ilike '%cost%'), 'items come with their code; no cost column');
select proof.as_user('00000000-0000-0000-0000-000000000016');   -- PILI logistics
select proof.fails($$select count(*) from public.studio_products()$$, 'sales and marketing', 'logistics cannot open the Studio');
select proof.fails($$select public.studio_font_save('oswald')$$, 'sales and marketing', 'logistics cannot change the font');

\echo == B. the store's font
select proof.as_user('00000000-0000-0000-0000-000000000013');
select public.studio_font_save('oswald');
select proof.fails($$select public.studio_font_save('comic')$$, 'Choose a font', 'only the 5 fonts');
select proof.as_owner();
select proof.ok((select studio_font from shop_settings where business_id = proof.get('pili')::uuid) = 'oswald', 'the font is saved for the store');

\echo == C. posting a picture
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.set('promo', public.studio_post(jsonb_build_object('kind', 'promo', 'title', 'Aircon sale', 'image_path', proof.get('img'), 'item_id', proof.get('it')))::text);
select public.studio_post(jsonb_build_object('kind', 'announcement', 'title', 'Closed on Sunday', 'image_path', proof.get('pili') || '/studio-1761370000001.png'));
select proof.fails($$select public.studio_post(jsonb_build_object('kind', 'promo', 'image_path', gen_random_uuid() || '/studio-1.png'))$$, 'another store', 'a picture from another store''s folder is refused');
select proof.fails($$select public.studio_post(jsonb_build_object('kind', 'promo', 'image_path', 'x.png'))$$, 'another store', 'a picture outside the store''s folder is refused');
select proof.fails($$select public.studio_post(jsonb_build_object('kind', 'promo', 'image_path', proof.get('img'), 'ends_on', '2020-01-01'))$$, 'passed', 'an end date in the past is refused');
select proof.fails($$select public.studio_post(jsonb_build_object('kind', 'news', 'image_path', proof.get('img')))$$, 'promotion or an announcement', 'only promotion or announcement');
select proof.as_owner();
select proof.ok((select show_promo and show_announcements from shop_settings where business_id = proof.get('pili')::uuid), 'posting turns the promotion and announcements sections on');

\echo == D. what visitors see
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_home(proof.get('slug'))->'promo'->>'image_path' = proof.get('img') and public.shop_home(proof.get('slug'))->'promo'->'item'->>'item_id' = proof.get('it'), 'the shop shows the promotion picture, linked to its item');
select proof.ok(public.shop_home(proof.get('slug'))->'announcements'->0->>'image_path' like '%studio-1761370000001.png', 'the announcement shows its picture');
rollback;
