-- Build 129 (agent quotations wait for office approval in every mode) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000051', 'agent.uia22@test');
insert into users(id, email, full_name, role, business_id) values ('00000000-0000-0000-0000-000000000051', 'agent.uia22@test', 'Uia', 'agent', proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('ag', public.sales_agent_save(null, '{"name":"Uia129"}')::text);
select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000051');
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'single');
select proof.as_user('00000000-0000-0000-0000-000000000051');
select proof.set('c', public.agent_add_client(proof.get('pili')::uuid, 'UIA22 Client')::text);
select proof.set('q', public.agent_quote_save(format('{"business_id":"%s","customer_id":"%s","lines":[{"item_id":"40000000-0000-0000-0000-000000000003","quantity":2,"tier":3}]}', proof.get('pili'), proof.get('c'))::jsonb)::text);
select proof.ok((select x->>'status' from jsonb_array_elements(public.agent_quotes_list(proof.get('pili')::uuid)) x where x->>'id' = proof.get('q')) = 'prepared', 'single-operator store: the agent''s quotation waits for the office (not auto-approved)');
select proof.as_owner();
select proof.ok((select setting from workflow_document_rules where entity_table = 'sales_quotations' and entity_id = proof.get('q')::uuid) = 'two_step', 'its approval rule is two steps');
select proof.ok((select count(*) from sales_quotation_items where quotation_id = proof.get('q')::uuid) = 1, 'the lines are saved');
-- the store's own quotation still follows the mode
insert into sales_quotations(id, business_id, customer_id, quotation_date, status, subtotal) values ('00000000-0000-0000-0000-0000012900a1', proof.get('pili')::uuid, proof.get('c')::uuid, current_date, 'draft', 100);
select proof.as_user('00000000-0000-0000-0000-000000000013');
update sales_quotations set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000012900a1';
select proof.as_owner();
select proof.ok((select status::text from sales_quotations where id = '00000000-0000-0000-0000-0000012900a1') = 'approved', 'a quotation made in the office is still auto-approved in single-operator mode');
rollback;
