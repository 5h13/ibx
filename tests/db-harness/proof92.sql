-- Build 92 (agent commission engine, agent quotations) proof: run after the other proofs on the same database. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('lm', (date_trunc('month', (now() at time zone 'Asia/Manila')::date) - interval '1 month')::date::text);   -- last month
select proof.set('tm', date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date::text);                          -- this month
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000041', 'agent.vin@test');
insert into users(id, email, full_name, role, business_id) values ('00000000-0000-0000-0000-000000000041', 'agent.vin@test', 'Vin', 'agent', proof.get('pili')::uuid);
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
select proof.set('ag', public.sales_agent_save(null, '{"name":"Vin92"}')::text);
select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000041');
select public.agent_commission_settings_save(proof.get('pili')::uuid, jsonb_build_object('default_rate', 20, 'max_rate', 30, 'start_date', proof.get('lm'),
  'rates', '[{"category":"Parts","rate":25}]'::jsonb));
select proof.fails($$select public.agent_commission_settings_save(proof.get('pili')::uuid, '{"brackets":[{"min_paid":1000,"points":0}]}')$$, 'start at ₱0', 'tier brackets must start at ₱0');
select proof.as_user('00000000-0000-0000-0000-000000000041');
select proof.set('c', public.agent_add_client(proof.get('pili')::uuid, 'Proof92 Client')::text);

\echo == A. last month: half paid
reset role; select proof.as_owner();
insert into storefront_sales(id, business_id, sale_number, sale_date, status, customer_id, location_id, subtotal, total)
select '00000000-0000-0000-0000-00000092000a', proof.get('pili')::uuid, 'PILI-T92-A', proof.get('lm')::date + 4, 'completed', proof.get('c')::uuid, location_id, 2000, 2000
  from storefront_settings where business_id = proof.get('pili')::uuid;
insert into storefront_sale_items(id, business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, line_total, acquisition_cost)
values ('00000000-0000-0000-0000-0000009200a1', proof.get('pili')::uuid, '00000000-0000-0000-0000-00000092000a', '40000000-0000-0000-0000-000000000003', 'FAN', 'Fan Motor', 'pc', 'product', 2, 1000, 1000, 2000, 600);
insert into storefront_payments(business_id, payment_number, sale_id, method, amount, kind, received_at)
values (proof.get('pili')::uuid, 'T92-P1', '00000000-0000-0000-0000-00000092000a', 'cash', 1000, 'sale', ((proof.get('lm')::date + 4)::timestamp + interval '10 hours') at time zone 'Asia/Manila');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('m1', public.agent_commission_statement(proof.get('ag')::uuid, proof.get('lm')::date)::text);
select proof.ok((proof.get('m1')::jsonb->>'paid_sales')::numeric = 1000 and (proof.get('m1')::jsonb->>'points')::numeric = -5, 'last month: ₱1,000 paid sales → below ₱200,000 → −5 points');
select proof.ok((proof.get('m1')::jsonb->>'earned')::numeric = 80, 'markup ₱800 × 50% paid × (25% Parts − 5) = ₱80');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.agent_commission_overview(current_date)$$, 'Business Admin, Finance', 'a cashier cannot see commission figures');
select proof.fails($$select public.agent_commission_close(proof.get('ag')::uuid, proof.get('lm')::date)$$, 'Business Admin', 'a cashier cannot close a month');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('cl', public.agent_commission_close(proof.get('ag')::uuid, proof.get('lm')::date)::text);
select proof.fails($$select public.agent_commission_close(proof.get('ag')::uuid, proof.get('tm')::date)$$, 'not over yet', 'this month cannot be closed yet');
select proof.fails($$select public.agent_commission_close(proof.get('ag')::uuid, proof.get('lm')::date)$$, 'already closed', 'a month closes once');
reset role; select proof.as_owner();
select proof.ok((select status::text = 'approved' and amount = 80 and vendor = 'Vin92' from expenses where id = (proof.get('cl')::jsonb->>'expense_id')::uuid), 'closing raises an approved ₱80 Commission expense for Finance to pay');
select proof.ok((select gl_account_code from admin_expense_categories where code = 'commission') = '5400', 'commission books to 5400 Sales Commission');

\echo == B. this month: the rest paid, a big sale, a return
insert into storefront_payments(business_id, payment_number, sale_id, method, amount, kind, received_at)
values (proof.get('pili')::uuid, 'T92-P2', '00000000-0000-0000-0000-00000092000a', 'cash', 1000, 'sale', now() - interval '1 minute');
insert into storefront_sales(id, business_id, sale_number, sale_date, status, customer_id, location_id, subtotal, total)
select x.id::uuid, proof.get('pili')::uuid, x.n, (now() at time zone 'Asia/Manila')::date, 'completed', proof.get('c')::uuid, s.location_id, x.t, x.t
  from storefront_settings s, (values ('00000000-0000-0000-0000-00000092000b', 'PILI-T92-B', 250000::numeric), ('00000000-0000-0000-0000-00000092000c', 'PILI-T92-C', 1000::numeric)) x(id, n, t)
 where s.business_id = proof.get('pili')::uuid;
