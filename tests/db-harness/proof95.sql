-- Build 95 (agent app: product detail, agent order → sales order with "order from supplier" lines) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
select proof.set('fan', '40000000-0000-0000-0000-000000000003');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000051', 'agent.m95@test');
insert into users(id, email, full_name, role, business_id) values ('00000000-0000-0000-0000-000000000051', 'agent.m95@test', 'M95', 'agent', proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('ag', public.sales_agent_save(null, '{"name":"M95"}')::text);
select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000051');

\echo == A. product detail
select proof.as_user('00000000-0000-0000-0000-000000000051');
select proof.set('c', public.agent_add_client(proof.get('pili')::uuid, 'Proof95 Client')::text);
select public.agent_set_client_tier(proof.get('c')::uuid, 3);
select proof.set('d0', public.agent_product_detail(proof.get('pili')::uuid, proof.get('fan')::uuid)::text);
select proof.ok((proof.get('d0')::jsonb->>'client_price') is null and (proof.get('d0')::jsonb->>'tier4')::numeric <= (proof.get('d0')::jsonb->>'list_price')::numeric,
                'no client: no client price, the range is Tier 1 (list) to Tier 4');
select proof.set('d1', public.agent_product_detail(proof.get('pili')::uuid, proof.get('fan')::uuid, proof.get('c')::uuid)::text);
select proof.ok((proof.get('d1')::jsonb->>'client_price')::numeric = (proof.get('d1')::jsonb->>'tier3')::numeric, 'with a Tier 3 client: the client price is Tier 3');
select proof.ok(jsonb_typeof(proof.get('d1')::jsonb->'photo_paths') = 'array' and (proof.get('d1')::jsonb ? 'available'), 'detail carries photos and stock');
select proof.fails(format($$select public.agent_product_detail('%s', '%s', '%s')$$, proof.get('aton'), proof.get('fan'), proof.get('c')), '', 'a PILI client cannot be priced in ATON (store switch)');

\echo == B. agent order → sales order
select proof.set('o', public.agent_order_save(format('{"business_id":"%s","customer_id":"%s","send":true,"lines":[{"item_id":"%s","quantity":99999,"tier":3}]}', proof.get('pili'), proof.get('c'), proof.get('fan'))::jsonb)::text);
select proof.fails(format($$select public.storefront_agent_order_to_so('%s')$$, proof.get('o')), '', 'the agent cannot convert his own order');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- PILI cashier
select proof.set('ln', (select x->'lines'->0 from jsonb_array_elements(public.storefront_agent_orders()) x where x->>'id' = proof.get('o'))::text);
select proof.ok((proof.get('ln')::jsonb->>'available')::numeric < 99999, 'the storefront sees the line is short of stock');
select proof.set('so', public.storefront_agent_order_to_so(proof.get('o')::uuid, '[]', 'No stock')::text);
select proof.ok((proof.get('so')::jsonb->>'lines_to_source')::int = 1, 'short line defaults to "order from supplier"');
select proof.fails(format($$select public.storefront_agent_order_to_so('%s')$$, proof.get('o')), 'converted', 'an order converts once');
select proof.ok((select x->>'status' = 'converted' and x->>'sales_order_number' is not null from jsonb_array_elements(public.storefront_agent_orders()) x where x->>'id' = proof.get('o')),
                'the converted order shows with its sales order number');
reset role; select proof.as_owner();
select proof.ok((select status::text = 'prepared' and agent_id = proof.get('ag')::uuid and customer_id = proof.get('c')::uuid and business_id = proof.get('pili')::uuid from sales_orders where id = (proof.get('so')::jsonb->>'id')::uuid),
                'the sales order is in PILI, for the client and the agent (commission), waiting for the Sales approver');
select proof.ok((select fulfilment::text = 'source' and quantity = 99999 and unit_price = (select unit_price from agent_order_lines where order_id = proof.get('o')::uuid)
                   from sales_order_items where order_id = (proof.get('so')::jsonb->>'id')::uuid), 'line keeps the agent''s price, marked order-from-supplier');
update sales_orders set status = 'reviewed' where id = (proof.get('so')::jsonb->>'id')::uuid;
update sales_orders set status = 'approved' where id = (proof.get('so')::jsonb->>'id')::uuid;
select proof.ok(exists (select 1 from purchase_requisitions where sales_order_id = (proof.get('so')::jsonb->>'id')::uuid), 'approval releases a purchase request to Procurement');

\echo == C. a line with stock can stay "from stock"
select proof.as_user('00000000-0000-0000-0000-000000000051');
select proof.set('o2', public.agent_order_save(format('{"business_id":"%s","customer_id":"%s","send":true,"lines":[{"item_id":"%s","quantity":1,"tier":3}]}', proof.get('pili'), proof.get('c'), proof.get('fan'))::jsonb)::text);
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.set('so2', public.storefront_agent_order_to_so(proof.get('o2')::uuid, format('[{"item_id":"%s","fulfilment":"stock"}]', proof.get('fan'))::jsonb)::text);
select proof.ok((proof.get('so2')::jsonb->>'lines_to_source')::int = 0, 'the cashier''s choice "from stock" is kept');
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- ATON cashier
select proof.ok(not exists (select 1 from jsonb_array_elements(public.storefront_agent_orders()) x where x->>'id' in (proof.get('o'), proof.get('o2'))), 'ATON does not see PILI agent orders');
rollback;
