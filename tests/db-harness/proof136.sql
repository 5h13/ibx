-- Build 136 (public online catalog per store) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
-- one active item with a photo, one without
select proof.set('it', (select id::text from finance_procurement_items where active order by item_name limit 1));
select proof.set('it2', (select id::text from finance_procurement_items where active and id <> proof.get('it')::uuid order by item_name limit 1));
update finance_procurement_items set photo_path = 'catalog/p136.jpg', photo_path_2 = null, photo_path_3 = null where id = proof.get('it')::uuid;
update finance_procurement_items set photo_path = null, photo_path_2 = null, photo_path_3 = null where id = proof.get('it2')::uuid;

\echo == A. off until the Super Admin turns it on
select proof.ok((select slug from shop_settings where business_id = proof.get('pili')::uuid) = 'pili', 'every store has its shop address (/shop/pili)');
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_store('pili') is null and not exists (select 1 from public.shop_catalog('pili')), 'a shop that is off shows nothing');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"enabled": true}')$$, 'Super Admin', 'a Business Admin cannot turn the shop on');
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"viber_number": "12345"}')$$, 'Viber number', 'a wrong Viber number is refused');
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"messenger_url": "http://evil.example"}')$$, 'Messenger link', 'only an m.me / facebook link is accepted');
select public.shop_settings_save(proof.get('pili')::uuid, '{"messenger_url": "https://m.me/piliaire", "viber_number": "0917 123 4567", "tagline": "Aircon & refrigeration parts"}');
select proof.ok((select viber_number from shop_settings where business_id = proof.get('pili')::uuid) = '09171234567', 'the Business Admin sets the contacts (number cleaned)');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"tagline": "x"}')$$, 'Business Admin', 'a cashier cannot change the shop settings');
select proof.as_user('00000000-0000-0000-0000-000000000001');   -- Super Admin
select public.shop_settings_save(proof.get('pili')::uuid, '{"enabled": true}');

\echo == B. what a visitor sees
select proof.as_owner();
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok((public.shop_store('pili')->>'messenger_url') = 'https://m.me/piliaire' and (public.shop_store('pili')->>'name') is not null, 'the open shop shows the store and its contacts');
select proof.ok(public.shop_store('aton') is null, 'another store''s shop stays off');
select proof.ok(exists (select 1 from public.shop_catalog('pili') c where c.item_id = proof.get('it')::uuid), 'an item with a photo is listed');
select proof.ok(not exists (select 1 from public.shop_catalog('pili', null, null, null, null, 60, 0) c where c.item_id = proof.get('it2')::uuid), 'an item without a photo is not');
select proof.ok((public.shop_item('pili', proof.get('it')::uuid)->'photos'->>0) = 'catalog/p136.jpg', 'the item page has its photos');
select proof.ok(not (public.shop_item('pili', proof.get('it')::uuid) ?| array['standard_cost', 'acquisition_cost', 'on_hand', 'supplier', 'markup_percent', 'floor_price']), 'no cost, stock, markup or supplier in the item page');
select proof.ok(public.shop_item('pili', proof.get('it2')::uuid) is null, 'an item without a photo cannot be opened');
select proof.ok(jsonb_typeof(public.shop_filters('pili')->'categories') = 'array', 'filter choices load');
select proof.ok((select count(*) from public.finance_procurement_items) = 0, 'a visitor reads nothing from the catalog table itself (row security)');
select proof.ok((select count(*) from public.shop_settings) = 0 and (select count(*) from public.storefront_sales) = 0, 'nor the shop settings or any sales');
select proof.ok(jsonb_array_length(public.shop_list()) = 1, 'the shop list shows the open shops only');
rollback;
