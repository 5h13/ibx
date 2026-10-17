-- Build 127 (Sales Manager app) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('cool', (select id::text from finance_customers where legal_name = 'Cool Contractors' or trade_name = 'Cool Contractors' limit 1));
select proof.set('y', extract(year from (now() at time zone 'Asia/Manila'))::text);
select proof.set('m', extract(month from (now() at time zone 'Asia/Manila'))::text);

-- access
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.manager_today()$$, 'Sales approvers', 'a cashier cannot open the manager app');
select proof.as_user('00000000-0000-0000-0000-000000000014');   -- P.Approver (sales approver)
select proof.ok(public.manager_access(), 'a Sales approver can open it');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- Business Admin
select proof.ok(public.manager_access(), 'the Business Admin can open it');

-- the month adds up: completed sales less returns, and the breakdowns add up to the total
select proof.ok((public.manager_month(proof.get('y')::int, proof.get('m')::int)->>'total')::numeric
  = (select round(coalesce(sum(total), 0), 2) from storefront_sales where business_id = proof.get('pili')::uuid and status = 'completed' and sale_date >= date_trunc('month', (now() at time zone 'Asia/Manila'))::date and sale_date <= (now() at time zone 'Asia/Manila')::date)
  - (select round(coalesce(sum(total), 0), 2) from storefront_returns where business_id = proof.get('pili')::uuid and return_date >= date_trunc('month', (now() at time zone 'Asia/Manila'))::date),
  'month total = completed sales less returns');
select proof.ok((select abs(sum((x->>'total')::numeric) - (public.manager_month(proof.get('y')::int, proof.get('m')::int)->>'total')::numeric) < 0.05 from jsonb_array_elements(public.manager_month(proof.get('y')::int, proof.get('m')::int)->'by_category') x), 'categories add up to the total');
select proof.ok((select abs(sum((x->>'total')::numeric) - (public.manager_month(proof.get('y')::int, proof.get('m')::int)->>'total')::numeric) < 0.05 from jsonb_array_elements(public.manager_month(proof.get('y')::int, proof.get('m')::int)->'by_channel') x), 'channels add up to the total');
select proof.ok(not exists (select 1 from jsonb_array_elements(public.manager_month(proof.get('y')::int, proof.get('m')::int)->'by_channel') x where x->>'name' = 'Agents'), 'sales under the store''s own house agent count as Counter, not Agents');
select proof.ok((select count(*) from jsonb_array_elements(public.manager_team(proof.get('y')::int, proof.get('m')::int)) x where x->>'kind' = 'Counter' and x->>'user_id' = '00000000-0000-0000-0000-000000000013') = 1, 'the cashier who rang the sales appears under Team');

-- targets
select proof.ok((public.manager_month(proof.get('y')::int, proof.get('m')::int)->>'target') is null, 'no target set yet');
select public.manager_set_target(proof.get('y')::int, proof.get('m')::int, null, '00000000-0000-0000-0000-000000000013', 50000, 'Proof note');
select proof.ok((public.manager_month(proof.get('y')::int, proof.get('m')::int)->>'target')::numeric = 50000, 'without a store target, the people''s targets add up to it');
select public.manager_set_target(proof.get('y')::int, proof.get('m')::int, null, null, 120000, null);
select public.manager_set_target(proof.get('y')::int, proof.get('m')::int, null, null, 150000, null);
select proof.ok((public.manager_month(proof.get('y')::int, proof.get('m')::int)->>'target')::numeric = 150000, 'a store target set twice keeps the last');
select proof.ok((select (x->>'target')::numeric from jsonb_array_elements(public.manager_team(proof.get('y')::int, proof.get('m')::int)) x where x->>'user_id' = '00000000-0000-0000-0000-000000000013') = 50000, 'the cashier''s own target shows on Team');
select proof.fails($$select public.manager_set_target(2026, 10, null, null, -1, null)$$, '₱0 or more', 'a negative target is refused');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.manager_set_target(2026, 10, null, null, 1, null)$$, 'sets targets', 'a cashier cannot set targets');

-- approvals: a quotation with a line below the floor, and an overdue invoice
select proof.as_owner();
insert into sales_quotations(id, business_id, quotation_number, customer_id, quotation_date, status, subtotal)
values ('00000000-0000-0000-0000-0000012700a1', proof.get('pili')::uuid, 'QT-T127', proof.get('cool')::uuid, current_date, 'prepared', 1000);
insert into sales_quotation_items(business_id, quotation_id, description, quantity, unit, unit_price, floor_price, below_floor, pricing_acquisition_cost)
values (proof.get('pili')::uuid, '00000000-0000-0000-0000-0000012700a1', 'Compressor T', 1, 'pc', 1000, 1070, true, 980);
insert into finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, amount_received, status)
values (proof.get('pili')::uuid, 'INV-T127', proof.get('cool')::uuid, current_date - 60, current_date - 30, 5000, 0, 'approved');
select proof.as_user('00000000-0000-0000-0000-000000000014');
select proof.ok((select x->>'flag' from jsonb_array_elements(public.manager_approvals()) x where x->>'id' = '00000000-0000-0000-0000-0000012700a1') = '1 line(s) below the floor', 'the quotation waits with its below-floor flag');
select proof.ok((public.manager_today()->'approvals'->>'quotes')::int >= 1, 'Today counts it');
select proof.ok((public.manager_quote('00000000-0000-0000-0000-0000012700a1')->'lines'->0->>'margin')::numeric = 2.0, 'quote review: line margin 2% (₱1,000 vs cost ₱980)');
select proof.ok((public.manager_collections()->>'overdue')::numeric >= 5000, 'the overdue invoice shows in Collections');
select proof.ok((select (x->>'days')::int from jsonb_array_elements(public.manager_collections()->'clients') x where x->>'id' = proof.get('cool')) = 30, 'overdue by 30 days');

-- promises and the client page
select proof.fails(format($$select public.manager_log_promise(%L, current_date - 1, 100, 'x')$$, proof.get('cool')), 'today or later', 'a promise date in the past is refused');
select proof.fails(format($$select public.manager_log_promise(%L, current_date + 3, 0, 'x')$$, proof.get('cool')), 'promised amount', 'a promise needs an amount');
select public.manager_log_promise(proof.get('cool')::uuid, current_date + 3, 2500, 'Friday, by GCash');
select proof.ok((select (x->'promise'->>'amount')::numeric from jsonb_array_elements(public.manager_collections()->'clients') x where x->>'id' = proof.get('cool')) = 2500, 'the promise shows against the client');
select proof.ok((public.manager_client(proof.get('cool')::uuid)->'ar'->>'overdue')::numeric = 5000, 'client page: overdue ₱5,000');
select proof.ok(jsonb_array_length(public.manager_client(proof.get('cool')::uuid)->'months') = 6, 'client page: six months of purchases');
select proof.ok((public.manager_client(proof.get('cool')::uuid)->'open_quotes'->0->>'id') = '00000000-0000-0000-0000-0000012700a1', 'client page: the open quotation');
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- ATON cashier
select proof.fails(format($$select public.manager_client(%L)$$, proof.get('cool')), 'Sales approvers', 'another store''s user cannot see the client');
rollback;
