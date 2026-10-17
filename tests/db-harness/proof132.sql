-- Build 132 (default target = average + 20%, target change with note + notice, agent page, agent Home) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('loc', (select id::text from logistics_locations where business_id = proof.get('pili')::uuid order by created_at limit 1));
select proof.set('y', extract(year from (now() at time zone 'Asia/Manila'))::text);
select proof.set('m', extract(month from (now() at time zone 'Asia/Manila'))::text);
select proof.set('m0', date_trunc('month', (now() at time zone 'Asia/Manila'))::date::text);
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000132', 'agent.p132@test');
insert into users(id, email, full_name, role, business_id) values ('00000000-0000-0000-0000-000000000132', 'agent.p132@test', 'Agent132', 'agent', proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
select proof.set('ag', public.sales_agent_save(null, '{"name":"Agent132"}')::text);
select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000132');
select proof.as_user('00000000-0000-0000-0000-000000000132');
select proof.set('c', public.agent_add_client(proof.get('pili')::uuid, 'Client132', '0917')::text);
select proof.set('c2', public.agent_add_client(proof.get('pili')::uuid, 'Quiet132', '0918')::text);
select proof.as_owner();
-- history: ₱30,000 three months ago, nothing two months ago, ₱30,000 last month -> average ₱20,000 -> default ₱24,000
insert into storefront_sales(business_id, sale_number, status, customer_id, location_id, dr_number, subtotal, total, amount_paid, balance, sale_date, agent_id)
values (proof.get('pili')::uuid, 'P132-1', 'completed', proof.get('c2')::uuid, proof.get('loc')::uuid, 'P132-DR-1', 30000, 30000, 30000, 0, (proof.get('m0')::date - interval '3 months')::date + 2, proof.get('ag')::uuid),
       (proof.get('pili')::uuid, 'P132-2', 'completed', proof.get('c')::uuid, proof.get('loc')::uuid, 'P132-DR-2', 30000, 30000, 30000, 0, (proof.get('m0')::date - interval '1 month')::date + 2, proof.get('ag')::uuid),
       (proof.get('pili')::uuid, 'P132-3', 'completed', proof.get('c')::uuid, proof.get('loc')::uuid, 'P132-DR-3', 5000, 5000, 5000, 0, proof.get('m0')::date, proof.get('ag')::uuid);
select proof.ok((select agent_id from storefront_sales where sale_number = 'P132-1') = proof.get('ag')::uuid, 'setup: the sales belong to the agent');

\echo == A. default target
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok((select (x->>'default')::numeric = 24000 and (x->>'target')::numeric = 24000 and (x->>'average')::numeric = 20000 and not (x->>'target_set')::boolean
  from jsonb_array_elements(public.manager_team(proof.get('y')::int, proof.get('m')::int)) x where x->>'agent_id' = proof.get('ag')),
  'with no target set, the target is the average monthly sales (₱20,000 over the 3 months since the first sale) + 20% = ₱24,000');

\echo == B. changing it needs a note and tells the agent
select proof.fails($$select public.manager_set_target(proof.get('y')::int, proof.get('m')::int, proof.get('ag')::uuid, null, 15000, '  ')$$, 'Add a note', 'a new target needs a note');
select public.manager_set_target(proof.get('y')::int, proof.get('m')::int, proof.get('ag')::uuid, null, 15000, 'Two big clients on leave this month');
select proof.ok((select (x->>'target')::numeric = 15000 and (x->>'target_set')::boolean and x->>'note' = 'Two big clients on leave this month'
  from jsonb_array_elements(public.manager_team(proof.get('y')::int, proof.get('m')::int)) x where x->>'agent_id' = proof.get('ag')),
  'the manager can set any amount (here below the default) with a note');
select proof.as_owner();
select proof.ok(exists (select 1 from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000132' and entity_table = 'sales_targets'
  and message like '%₱15,000%' and message like '%was ₱24,000%' and message like '%Two big clients on leave this month%' and action_url = '/agent'),
  'the agent is notified: new target, previous one, and the note');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok(public.manager_store_target(proof.get('pili')::uuid, proof.get('y')::int, proof.get('m')::int) >= 15000, 'with no store target, the people''s targets add up to it');

\echo == C. the agent's page in the manager app
select proof.ok((select (p->>'target')::numeric = 15000 and (p->>'default')::numeric = 24000 and p->>'note' is not null and (p->>'total')::numeric = 5000
   and jsonb_array_length(p->'months') = 12 and jsonb_array_length(p->'recent') = 3 and (p->>'rank')::int >= 1
   from (select public.manager_person(proof.get('ag')::uuid, null, proof.get('y')::int, proof.get('m')::int) p) z),
  'the agent''s page: month, target and note, 12 months, recent sales, rank');
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_person(proof.get('ag')::uuid, null, proof.get('y')::int, proof.get('m')::int)->'quiet') x
  where x->>'id' = proof.get('c2')), 'a client of his with no purchase for 60 days shows as quiet');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.manager_person(proof.get('ag')::uuid, null, 2026, 1)$$, 'Sales approvers', 'a cashier cannot open an agent''s page');

\echo == D. the agent's Home
select proof.as_user('00000000-0000-0000-0000-000000000132');
select proof.ok((select (h->>'total')::numeric = 5000 and (h->>'target')::numeric = 15000 and h->>'note' = 'Two big clients on leave this month'
   and jsonb_array_length(h->'months') = 6 and (h->>'clients')::int = 2 and (h->>'quiet_count')::int = 1 and h->'margin' is null
   from (select public.agent_home(proof.get('pili')::uuid) h) z),
  'the agent sees his month against the target with the note, 6 months, his clients and the quiet ones (no margins)');
select proof.fails($$select public.manager_person(proof.get('ag')::uuid, null, 2026, 1)$$, 'Sales approvers', 'an agent cannot open the manager pages');
rollback;
