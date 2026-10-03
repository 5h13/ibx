-- Build 86 (AGT-01 Part A: agents) proof: run after proof78-85 on the same database. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
select proof.set('store_pili', (select id::text from sales_agents where business_id = proof.get('pili')::uuid and kind = 'store'));
select proof.set('store_aton', (select id::text from sales_agents where business_id = proof.get('aton')::uuid and kind = 'store'));

\echo == A. store agents and the agent list
select proof.ok((select count(*) from businesses b where not exists (select 1 from sales_agents a where a.business_id = b.id and a.kind = 'store')) = 0, 'every store has its own Store agent');
select proof.ok(not exists (select 1 from finance_customers where agent_id is null), 'every existing customer has an agent');
select proof.ok(not exists (select 1 from storefront_sales where agent_id is null), 'every existing counter sale has an agent');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- PILI cashier
select proof.fails($$select public.sales_agent_save(null, '{"name":"Ikot"}')$$, 'Business Admin', 'a cashier cannot add agents');
select proof.ok(not exists (select 1 from sales_agents where id = proof.get('store_aton')::uuid), 'a PILI user does not see ATON''s Store agent');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
select proof.set('ikot', public.sales_agent_save(null, '{"name":"Ikot","phone":"0917","gcash_number":"0917"}')::text);
select proof.ok((select agent_code like 'AG-%' and kind = 'freelance' from sales_agents where id = proof.get('ikot')::uuid), 'a Business Admin adds a freelance agent (AG- code)');
select proof.fails($$select public.sales_agent_save(proof.get('store_pili')::uuid, '{"name":"Store","active":false}')$$, 'cannot be deactivated', 'the Store agent cannot be deactivated');

\echo == B. customer agent
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.set('c1', public.storefront_add_customer('Proof86 Walk Customer')::text);
select proof.ok((select agent_id from finance_customers where id = proof.get('c1')::uuid) = proof.get('store_pili')::uuid, 'a new customer defaults to the store''s own agent');
select proof.set('c2', public.storefront_add_customer('Proof86 Ikot Customer', null, null, null, proof.get('ikot')::uuid)::text);
select proof.ok((select agent_id from finance_customers where id = proof.get('c2')::uuid) = proof.get('ikot')::uuid, 'a new customer can be given a freelance agent');
reset role; select proof.as_owner();
select proof.fails($$update finance_customers set agent_id = proof.get('store_aton')::uuid where id = proof.get('c1')::uuid$$, 'another store', 'a customer cannot take another store''s own agent');

\echo == C. agent on the sale, locked to the customer
insert into storefront_sales(business_id, sale_number, sale_date, status, customer_id, location_id, total, subtotal)
select proof.get('pili')::uuid, 'PILI-T86-1', current_date, 'pending_approval', proof.get('c2')::uuid, location_id, 100, 100 from storefront_settings where business_id = proof.get('pili')::uuid;
select proof.ok((select agent_id from storefront_sales where sale_number = 'PILI-T86-1') = proof.get('ikot')::uuid, 'a counter sale takes the customer''s agent');
update storefront_sales set agent_id = proof.get('store_pili')::uuid where sale_number = 'PILI-T86-1';
select proof.ok((select agent_id from storefront_sales where sale_number = 'PILI-T86-1') = proof.get('ikot')::uuid, 'the agent cannot be changed on the sale itself');
update finance_customers set agent_id = proof.get('store_pili')::uuid where id = proof.get('c2')::uuid;
select proof.ok((select agent_id from storefront_sales where sale_number = 'PILI-T86-1') = proof.get('ikot')::uuid, 'changing the customer''s agent leaves past sales as they were');
insert into storefront_sales(business_id, sale_number, sale_date, status, customer_id, location_id, total, subtotal)
select proof.get('pili')::uuid, 'PILI-T86-2', current_date, 'pending_approval', proof.get('c2')::uuid, location_id, 100, 100 from storefront_settings where business_id = proof.get('pili')::uuid;
select proof.ok((select agent_id from storefront_sales where sale_number = 'PILI-T86-2') = proof.get('store_pili')::uuid, 'new sales follow the customer''s new agent');
update finance_customers set agent_id = proof.get('ikot')::uuid where id = proof.get('c2')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.sales_agent_save(proof.get('ikot')::uuid, '{"name":"Ikot","active":false}')$$, 'customers to another agent', 'an agent with customers cannot be deactivated');
\echo == Build 86 proof passed
rollback;
