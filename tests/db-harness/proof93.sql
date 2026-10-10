-- Build 93 (online agents, savings, expense deduction, Back Office Commission) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('lm', (date_trunc('month', (now() at time zone 'Asia/Manila')::date) - interval '1 month')::date::text);
select proof.set('loc', (select location_id::text from storefront_settings where business_id = proof.get('pili')::uuid));
select proof.set('store', public.sales_agent_store(proof.get('pili')::uuid)::text);
-- PILI set up like ISHABELLA's workbook
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.agent_commission_settings_save(proof.get('pili')::uuid, jsonb_build_object('default_rate', 20, 'max_rate', 30, 'start_date', proof.get('lm'),
  'brackets', '[{"min_paid":0,"points":0},{"min_paid":200000.01,"points":10}]'::jsonb));
select public.agent_commission_options_save(proof.get('pili')::uuid, 20, 5, true);
select proof.set('rod', public.sales_agent_save(null, '{"name":"Rod93"}')::text);
select proof.set('jen', public.sales_agent_save(null, '{"name":"Jen93 - Online"}')::text);
select public.sales_agent_set_online(proof.get('jen')::uuid, true);
select proof.fails($$select public.sales_agent_set_online(proof.get('store')::uuid, true)$$, 'freelance', 'the Store agent cannot be online');
reset role; select proof.as_owner();
insert into finance_customers(id, business_id, customer_code, legal_name, active, agent_id) values
 ('00000000-0000-0000-0000-0000000c0931', proof.get('pili')::uuid, 'CUS-PILI-T931', 'Proof93 Rod client', true, proof.get('rod')::uuid),
 ('00000000-0000-0000-0000-0000000c0932', proof.get('pili')::uuid, 'CUS-PILI-T932', 'Proof93 Jen client', true, proof.get('jen')::uuid),
 ('00000000-0000-0000-0000-0000000c0933', proof.get('pili')::uuid, 'CUS-PILI-T933', 'Proof93 store client', true, proof.get('store')::uuid);
-- last month: Rod ₱300,000 (cost ₱250,000), Jen ₱10,000 (cost ₱7,000), store ₱2,000,000 refrigerant (cost ₱1,600,000); all paid that month
insert into storefront_sales(id, business_id, sale_number, sale_date, status, customer_id, location_id, subtotal, total)
select x.id::uuid, proof.get('pili')::uuid, x.n, proof.get('lm')::date + 9, 'completed', x.c::uuid, proof.get('loc')::uuid, x.t, x.t
  from (values ('00000000-0000-0000-0000-000000093001', 'T93-1', '00000000-0000-0000-0000-0000000c0931', 300000::numeric),
               ('00000000-0000-0000-0000-000000093002', 'T93-2', '00000000-0000-0000-0000-0000000c0932', 10000::numeric),
               ('00000000-0000-0000-0000-000000093003', 'T93-3', '00000000-0000-0000-0000-0000000c0933', 2000000::numeric)) x(id, n, c, t);
insert into storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, line_total, acquisition_cost) values
 (proof.get('pili')::uuid, '00000000-0000-0000-0000-000000093001', '40000000-0000-0000-0000-000000000003', 'FAN', 'Fan Motor', 'lot', 'product', 1, 300000, 300000, 300000, 250000),
 (proof.get('pili')::uuid, '00000000-0000-0000-0000-000000093002', '40000000-0000-0000-0000-000000000003', 'FAN', 'Fan Motor', 'lot', 'product', 1, 10000, 10000, 10000, 7000),
 (proof.get('pili')::uuid, '00000000-0000-0000-0000-000000093003', '40000000-0000-0000-0000-000000000002', 'R32', 'R32 Refrigerant', 'lot', 'product', 1, 2000000, 2000000, 2000000, 1600000);
insert into storefront_payments(business_id, payment_number, sale_id, method, amount, kind, received_at)
select proof.get('pili')::uuid, 'T93-P' || n, s::uuid, 'cash', a, 'sale', ((proof.get('lm')::date + 9)::timestamp + interval '11 hours') at time zone 'Asia/Manila'
  from (values (1, '00000000-0000-0000-0000-000000093001', 300000::numeric), (2, '00000000-0000-0000-0000-000000093002', 10000::numeric), (3, '00000000-0000-0000-0000-000000093003', 2000000::numeric)) x(n, s, a);
