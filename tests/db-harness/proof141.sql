-- Build 139 (shop banner, WhatsApp, staff preview, requests, Inbox) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('other', (select business_id::text from users where id = '00000000-0000-0000-0000-000000000021'));
select proof.set('slug', (select slug from shop_settings where business_id = proof.get('pili')::uuid));
update shop_settings set enabled = false where business_id = proof.get('pili')::uuid;
update finance_procurement_items set photo_path = 'p/' || id where id = (select id from finance_procurement_items where active order by item_name limit 1);
select proof.set('it', (select id::text from finance_procurement_items where photo_path like 'p/%' limit 1));

\echo == A. a switched-off shop: hidden from visitors, previewed by its own staff
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_store(proof.get('slug')) is null, 'visitors do not see a shop that is off');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- PILI sales staff
select proof.ok((public.shop_store(proof.get('slug'))->>'preview')::boolean and (public.shop_store(proof.get('slug'))->>'manage')::boolean, 'its sales staff see it as a Preview, with Manage shop');
select proof.ok(public.shop_item(proof.get('slug'), proof.get('it')::uuid)->>'code' is not null, 'the item page carries the item code');
select proof.as_user('00000000-0000-0000-0000-000000000016');   -- PILI logistics
select proof.ok(public.shop_store(proof.get('slug')) is null, 'staff without Sales access do not');
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- another store's sales staff
select proof.ok(public.shop_store(proof.get('slug')) is null, 'another store''s staff do not');
select proof.as_owner();
update shop_settings set enabled = true where business_id = proof.get('pili')::uuid;
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(not (public.shop_store(proof.get('slug'))->>'preview')::boolean and not (public.shop_store(proof.get('slug'))->>'manage')::boolean, 'open: visitors see it, without Preview or Manage');

\echo == B. settings: WhatsApp, banner
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"whatsapp_number": "12ab"}')$$, 'WhatsApp number', 'a bad WhatsApp number is refused');
select public.shop_settings_save(proof.get('pili')::uuid, '{"whatsapp_number": "0917 123 4567", "banner_focus": "top"}');
select proof.fails($$select public.shop_settings_save(proof.get('pili')::uuid, '{"banner_focus": "left"}')$$, 'Keep in view', 'keep in view is top, middle or bottom');
select proof.ok(public.shop_banner_set(proof.get('pili')::uuid, proof.get('pili') || '/shop-banner-' || gen_random_uuid() || '.jpg') is null, 'the Business Admin sets a banner');
select proof.fails($$select public.shop_banner_set(proof.get('pili')::uuid, proof.get('other') || '/shop-banner-' || gen_random_uuid() || '.jpg')$$, 'own folder', 'a banner from another store''s folder is refused');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.shop_banner_set(proof.get('pili')::uuid, null)$$, 'Business Admin', 'sales staff cannot change the banner');
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_store(proof.get('slug'))->>'whatsapp_number' = '09171234567' and public.shop_store(proof.get('slug'))->>'banner_focus' = 'top'
            and public.shop_store(proof.get('slug'))->>'banner_path' like proof.get('pili') || '/shop-banner-%', 'the shop shows WhatsApp and the banner');

\echo == C. a buyer sends requests
select proof.set('r1', public.shop_send_request(proof.get('slug'), 'ask', 'Blower motor', 'Juan', '0917 555 0001', 'Is it available?', 1500, proof.get('it')::uuid, 'whatsapp')::text);
select proof.ok((proof.get('r1')::jsonb->>'number')::int >= 1001, 'the buyer gets a request number');
select proof.fails($$select public.shop_send_request(proof.get('slug'), 'ask', 'x', 'Juan', '12', 'hi')$$, 'mobile number', 'a mobile number is needed');
select proof.fails($$select public.shop_send_request(proof.get('slug'), 'ask', 'x', '  ', '09175550001', 'hi')$$, 'your name', 'a name is needed');
select proof.fails($$select public.shop_send_request(proof.get('slug'), 'order', 'x', 'Juan', '09175550001', 'hi')$$, 'could not be sent', 'only questions and quotation requests');
select public.shop_send_request(proof.get('slug'), 'quote', '', 'Juan', '09175550001', 'Compressor x2', null, null, 'viber') from generate_series(1, 4);
select proof.fails($$select public.shop_send_request(proof.get('slug'), 'ask', 'x', 'Juan', '09175550001', 'again')$$, 'several requests', 'a 6th request from one mobile within 10 minutes is refused');
select proof.ok(public.shop_request_status((proof.get('r1')::jsonb->>'token')::uuid)->>'status' = 'new', 'the buyer''s private page shows the request');
select proof.ok(public.shop_request_status(gen_random_uuid()) is null, 'a wrong link shows nothing');
select proof.fails($$select count(*) from public.shop_requests$$, 'permission denied', 'visitors cannot list requests');

\echo == D. the store's Inbox
select proof.as_owner();
select proof.ok((select count(*) from app_notifications where entity_table = 'shop_requests' and business_id = proof.get('pili')::uuid) >= 5
   and exists (select 1 from app_notifications where entity_table = 'shop_requests' and recipient_user_id = '00000000-0000-0000-0000-000000000011' and action_url = '/manager/inbox'),
   'the Business Admin and sales staff are notified');
select proof.ok((select item_code from finance_procurement_items where id = proof.get('it')::uuid) = (select item_code from shop_requests where token = (proof.get('r1')::jsonb->>'token')::uuid), 'the request keeps the item code');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.ok(public.shop_inbox_count() = 5, 'sales staff see 5 new requests');
select proof.ok(public.shop_inbox_seen() = 5, 'opening the Inbox marks the 5 seen');
select proof.ok(public.shop_inbox_count() = 0, '... and the count goes to 0');
select proof.ok(public.shop_request_status((proof.get('r1')::jsonb->>'token')::uuid)->>'status' = 'seen', 'the buyer sees "Seen by the store"');
select public.shop_request_answer((proof.get('r1')::jsonb->>'id')::uuid, 'confirmed', 'Available — pick up today');
select proof.fails($$select public.shop_request_answer((proof.get('r1')::jsonb->>'id')::uuid, 'lost', null)$$, 'Confirmed, Not available', 'only the listed answers');
select proof.as_user('00000000-0000-0000-0000-000000000016');
select proof.fails($$select public.shop_request_answer((proof.get('r1')::jsonb->>'id')::uuid, 'done', null)$$, 'not found', 'logistics cannot answer');
select proof.ok((select count(*) from public.shop_requests) = 0, 'logistics cannot read the Inbox');
select proof.as_user('00000000-0000-0000-0000-000000000021');
select proof.ok((select count(*) from public.shop_requests) = 0 and public.shop_inbox_count() = 0, 'another store''s staff see none');
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(public.shop_request_status((proof.get('r1')::jsonb->>'token')::uuid)->>'status' = 'confirmed'
            and public.shop_request_status((proof.get('r1')::jsonb->>'token')::uuid)->>'reply_note' = 'Available — pick up today', 'the buyer sees Confirmed and the store''s note');
rollback;