insert into storefront_sale_items(id, business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, line_total, acquisition_cost) values
 ('00000000-0000-0000-0000-0000009200b1', proof.get('pili')::uuid, '00000000-0000-0000-0000-00000092000b', '40000000-0000-0000-0000-000000000003', 'FAN', 'Fan Motor (bulk)', 'lot', 'product', 1, 250000, 250000, 250000, 200000),
 ('00000000-0000-0000-0000-0000009200c1', proof.get('pili')::uuid, '00000000-0000-0000-0000-00000092000c', '40000000-0000-0000-0000-000000000003', 'FAN', 'Fan Motor', 'pc', 'product', 2, 500, 500, 1000, 300);
insert into storefront_payments(business_id, payment_number, sale_id, method, amount, kind, received_at) values
 (proof.get('pili')::uuid, 'T92-P3', '00000000-0000-0000-0000-00000092000b', 'cash', 250000, 'sale', now() - interval '1 minute'),
 (proof.get('pili')::uuid, 'T92-P4', '00000000-0000-0000-0000-00000092000c', 'cash', 1000, 'sale', now() - interval '1 minute');
insert into storefront_returns(id, business_id, return_number, return_date, sale_id, reason, total, refund_total)
values ('00000000-0000-0000-0000-0000009200d0', proof.get('pili')::uuid, 'T92-R1', (now() at time zone 'Asia/Manila')::date, '00000000-0000-0000-0000-00000092000c', 'proof', 500, 500);
insert into storefront_return_items(business_id, return_id, sale_item_id, quantity, unit_price, line_total)
values (proof.get('pili')::uuid, '00000000-0000-0000-0000-0000009200d0', '00000000-0000-0000-0000-0000009200c1', 1, 500, 500);
insert into storefront_payments(business_id, payment_number, return_id, method, amount, kind, received_at)
values (proof.get('pili')::uuid, 'T92-P5', '00000000-0000-0000-0000-0000009200d0', 'cash', 500, 'refund', now() - interval '1 minute');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.agent_commission_adjust(proof.get('ag')::uuid, proof.get('tm')::date, -150, 'Cash advance');
select proof.fails($$select public.agent_commission_adjust(proof.get('ag')::uuid, proof.get('lm')::date, 10, 'late')$$, 'already closed', 'no adjustments in a closed month');
select proof.set('m2', public.agent_commission_statement(proof.get('ag')::uuid, proof.get('tm')::date)::text);
select proof.ok((proof.get('m2')::jsonb->>'paid_sales')::numeric = 251500 and (proof.get('m2')::jsonb->>'points')::numeric = 0, 'this month: ₱251,500 paid (₱1,000 + ₱250,000 + ₱1,000 − ₱500 refund) → ₱200,000 bracket, 0 points');
select proof.ok((proof.get('m2')::jsonb->>'earned')::numeric = 12650, 'earned ₱100 (rest of last month''s sale) + ₱12,500 (big sale) + ₱50 (after the return) at 25%');
select proof.ok((proof.get('m2')::jsonb->>'payable')::numeric = 12500, 'payable after the −₱150 cash advance: ₱12,500');
select proof.ok((proof.get('m2')::jsonb->>'next_bracket')::numeric = 300000, 'the next bracket is ₱300,000');

\echo == C. the agent's own view
select proof.as_user('00000000-0000-0000-0000-000000000041');
select proof.set('mine', public.agent_commission_mine(proof.get('pili')::uuid)::text);
select proof.ok((proof.get('mine')::jsonb->>'earned')::numeric = 12650 and jsonb_array_length(proof.get('mine')::jsonb->'history') = 1, 'the agent sees this month and his closed month');
select proof.ok(((proof.get('mine')::jsonb->'history')->0->>'payable')::numeric = 80, 'his closed month shows ₱80');
select proof.fails($$select public.agent_commission_statement(proof.get('ag')::uuid, current_date)$$, 'Business Admin, Finance', 'the agent cannot open the staff statement');

\echo == D. agent quotations
select proof.fails(format($$select public.agent_quote_save('{"business_id":"%s","customer_id":"%s","lines":[{"item_id":"40000000-0000-0000-0000-000000000003","quantity":1,"unit_price":1}]}')$$, proof.get('pili'), proof.get('c')),
                   'lowest price', 'a quotation cannot go below Tier 4');
select proof.set('q', public.agent_quote_save(format('{"business_id":"%s","customer_id":"%s","notes":"Project ABC","lines":[{"item_id":"40000000-0000-0000-0000-000000000003","quantity":10,"tier":3}]}', proof.get('pili'), proof.get('c'))::jsonb)::text);
select proof.ok((select x->>'status' from jsonb_array_elements(public.agent_quotes_list(proof.get('pili')::uuid)) x where x->>'id' = proof.get('q')) = 'prepared', 'the quotation waits for the Sales approver (prepared)');
select proof.as_user('00000000-0000-0000-0000-000000000014');   -- Sales approver
select proof.ok((select agent_id from sales_quotations where id = proof.get('q')::uuid) = proof.get('ag')::uuid, 'Sales sees the agent''s quotation, with the agent on it');
reset role; select proof.as_owner();
select proof.ok((select unit_price from sales_quotation_items where quotation_id = proof.get('q')::uuid) = (select tier3 from (select public.tier_price(proof.get('pili')::uuid, 3, list_price, acquisition_cost, floor_price) as tier3 from public.storefront_item_price('40000000-0000-0000-0000-000000000003', proof.get('pili')::uuid)) z),
                'a Tier 3 line is priced at Tier 3');

rollback;