insert into agent_expenses(business_id, expense_number, agent_id, expense_date, category_id, amount, description, status) values
 (proof.get('pili')::uuid, 'T93-E1', proof.get('rod')::uuid, proof.get('lm')::date + 5, (select id from admin_expense_categories where code = 'transportation'), 2000, 'Trip', 'approved'),
 (proof.get('pili')::uuid, 'T93-E2', proof.get('jen')::uuid, proof.get('lm')::date + 5, (select id from admin_expense_categories where code = 'transportation'), 500, 'Load', 'approved');
-- the month's operating expense
insert into months(business_id, year, month, label)
select proof.get('pili')::uuid, extract(year from proof.get('lm')::date), extract(month from proof.get('lm')::date), 'x'
where not exists (select 1 from months where business_id = proof.get('pili')::uuid and year = extract(year from proof.get('lm')::date) and month = extract(month from proof.get('lm')::date));
insert into expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id)
select (select id from sections where code = 'admin'), m.id, proof.get('pili')::uuid, 'Proof93 rent', 100000, 'posted', proof.get('lm')::date + 1, (select id from admin_expense_categories where code = 'rent')
  from months m where m.business_id = proof.get('pili')::uuid and m.year = extract(year from proof.get('lm')::date) and m.month = extract(month from proof.get('lm')::date)
   and not exists (select 1 from expenses where description = 'Proof93 rent');
insert into employees(id, business_id, employee_no, first_name, last_name, employment_status) values
 ('00000000-0000-0000-0000-0000000e9301', proof.get('pili')::uuid, 'T93-1', 'Bert', 'Manager', 'active'),
 ('00000000-0000-0000-0000-0000000e9302', proof.get('pili')::uuid, 'T93-2', 'Riza', 'Sales', 'active'),
 ('00000000-0000-0000-0000-0000000e9303', proof.get('pili')::uuid, 'T93-3', 'Shiena', 'Purchasing', 'active');

\echo == A. agents: high rate above ₱200,000, online flat rate, expenses deducted, savings
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.set('r', public.agent_commission_statement(proof.get('rod')::uuid, proof.get('lm')::date)::text);
select proof.ok((proof.get('r')::jsonb->>'earned')::numeric = 15000, 'direct agent above ₱200,000: ₱50,000 markup × 30% = ₱15,000');
select proof.ok((proof.get('r')::jsonb->>'expense_deduction')::numeric = 2000 and (proof.get('r')::jsonb->>'savings')::numeric = 650, 'his ₱2,000 expenses are deducted; savings 5% × ₱13,000 = ₱650');
select proof.ok((proof.get('r')::jsonb->>'payable')::numeric = 12350, 'payable ₱15,000 − ₱2,000 − ₱650 = ₱12,350');
select proof.set('j', public.agent_commission_statement(proof.get('jen')::uuid, proof.get('lm')::date)::text);
select proof.ok((proof.get('j')::jsonb->>'earned')::numeric = 600 and (proof.get('j')::jsonb->>'savings')::numeric = 0 and (proof.get('j')::jsonb->>'payable')::numeric = 100,
                'online agent: ₱3,000 × 20% flat = ₱600, no savings, − ₱500 expenses = ₱100');

\echo == B. back office set-up and figures
select public.bo_commission_setup_save(jsonb_build_object(
  'category_rates', '[{"category":"Parts","rate":1},{"category":"Refrigerant","rate":0.5}]'::jsonb,
  'plans', jsonb_build_array(
    jsonb_build_object('kind', 'manager', 'label', 'Manager', 'members', jsonb_build_array('00000000-0000-0000-0000-0000000e9301'), 'sort', 1),
    jsonb_build_object('kind', 'sales_staff', 'label', 'Sales staff', 'rate', 0.5, 'members', jsonb_build_array('00000000-0000-0000-0000-0000000e9302'), 'sort', 2),
    jsonb_build_object('kind', 'department', 'label', 'Admin', 'rate', 1, 'members', jsonb_build_array('00000000-0000-0000-0000-0000000e9302', '00000000-0000-0000-0000-0000000e9303'), 'sort', 4))));
