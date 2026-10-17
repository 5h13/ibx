-- Build 133 (Sales Manager "Needs attention": items, settings, done/snooze, alerts, summary, agent nudge) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('loc', (select id::text from logistics_locations where business_id = proof.get('pili')::uuid order by created_at limit 1));
select proof.set('m0', date_trunc('month', (now() at time zone 'Asia/Manila'))::date::text);
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000133', 'agent.p133@test');
insert into users(id, email, full_name, role, business_id) values ('00000000-0000-0000-0000-000000000133', 'agent.p133@test', 'Agent133', 'agent', proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
select proof.set('ag', public.sales_agent_save(null, '{"name":"Agent133"}')::text);
select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000133');
select proof.as_user('00000000-0000-0000-0000-000000000133');
select proof.set('c', public.agent_add_client(proof.get('pili')::uuid, 'Client133', '0917')::text);
select proof.as_owner();
-- the agent sold ₱60,000 a month before; ₱100 so far this month -> behind pace
insert into storefront_sales(business_id, sale_number, status, customer_id, location_id, dr_number, subtotal, total, amount_paid, balance, sale_date, agent_id)
values (proof.get('pili')::uuid, 'P133-1', 'completed', proof.get('c')::uuid, proof.get('loc')::uuid, 'P133-DR-1', 60000, 60000, 60000, 0, (proof.get('m0')::date - interval '2 months')::date + 1, proof.get('ag')::uuid),
       (proof.get('pili')::uuid, 'P133-2', 'completed', proof.get('c')::uuid, proof.get('loc')::uuid, 'P133-DR-2', 60000, 60000, 60000, 0, (proof.get('m0')::date - interval '1 month')::date + 1, proof.get('ag')::uuid),
       (proof.get('pili')::uuid, 'P133-3', 'completed', proof.get('c')::uuid, proof.get('loc')::uuid, 'P133-DR-3', 100, 100, 100, 0, proof.get('m0')::date, proof.get('ag')::uuid);
-- a counter price exception waiting 20 minutes
insert into storefront_sales(business_id, sale_number, status, customer_id, location_id, subtotal, total, amount_paid, balance, sale_date, created_at)
values (proof.get('pili')::uuid, 'P133-PX', 'pending_approval', proof.get('c')::uuid, proof.get('loc')::uuid, 500, 450, 0, 450, (now() at time zone 'Asia/Manila')::date, now() - interval '20 minutes');
select proof.set('px', (select 'price:' || id from storefront_sales where sale_number = 'P133-PX'));

\echo == A. settings
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok((public.manager_attention()->'settings'->>'price_minutes')::int = 15 and (public.manager_attention()->'settings'->>'summary_hour')::int = 8, 'defaults: 15 minutes, 8am summary, ...');
select public.manager_attention_settings_save('{"behind_from_day": 1, "summary_hour": 0}');
select proof.fails($$select public.manager_attention_settings_save('{"behind_pct": 150}')$$, 'between', 'a setting outside its range is refused');
select proof.fails($$select public.manager_attention_settings_save('{"colour": 1}')$$, 'Unknown setting', 'an unknown setting is refused');

\echo == B. items
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_attention()->'items') x where x->>'key' = proof.get('px') and x->>'level' = 'red'),
  'a counter price exception waiting 20 minutes is urgent (red)');
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_attention()->'items') x where x->>'key' = 'behind:' || proof.get('ag') || ':' || to_char(proof.get('m0')::date, 'YYYY-MM') and x->>'level' = 'amber'),
  'an agent below 80% of where he should be is flagged (amber)');
select public.manager_attention_settings_save('{"price_minutes": 30}');
select proof.ok(not exists (select 1 from jsonb_array_elements(public.manager_attention()->'items') x where x->>'key' = proof.get('px')), 'with the threshold at 30 minutes, the 20-minute wait is not flagged');
select public.manager_attention_settings_save('{"price_minutes": 15}');

\echo == C. done / snooze
select public.manager_attention_set(proof.get('px'), 'snoozed', 3);
select proof.ok(not exists (select 1 from jsonb_array_elements(public.manager_attention()->'items') x where x->>'key' = proof.get('px')) and (public.manager_attention()->>'snoozed')::int >= 1, 'a snoozed item leaves the list');
select public.manager_attention_set(proof.get('px'), 'open', null);
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_attention()->'items') x where x->>'key' = proof.get('px')), 'reopened, it is back');

\echo == D. alerts, summary, nudge
select proof.as_owner();
select proof.ok(public.attention_scan(proof.get('pili')::uuid) >= 3, 'the check sends the red alerts, the morning summary and the agent nudge');
select proof.ok(exists (select 1 from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000011' and title like 'Urgent · Counter price waiting%'), 'the Business Admin gets the urgent alert');
select proof.ok(exists (select 1 from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000011' and title like 'Good morning%' and action_url = '/manager'), 'and the morning summary');
select proof.ok(exists (select 1 from app_notifications where recipient_user_id = '00000000-0000-0000-0000-000000000133' and title like 'You are behind your target%' and action_url = '/agent'), 'the agent behind pace gets a nudge in the agent app');
select proof.ok(public.attention_scan(proof.get('pili')::uuid) = 0, 'run again: nothing is sent twice');
select proof.ok(public.attention_scan_all() >= 0, 'the background job runs over every store');

\echo == E. access
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.manager_attention()$$, 'Sales approvers', 'a cashier cannot open it');
select proof.fails($$select public.manager_attention_settings_save('{"price_minutes": 5}')$$, 'Sales Manager', 'a cashier cannot change the settings');
select proof.ok(public.manager_attention_scan() = 0, 'the open-app check does nothing for a cashier');
rollback;
