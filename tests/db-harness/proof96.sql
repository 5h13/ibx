-- Build 96 (Clients list, agent moves with notices, deleting logins without records) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000061', 'agent.a96@test'), ('00000000-0000-0000-0000-000000000062', 'agent.b96@test'),
                                        ('00000000-0000-0000-0000-000000000063', 'unused96@test');
insert into users(id, email, full_name, role, business_id) values
 ('00000000-0000-0000-0000-000000000061', 'agent.a96@test', 'A96', 'agent', proof.get('pili')::uuid),
 ('00000000-0000-0000-0000-000000000062', 'agent.b96@test', 'B96', 'agent', proof.get('pili')::uuid),
 ('00000000-0000-0000-0000-000000000063', 'unused96@test', 'Unused', 'sales', proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('a', public.sales_agent_save(null, '{"name":"A96"}')::text);
select proof.set('b', public.sales_agent_save(null, '{"name":"B96"}')::text);
select public.sales_agent_link_user(proof.get('a')::uuid, '00000000-0000-0000-0000-000000000061');
select public.sales_agent_link_user(proof.get('b')::uuid, '00000000-0000-0000-0000-000000000062');

\echo == A. Clients list
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier (Sales preparer)
select proof.set('c', public.sales_client_save(null, '{"legal_name":"Proof96 Client","phone":"0917","credit_limit":"50000"}')::text);
select proof.ok((select agent_kind = 'store' from (select x->>'agent_kind' as agent_kind from jsonb_array_elements(public.sales_clients_list()->'clients') x where x->>'id' = proof.get('c')) z),
                'a client added from the list goes to the store until an approver assigns an agent');
select proof.ok((public.sales_clients_list()->>'can_move')::boolean = false, 'the cashier cannot move clients');
reset role; select proof.as_owner();
select proof.ok((select credit_limit from finance_customers where id = proof.get('c')::uuid) = 0, 'Sales cannot set a credit limit (Finance / Business Admin only)');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails(format($$select public.sales_clients_move(array['%s']::uuid[], '%s')$$, proof.get('c'), proof.get('a')), 'Sales approver or the Business Admin', 'the cashier cannot move a client');
select proof.as_user('00000000-0000-0000-0000-000000000015');   -- Finance
select proof.fails(format($$update finance_customers set agent_id = '%s' where id = '%s'$$, proof.get('a'), proof.get('c')), 'Sales approver or the Business Admin', 'Finance (AR edit) can no longer move a client');

\echo == B. Sales approver moves clients; both agents told
select proof.as_user('00000000-0000-0000-0000-000000000014');   -- Sales approver
select proof.ok(public.sales_clients_move(array[proof.get('c')]::uuid[], proof.get('a')::uuid, 'covers San Pedro') = 1, 'the Sales approver moves the client to A96');
select proof.ok(public.sales_clients_move(array[proof.get('c')]::uuid[], proof.get('b')::uuid) = 1, 'and then to B96');
reset role; select proof.as_owner();
select proof.ok((select count(*) from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000061') = 2, 'A96 got "new client" then "moved away"');
select proof.ok((select count(*) from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000062' and title like 'New client%') = 1, 'B96 got "new client for you"');
select proof.ok((select message like '%Note: covers San Pedro%' from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000061' and title like 'New client%'), 'the note reaches the agent');
select proof.ok((select count(*) from audit_log where entity_id = proof.get('c')::uuid and action = 'customer_agent_moved') = 2, 'each move is in the audit log');
select proof.as_user('00000000-0000-0000-0000-000000000061');
select proof.ok((public.agent_notifications()->>'unread')::int = 2, 'A96 sees 2 unread notices in the agent app');
select public.agent_notifications_read();
select proof.ok((public.agent_notifications()->>'unread')::int = 0, 'opening them marks them read');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- Business Admin edits and moves in one save
select public.sales_client_save(proof.get('c')::uuid, format('{"legal_name":"Proof96 Client Inc","agent_id":"%s","move_note":"back to A","credit_limit":"20000"}', proof.get('a'))::jsonb);
reset role; select proof.as_owner();
select proof.ok((select agent_id = proof.get('a')::uuid and credit_limit = 20000 and legal_name = 'Proof96 Client Inc' from finance_customers where id = proof.get('c')::uuid), 'the Business Admin edits details, credit limit and agent');

\echo == B2. Super Admin acting as a store sees only that store
reset role; select proof.as_owner();
update users set acting_business_id = proof.get('pili')::uuid where id = '00000000-0000-0000-0000-000000000001';
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.ok(not exists (select 1 from jsonb_array_elements(public.sales_clients_list()->'clients') x where x->>'store' <> 'PILI')
                and (public.sales_clients_list()->>'business_id') = proof.get('pili'), 'acting as PILI: only PILI clients, and he can add / move');
reset role; select proof.as_owner();
update users set acting_business_id = null where id = '00000000-0000-0000-0000-000000000001';
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.ok((public.sales_clients_list()->>'business_id') is null and not (public.sales_clients_list()->>'can_move')::boolean, '5H13 level: every store, no adding / moving until a store is chosen');

\echo == C. deleting logins
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok(public.user_delete('00000000-0000-0000-0000-000000000063') = 'unused96@test', 'a login with no records is deleted');
reset role; select proof.as_owner();
select proof.ok(not exists (select 1 from users where id = '00000000-0000-0000-0000-000000000063'), 'it is gone');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.user_delete('00000000-0000-0000-0000-000000000013')$$, 'Deactivate it instead', 'a login with records cannot be deleted');
select proof.fails($$select public.user_delete('00000000-0000-0000-0000-000000000011')$$, 'own login', 'nobody deletes his own login');
select proof.fails($$select public.user_delete('00000000-0000-0000-0000-000000000001')$$, 'not found', 'a Business Admin cannot delete the Super Admin');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.user_delete('00000000-0000-0000-0000-000000000062')$$, 'Only an admin', 'a cashier cannot delete logins');
rollback;
