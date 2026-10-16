-- Build 115 (quotation prices: engine price, editable price with floor, whole quantities, price history) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
insert into finance_customers(id, business_id, customer_code, legal_name, active, agent_id)
values ('00000000-0000-0000-0000-0000011500c1', proof.get('pili')::uuid, 'CUS-T115', 'Price Test Client', true, public.sales_agent_store(proof.get('pili')::uuid));

-- engine prices for the form = the save's price
select proof.as_user('00000000-0000-0000-0000-000000000013');
create temp table qp as select x from jsonb_array_elements(public.quote_price_lines('00000000-0000-0000-0000-0000011500c1', array['40000000-0000-0000-0000-000000000001']::uuid[])) x;
select proof.ok((select (x->>'price')::numeric from qp) = (select round(customer_price, 2) from public.get_catalog_sales_price('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000011500c1', null)), 'form price = pricing engine price');
select proof.ok((select (x->>'srp')::numeric = round(srp, 2) and (x->>'acquisition_cost')::numeric = round(acquisition_cost, 2) from qp, public.get_catalog_sales_price('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000011500c1', null)), 'SRP and acquisition cost as the engine computes them');
select proof.ok((select (x->>'floor')::numeric = round(least((x->>'srp')::numeric, (x->>'acquisition_cost')::numeric * 1.07), 2) from qp), 'floor = 7% over acquisition cost (never above SRP)');

-- whole quantities
select proof.as_owner();
insert into sales_quotations(id, business_id, customer_id, subtotal, created_by)
values ('00000000-0000-0000-0000-0000011500a1', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011500c1', 0, '00000000-0000-0000-0000-000000000013');
select proof.fails($$insert into sales_quotation_items(business_id, quotation_id, catalog_item_id, description, quantity, unit, unit_price)
  values ('$$ || proof.get('pili') || $$', '00000000-0000-0000-0000-0000011500a1', '40000000-0000-0000-0000-000000000001', 'Capacitor', 1.001, 'pc', 54.60)$$, 'whole numbers', 'a quantity of 1.001 is refused');

-- a line typed below the floor: only a Sales approver can approve the quotation
insert into sales_quotation_items(business_id, quotation_id, catalog_item_id, description, quantity, unit, unit_price, engine_unit_price, floor_price, price_overridden, below_floor)
values (proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011500a1', '40000000-0000-0000-0000-000000000001', 'Capacitor', 2, 'pc', 43.00, 54.60, 44.94, true, true);
update sales_quotations set status = 'reviewed', prepared_by = '00000000-0000-0000-0000-000000000013' where id = '00000000-0000-0000-0000-0000011500a1';
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$update sales_quotations set status = 'approved' where id = '00000000-0000-0000-0000-0000011500a1'$$, 'below the floor', 'a cashier cannot approve a below-floor quotation');
select proof.as_user('00000000-0000-0000-0000-000000000014');
update sales_quotations set status = 'approved' where id = '00000000-0000-0000-0000-0000011500a1';
select proof.as_owner();
select proof.ok((select status::text from sales_quotations where id = '00000000-0000-0000-0000-0000011500a1') = 'approved', 'the Sales approver approves it');

-- Single-operator: auto-approved with a warning on the record
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'single');
select proof.as_owner();
insert into sales_quotations(id, business_id, customer_id, subtotal, created_by)
values ('00000000-0000-0000-0000-0000011500a2', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011500c1', 0, '00000000-0000-0000-0000-000000000013');
insert into sales_quotation_items(business_id, quotation_id, catalog_item_id, description, quantity, unit, unit_price, engine_unit_price, floor_price, price_overridden, below_floor)
values (proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011500a2', '40000000-0000-0000-0000-000000000001', 'Capacitor', 1, 'pc', 40.00, 54.60, 44.94, true, true);
select proof.as_user('00000000-0000-0000-0000-000000000013');
update sales_quotations set status = 'prepared', prepared_by = auth.uid() where id = '00000000-0000-0000-0000-0000011500a2';
select proof.as_owner();
select proof.ok((select status::text from sales_quotations where id = '00000000-0000-0000-0000-0000011500a2') = 'approved', 'Single-operator: a below-floor quotation is auto-approved');
select proof.ok(exists (select 1 from audit_log where entity_id = '00000000-0000-0000-0000-0000011500a2' and action = 'price_exception_warned'), 'and the warning is kept on its record');

-- price history: Sales preparer sees all four parts; a Logistics user does not
insert into finance_item_cost_history(item_id, cost_field, previous_cost, new_cost, source, supplier_id, set_by, set_for_business_id, set_at)
values ('40000000-0000-0000-0000-000000000001', 'standard_cost', 35, 40, 'supplier_quote', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000015', proof.get('pili')::uuid, now() - interval '3 days');
select proof.as_user('00000000-0000-0000-0000-000000000013');
create temp table h as select public.item_price_history('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000011500c1') as d;
select proof.ok((select d ? 'srp_changes' and d ? 'cost_changes' and d ? 'purchases' and d ? 'customer' from h), 'the history has all four parts');
select proof.ok((select jsonb_array_length(d->'cost_changes') >= 1 and d->'cost_changes'->0->>'supplier' = 'Alpha Supply Co.' from h), 'cost changes show the supplier');
select proof.ok((select (d->'srp_changes'->0->>'srp')::numeric > 0 from h), 'SRP changes show the resulting SRP');
select proof.ok((select jsonb_array_length(d->'customer') >= 2 from h), 'this customer''s earlier quoted prices are listed');
select proof.as_user('00000000-0000-0000-0000-000000000016');
select proof.fails($$select public.item_price_history('40000000-0000-0000-0000-000000000001', null)$$, 'Sales or Finance access', 'a Logistics user cannot see price history');
rollback;
