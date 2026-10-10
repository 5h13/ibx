-- Build 94 (store agents on % of gross sales) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('lm', (date_trunc('month', (now() at time zone 'Asia/Manila')::date) - interval '1 month')::date::text);
select proof.set('loc', (select location_id::text from storefront_settings where business_id = proof.get('pili')::uuid));
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.agent_commission_settings_save(proof.get('pili')::uuid, jsonb_build_object('start_date', proof.get('lm')));
select proof.set('ray', public.sales_agent_save(null, '{"name":"Raymart94"}')::text);
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.sales_agent_commission_setup(proof.get('ray')::uuid, '{"commission_basis":"gross","commission_rate":1}')$$, 'Business Admin', 'a cashier cannot change how an agent is paid');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.sales_agent_commission_setup(proof.get('ray')::uuid, '{"commission_basis":"gross","commission_rate":1,"gross_less_expenses":true}');
select proof.fails($$select public.sales_agent_commission_setup(public.sales_agent_store(proof.get('pili')::uuid), '{"commission_basis":"gross"}')$$, 'Store agent itself', 'the Store agent itself has no commission');
reset role; select proof.as_owner();
insert into finance_customers(id, business_id, customer_code, legal_name, active, agent_id)
values ('00000000-0000-0000-0000-0000000c0941', proof.get('pili')::uuid, 'CUS-PILI-T941', 'Proof94 client', true, proof.get('ray')::uuid);
-- last month: ₱265,250 of Ikot sales (one unpaid), ₱11,048 of Ikot expenses (as in ISHABELLA's August)
insert into storefront_sales(id, business_id, sale_number, sale_date, status, customer_id, location_id, subtotal, total, amount_paid, balance)
values ('00000000-0000-0000-0000-000000094001', proof.get('pili')::uuid, 'T94-1', proof.get('lm')::date + 3, 'completed', '00000000-0000-0000-0000-0000000c0941', proof.get('loc')::uuid, 200000, 200000, 200000, 0),
       ('00000000-0000-0000-0000-000000094002', proof.get('pili')::uuid, 'T94-2', proof.get('lm')::date + 9, 'completed', '00000000-0000-0000-0000-0000000c0941', proof.get('loc')::uuid, 65250, 65250, 0, 65250);
insert into agent_expenses(business_id, expense_number, agent_id, expense_date, category_id, amount, description, status)
values (proof.get('pili')::uuid, 'T94-E1', proof.get('ray')::uuid, proof.get('lm')::date + 9, (select id from admin_expense_categories where code = 'transportation'), 11048, 'Ikot trip', 'approved');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('m', public.agent_commission_statement(proof.get('ray')::uuid, proof.get('lm')::date)::text);
select proof.ok((proof.get('m')::jsonb->>'basis') = 'gross' and (proof.get('m')::jsonb->>'paid_sales')::numeric = 265250, 'a store agent counts the month''s gross sales, paid or not');
select proof.ok((proof.get('m')::jsonb->>'earned')::numeric = 2542.02, 'ISHABELLA''s August: (₱265,250 − ₱11,048) × 1% = ₱2,542.02');
select public.sales_agent_commission_setup(proof.get('ray')::uuid, '{"commission_basis":"gross","commission_rate":1,"gross_less_expenses":true,"tiers":[{"min_sales":0,"rate":1},{"min_sales":250000,"rate":1.5}]}');
select proof.set('m2', public.agent_commission_statement(proof.get('ray')::uuid, proof.get('lm')::date)::text);
select proof.ok((proof.get('m2')::jsonb->>'rate')::numeric = 1.5 and (proof.get('m2')::jsonb->>'earned')::numeric = 3813.03, 'tiered: ₱265,250 reaches the ₱250,000 tier → 1.5% → ₱3,813.03');
select proof.ok(public.agent_commission_overview(proof.get('lm')::date)->'agents' @> jsonb_build_array(jsonb_build_object('agent', 'Raymart94', 'basis', 'gross')), 'the overview shows the agent''s basis');
select proof.set('cl', public.agent_commission_close(proof.get('ray')::uuid, proof.get('lm')::date)::text);
reset role; select proof.as_owner();
select proof.ok((select amount = 3813.03 and status::text = 'approved' from expenses where id = (proof.get('cl')::jsonb->>'expense_id')::uuid), 'closing raises the ₱3,813.03 Commission expense');
select proof.ok((select payable from agent_commission_periods where agent_id = proof.get('ray')::uuid) = 3813.03, 'the closed month keeps ₱3,813.03');
rollback;
