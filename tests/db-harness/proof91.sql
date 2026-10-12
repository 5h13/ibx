-- Build 91 (agent portal) proof: run after the other proofs on the same database. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
select proof.set('fan', '40000000-0000-0000-0000-000000000003');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000031', 'agent.ikot@test'), ('00000000-0000-0000-0000-000000000032', 'agent.rocky@test');
insert into users(id, email, full_name, role, business_id) values
 ('00000000-0000-0000-0000-000000000031', 'agent.ikot@test', 'Ikot', 'agent', proof.get('pili')::uuid),
 ('00000000-0000-0000-0000-000000000032', 'agent.rocky@test', 'Rocky', 'agent', proof.get('pili')::uuid);

\echo == A. agent login
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
select proof.set('ag', public.sales_agent_save(null, '{"name":"Ikot91"}')::text);
select proof.set('ag2', public.sales_agent_save(null, '{"name":"Rocky91"}')::text);
select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000031');
select public.sales_agent_link_user(proof.get('ag2')::uuid, '00000000-0000-0000-0000-000000000032');
select proof.fails($$select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000013')$$, 'already has a login', 'an agent record already linked cannot take a second login (Build 106: staff may be linked to a free agent record)');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.sales_agent_link_user(proof.get('ag')::uuid, '00000000-0000-0000-0000-000000000031')$$, 'Business Admin', 'a cashier cannot link logins');
select proof.fails($$select * from public.agent_clients()$$, 'for agents', 'a cashier cannot open the agent screens');
select proof.as_user('00000000-0000-0000-0000-000000000031');   -- agent Ikot
select proof.ok(public.current_agent_id() = proof.get('ag')::uuid, 'the agent login is linked to its agent record');
select proof.ok((select count(*) from public.agent_stores()) >= 2, 'the agent sells for every store (store picker)');
select proof.ok(not public.has_function('sales.counter'), 'the agent holds no Sales function (no department access)');

\echo == B. clients and tiers
select proof.set('c', public.agent_add_client(proof.get('pili')::uuid, 'Proof91 Client', '0917')::text);
select proof.ok(exists (select 1 from public.agent_clients(proof.get('pili')::uuid) x where x.customer_id = proof.get('c')::uuid), 'a client the agent adds is assigned to him (in his list)');
select proof.ok((select count(*) from public.agent_clients(proof.get('aton')::uuid)) = 0, 'he sees no clients in a store where he has none');
select public.agent_set_client_tier(proof.get('c')::uuid, 3);
select proof.ok(public.tier_price(proof.get('pili')::uuid, 2, 2500, 1200, 1284) = 2300 and public.tier_price(proof.get('pili')::uuid, 3, 2500, 1200, 1284) = 2100
                and public.tier_price(proof.get('pili')::uuid, 4, 2500, 1200, 1284) = 1900, 'owner''s example: ₱2,500 / cost ₱1,200 → Tier 2 ₱2,300, Tier 3 ₱2,100, Tier 4 ₱1,900');
select proof.ok(public.tier_price(proof.get('pili')::uuid, 4, 1100, 1000, 1070) = 1070, 'a thin-markup item stops at the floor');
select proof.set('row', (select to_jsonb(x) from public.agent_catalog(proof.get('pili')::uuid, proof.get('c')::uuid, 'Fan Motor') x limit 1)::text);
select proof.ok((proof.get('row')::jsonb->>'client_tier')::int = 3 and (proof.get('row')::jsonb->>'client_price')::numeric = (proof.get('row')::jsonb->>'tier3')::numeric, 'catalogue: the client price is the client''s tier price');
select proof.ok((proof.get('row')::jsonb->>'acquisition_cost')::numeric > 0 and (proof.get('row')::jsonb->>'markup_percent') is not null, 'catalogue shows cost and markup to the agent');

\echo == C. orders to the store
select proof.as_user('00000000-0000-0000-0000-000000000032');   -- Rocky
select proof.fails($$select public.agent_set_client_tier(proof.get('c')::uuid, 1)$$, 'not assigned to you', 'another agent cannot touch the client');
select proof.as_user('00000000-0000-0000-0000-000000000031');
select proof.fails(format($$select public.agent_order_save('{"business_id":"%s","customer_id":"%s","lines":[{"item_id":"%s","quantity":1,"unit_price":1}]}')$$, proof.get('pili'), proof.get('c'), proof.get('fan')),
                   'lowest price', 'the agent cannot go below Tier 4');
select proof.set('o', public.agent_order_save(format('{"business_id":"%s","customer_id":"%s","lines":[{"item_id":"%s","quantity":2,"tier":4}]}', proof.get('pili'), proof.get('c'), proof.get('fan'))::jsonb)::text);
select proof.ok((select unit_price from agent_order_lines where order_id = proof.get('o')::uuid) is null, 'agents cannot read the order tables directly');
reset role; select proof.as_owner();
select proof.ok((select unit_price from agent_order_lines where order_id = proof.get('o')::uuid) = (proof.get('row')::jsonb->>'tier4')::numeric, 'a Tier 4 line is priced at Tier 4');
select proof.as_user('00000000-0000-0000-0000-000000000031');
select public.agent_order_set_status(proof.get('o')::uuid, 'sent');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.ok(exists (select 1 from jsonb_array_elements(public.storefront_agent_orders()) x where x->>'id' = proof.get('o')), 'the sent order shows on the storefront');
select public.storefront_agent_order_return(proof.get('o')::uuid, 'Out of stock, change the item');
select proof.as_user('00000000-0000-0000-0000-000000000031');
select proof.ok((select x->>'status' = 'draft' and x->>'store_note' like 'Out of stock%' from jsonb_array_elements(public.agent_orders_list()) x where x->>'id' = proof.get('o')), 'the store can return it to the agent with a note');
select public.agent_order_set_status(proof.get('o')::uuid, 'sent');
reset role; select proof.as_owner();
insert into storefront_sales(id, business_id, sale_number, sale_date, status, customer_id, location_id, total, subtotal)
select '00000000-0000-0000-0000-0000000e0091', proof.get('pili')::uuid, 'PILI-T91-1', current_date, 'pending_approval', proof.get('c')::uuid, location_id, 100, 100 from storefront_settings where business_id = proof.get('pili')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000013');
select public.storefront_agent_order_done(proof.get('o')::uuid, '00000000-0000-0000-0000-0000000e0091');
reset role; select proof.as_owner();
select proof.ok((select status = 'completed' and sale_id is not null from agent_orders where id = proof.get('o')::uuid), 'the cashier''s sale completes the agent order');
select proof.ok((select agent_id from storefront_sales where id = '00000000-0000-0000-0000-0000000e0091') = proof.get('ag')::uuid, 'the sale carries the agent (from the client)');

\echo == D. payment reports confirmed at the counter
insert into finance_customer_invoices(id, business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, status, notes) values
 ('00000000-0000-0000-0000-0000000a0911', proof.get('pili')::uuid, 'T91-DR1', proof.get('c')::uuid, current_date - 20, current_date - 5, 1000, 'approved', 'proof91'),
 ('00000000-0000-0000-0000-0000000a0912', proof.get('pili')::uuid, 'T91-DR2', proof.get('c')::uuid, current_date - 10, current_date + 5, 2000, 'approved', 'proof91');
select proof.as_user('00000000-0000-0000-0000-000000000031');
select proof.ok((select count(*) from public.agent_open_invoices(proof.get('c')::uuid)) = 2, 'the agent sees the client''s open DRs');
select proof.fails(format($$select public.agent_payment_report('{"customer_id":"%s","method":"cash","paid_on":"%s","allocations":[{"invoice_id":"00000000-0000-0000-0000-0000000a0911","amount":1500}]}')$$, proof.get('c'), current_date),
                   'more than what is left', 'cannot report more than a DR''s balance');
select proof.set('pr', public.agent_payment_report(format('{"customer_id":"%s","method":"check","reference":"CHK-T91","check_bank":"BDO","check_date":"%s","paid_on":"%s","allocations":[{"invoice_id":"00000000-0000-0000-0000-0000000a0911","amount":1000},{"invoice_id":"00000000-0000-0000-0000-0000000a0912","amount":500}]}', proof.get('c'), current_date, current_date)::jsonb)::text);
select proof.fails(format($$select public.agent_payment_report('{"customer_id":"%s","method":"cash","paid_on":"%s","allocations":[{"invoice_id":"00000000-0000-0000-0000-0000000a0911","amount":1}]}')$$, proof.get('c'), current_date),
                   'other reported payments', 'a DR already reported in full cannot be reported again');
reset role; select proof.as_owner();
select proof.ok((select balance_due from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0911') = 1000, 'nothing is posted until the cashier confirms');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select public.storefront_confirm_agent_payment(proof.get('pr')::uuid, '{"method":"check","reference":"CHK-T91","check_bank":"BDO","check_date":"2026-01-01"}'::jsonb);
reset role; select proof.as_owner();
select proof.ok((select status::text from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0911') = 'paid'
                and (select balance_due from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0912') = 1500, 'confirmed: DR1 paid, DR2 down to ₱1,500');
select proof.ok((select count(*) from storefront_checks where check_number = 'CHK-T91') = 1 and (select amount from storefront_checks where check_number = 'CHK-T91') = 1500, 'one check record for the whole ₱1,500');
select proof.ok((select status from agent_payment_reports where id = proof.get('pr')::uuid) = 'confirmed', 'the report is marked confirmed');
select proof.as_user('00000000-0000-0000-0000-000000000031');
select proof.set('pr2', public.agent_payment_report(format('{"customer_id":"%s","method":"gcash","reference":"GC-91","paid_on":"%s","allocations":[{"invoice_id":"00000000-0000-0000-0000-0000000a0912","amount":200}]}', proof.get('c'), current_date)::jsonb)::text);
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.storefront_reject_agent_payment(proof.get('pr2')::uuid, '')$$, 'why', 'rejecting needs a reason');
select public.storefront_reject_agent_payment(proof.get('pr2')::uuid, 'Not in our GCash');
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- ATON cashier
select proof.ok(not exists (select 1 from jsonb_array_elements(public.storefront_agent_payments()) x where x->>'id' = proof.get('pr')), 'another store does not see PILI agent payments');

\echo == E. client statement
select proof.as_user('00000000-0000-0000-0000-000000000031');
select proof.ok((public.agent_customer_statement(proof.get('c')::uuid)->'customer'->>'name') = 'Proof91 Client', 'the agent opens his client''s statement');
select proof.as_user('00000000-0000-0000-0000-000000000032');
select proof.fails($$select public.agent_customer_statement(proof.get('c')::uuid)$$, 'not assigned', 'another agent cannot');

\echo == F. agent expenses and allowances
reset role; select proof.as_owner();
select proof.set('meals', (select id::text from admin_expense_categories where code = 'meals'));
select proof.set('transpo', (select id::text from admin_expense_categories where code = 'transportation'));
select proof.as_user('00000000-0000-0000-0000-000000000011');
insert into expense_allowances(business_id, agent_id, category_id, monthly_limit) values (proof.get('pili')::uuid, proof.get('ag')::uuid, proof.get('meals')::uuid, 500);
select proof.as_user('00000000-0000-0000-0000-000000000031');
select proof.fails(format($$select public.agent_expense_submit('{"business_id":"%s","category_id":"%s","amount":300,"expense_date":"%s","description":"Taxi"}')$$, proof.get('pili'), proof.get('transpo'), current_date),
                   'photo', 'a receipt photo is required');
select proof.set('e1', public.agent_expense_submit(format('{"business_id":"%s","category_id":"%s","amount":400,"expense_date":"%s","description":"Lunch with client"}', proof.get('pili'), proof.get('meals'), current_date)::jsonb)::text);
select proof.set('e2', public.agent_expense_submit(format('{"business_id":"%s","category_id":"%s","amount":300,"expense_date":"%s","description":"Dinner"}', proof.get('pili'), proof.get('meals'), current_date)::jsonb)::text);
select proof.set('e3', public.agent_expense_submit(format('{"business_id":"%s","category_id":"%s","amount":250,"expense_date":"%s","description":"Taxi","photo_path":"x/taxi.jpg"}', proof.get('pili'), proof.get('transpo'), current_date)::jsonb)::text);
select proof.ok((select x->>'no_receipt' = 'true' and (x->>'over_allowance')::numeric = 0 from jsonb_array_elements(public.agent_expenses_list()) x where x->>'id' = proof.get('e1')), 'meals can be filed without a photo (marked no receipt)');
select proof.ok((select (x->>'over_allowance')::numeric from jsonb_array_elements(public.agent_expenses_list()) x where x->>'id' = proof.get('e2')) = 200, 'the second meal is flagged ₱200 over the ₱500 allowance');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.agent_expense_decide(proof.get('e1')::uuid, true)$$, 'Business Admin', 'a cashier cannot approve agent expenses');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('x', public.agent_expense_decide(proof.get('e2')::uuid, true)::text);
select proof.fails($$select public.agent_expense_decide(proof.get('e3')::uuid, false, '')$$, 'why', 'a rejection needs a reason');
reset role; select proof.as_owner();
select proof.ok((select status::text = 'approved' and amount = 300 and notes like '%Over allowance by ₱200%' from expenses where id = proof.get('x')::uuid), 'approved: an approved Sales expense for Finance to pay, noting the overage');

\echo == G. employee allowances
insert into expense_allowances(business_id, user_id, category_id, monthly_limit) values (proof.get('pili')::uuid, '00000000-0000-0000-0000-000000000013', proof.get('transpo')::uuid, 100);
insert into expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id, prepared_by)
select (select id from sections where code = 'sales'), (select month_id from expenses where id = proof.get('x')::uuid), proof.get('pili')::uuid, d, a, 'draft', current_date, proof.get('transpo')::uuid, '00000000-0000-0000-0000-000000000013'
  from (values ('Proof91 jeep', 80::numeric), ('Proof91 tricycle', 50::numeric)) v(d, a);
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok((select max(over_by) from public.expense_allowance_flags(array(select id from expenses where description like 'Proof91 %'))) = 30, 'an employee ₱30 over a ₱100 allowance is flagged');

\echo == H. tier settings
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.sales_price_tiers_save(proof.get('pili')::uuid, 10, 20, 30)$$, 'Business Admin', 'a cashier cannot change the tiers');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.sales_price_tiers_save(proof.get('pili')::uuid, 30, 20, 10)$$, 'go up', 'tiers must go up');
select public.sales_price_tiers_save(proof.get('pili')::uuid, 10, 20, 30);
select proof.ok(public.tier_price(proof.get('pili')::uuid, 4, 2500, 1200, 1284) = 2110, 'new Tier 4 share (30% of ₱1,300 markup) → ₱2,110');
select proof.ok(public.tier_price(proof.get('aton')::uuid, 4, 2500, 1200, 1284) = 1900, 'other stores keep their own tiers');

rollback;
