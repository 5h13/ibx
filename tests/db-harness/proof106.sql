-- Build 106 (one login for staff who also sell as agents) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
insert into sales_agents(id, agent_code, name, kind, business_id, active) values ('00000000-0000-0000-0000-0000010600a1', 'T106', 'Agent T106', 'freelance', null, true);

\echo == A. link a staff login (Finance) to an agent record
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok(public.current_agent_id() is null, 'before linking, the Finance user is not an agent');
select proof.fails($$select public.sales_agent_link_user('00000000-0000-0000-0000-0000010600a1', '00000000-0000-0000-0000-000000000015')$$, 'Only a Business Admin', 'staff cannot link themselves');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select public.sales_agent_link_user('00000000-0000-0000-0000-0000010600a1', '00000000-0000-0000-0000-000000000015');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok(public.current_agent_id() = '00000000-0000-0000-0000-0000010600a1', 'the Finance login now opens the agent app as Agent T106');
select proof.ok((select role::text from users where id = auth.uid()) = 'finance', 'and keeps its Finance role');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.sales_agent_link_user('00000000-0000-0000-0000-0000010600a1', '00000000-0000-0000-0000-000000000016')$$, 'already has a login', 'one agent record, one login');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000001');   -- Super Admin
select proof.fails($$select public.sales_agent_link_user('00000000-0000-0000-0000-0000010600a1', '00000000-0000-0000-0000-000000000001')$$, 'Super Admin account cannot', 'a Super Admin account is never linked');

\echo == B. unlinking
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.sales_agent_link_user(null, '00000000-0000-0000-0000-000000000015');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok(public.current_agent_id() is null, '"No — staff only" removes the link');
reset role;
rollback;