select proof.set('bo', public.bo_commission_month(proof.get('lm')::date)::text);
select proof.ok((proof.get('bo')::jsonb->>'store_paid_gross')::numeric = 2000000, 'store gross (paid) = the store''s own sales collected: ₱2,000,000');
select proof.ok((proof.get('bo')::jsonb->>'agent_commission')::numeric = 15600, 'total agent commission ₱15,600 (before expenses / savings)');
select proof.ok((proof.get('bo')::jsonb->>'operating_net_income')::numeric = (proof.get('bo')::jsonb->>'net_sales')::numeric - (proof.get('bo')::jsonb->>'monthly_expenses')::numeric, 'bottomline = net sales − monthly expenses');
-- Build 97h: the agent share plan is gone; a store agent's (% of gross) sales count as the store's own sales
select proof.fails(format($$select public.bo_commission_setup_save('{"plans":[{"kind":"agent_share","label":"Rod share","rate":1,"agent_id":"%s"}]}')$$, proof.get('rod')), 'was removed', 'the agent share plan can no longer be added');
select public.sales_agent_commission_setup(proof.get('rod')::uuid, '{"commission_basis":"gross","commission_rate":1}');
select proof.ok((public.bo_commission_month(proof.get('lm')::date)->>'store_paid_gross')::numeric = 2300000, 'with Rod as a store agent, store gross (paid) = ₱2,000,000 + his ₱300,000');
select public.sales_agent_commission_setup(proof.get('rod')::uuid, '{"commission_basis":"markup"}');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'plans') x where x->>'kind' = 'sales_staff')
                = round(greatest(2000000 - (proof.get('bo')::jsonb->>'monthly_expenses')::numeric * 2000000 / (proof.get('bo')::jsonb->>'overall_gross')::numeric, 0) * 0.005, 2),
                'sales staff: (store gross − expenses × store share) × 0.5%');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'plans') x where x->>'kind' = 'manager')
                = (select sum((c->>'commission')::numeric) from jsonb_array_elements(proof.get('bo')::jsonb->'categories') c), 'manager = the sum of the category commissions');
select proof.ok((select round((c->>'basis')::numeric * 0.01, 2) = (c->>'commission')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'categories') c where c->>'category' = 'parts'), 'parts at 1% of (gross − allocated pool)');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'plans') x where x->>'kind' = 'department')
                = case when (proof.get('bo')::jsonb->>'bottomline_before')::numeric > 300000 then round((proof.get('bo')::jsonb->>'bottomline_before')::numeric * 0.01, 2) else 0 end,
                'department pool: 1% of bottomline when over ₱300,000');
select proof.ok((proof.get('bo')::jsonb->>'tithes')::numeric = round(greatest((proof.get('bo')::jsonb->>'true_bottomline')::numeric, 0) * 0.10, 2)
                and (proof.get('bo')::jsonb->>'offering')::numeric = (proof.get('bo')::jsonb->>'tithes')::numeric, 'tithes 10% of the true bottomline; offering = tithes');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'payouts') x where x->>'name' like 'Riza%')
                = (select (x->>'amount')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'plans') x where x->>'kind' = 'sales_staff')
                + round((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('bo')::jsonb->'plans') x where x->>'kind' = 'department') / 2, 2), 'Riza gets sales staff + half of the Admin pool');

\echo == C. closing
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.bo_commission_month(current_date)$$, 'Business Admin, Finance', 'a cashier cannot see back office commission');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.bo_commission_close(proof.get('lm')::date)$$, 'Close the agents', 'agents are closed first');
select public.agent_commission_close(proof.get('rod')::uuid, proof.get('lm')::date);
select public.agent_commission_close(proof.get('jen')::uuid, proof.get('lm')::date);
select proof.ok(public.agent_commission_overview(proof.get('lm')::date)->'agents' @> jsonb_build_array(jsonb_build_object('agent', 'Rod93', 'savings_balance', 650)), 'Rod''s savings balance is ₱650');
select proof.fails($$select public.agent_savings_release(proof.get('rod')::uuid, 700)$$, 'Only ₱650', 'cannot release more than saved');
select proof.set('rel', public.agent_savings_release(proof.get('rod')::uuid, 650, 'Year-end release')::text);
select public.bo_commission_close(proof.get('lm')::date);
select proof.fails($$select public.bo_commission_close(proof.get('lm')::date)$$, 'already closed', 'a month closes once');
reset role; select proof.as_owner();
select proof.ok((select amount from expenses where id = proof.get('rel')::uuid) = 650 and (select sum(amount) from agent_savings where agent_id = proof.get('rod')::uuid) = 0, 'released savings: ₱650 expense, balance ₱0');
select proof.ok((select count(*) from bo_commission_payouts o join bo_commission_periods p on p.id = o.period_id where p.business_id = proof.get('pili')::uuid and o.expense_id is not null) >= 2,
                'closing raises an approved Commission expense per person');
select proof.ok((select payable from agent_commission_periods where agent_id = proof.get('rod')::uuid) = 12350, 'Rod''s closed month: ₱12,350 payable');

rollback;
