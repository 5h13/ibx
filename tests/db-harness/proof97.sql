-- Build 97e (agents per store) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
select proof.set('ag', public.sales_agent_save(null, '{"name":"Pili97"}')::text);
reset role; select proof.as_owner();
select proof.ok((select home_business_id from sales_agents where id = proof.get('ag')::uuid) = proof.get('pili')::uuid, 'an agent added in PILI belongs to PILI');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok(exists (select 1 from public.sales_agent_stores() where agent_id = proof.get('ag')::uuid), 'PILI sees its new agent');
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- ATON cashier
select proof.ok(not exists (select 1 from public.sales_agent_stores() where agent_id = proof.get('ag')::uuid), 'ATON does not see PILI''s agent');
select proof.ok(not exists (select 1 from public.sales_agent_stores() where business_id <> proof.get('aton')::uuid), 'ATON sees only ATON links');
reset role; select proof.as_owner();
insert into finance_customers(business_id, customer_code, legal_name, agent_id, active) values (proof.get('aton')::uuid, 'CUS-T97', 'Aton97 Client', proof.get('ag')::uuid, true);
select proof.as_user('00000000-0000-0000-0000-000000000021');
select proof.ok(exists (select 1 from public.sales_agent_stores() where agent_id = proof.get('ag')::uuid), 'once he has an ATON client, ATON sees him too');
rollback;
