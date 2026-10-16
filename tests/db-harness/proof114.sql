-- Build 114 (order DR window: waiting reason, switch a supplier line to stock) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
insert into finance_customers(id, business_id, customer_code, legal_name, active, agent_id)
values ('00000000-0000-0000-0000-0000011400c1', proof.get('pili')::uuid, 'CUS-T114', 'DR Test Client', true, public.sales_agent_store(proof.get('pili')::uuid));
insert into sales_orders(id, business_id, order_number, customer_id, status, prepared_by)
values ('00000000-0000-0000-0000-0000011400d1', proof.get('pili')::uuid, 'x', '00000000-0000-0000-0000-0000011400c1', 'reviewed', '00000000-0000-0000-0000-000000000013');
insert into sales_order_items(id, business_id, order_id, catalog_item_id, description, quantity, unit, unit_price, fulfilment, estimated_unit_cost) values
 ('00000000-0000-0000-0000-0000011400e1', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011400d1', '40000000-0000-0000-0000-000000000001', 'Capacitor 35uF', 2, 'pc', 60, 'source', 40),
 ('00000000-0000-0000-0000-0000011400e2', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011400d1', '40000000-0000-0000-0000-000000000003', 'Fan Motor', 1, 'pc', 700, 'source', 500);
update sales_orders set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000014' where id = '00000000-0000-0000-0000-0000011400d1';
select proof.set('pr', (select purchase_requisition_id::text from sales_orders where id = '00000000-0000-0000-0000-0000011400d1'));
select proof.ok(proof.get('pr') is not null and (select count(*) from purchase_requisition_items where requisition_id = proof.get('pr')::uuid) = 2, 'approval released a PR with both supplier lines');

-- the DR window data says what each line waits for
select proof.as_user('00000000-0000-0000-0000-000000000014');
create temp table o as select x from jsonb_array_elements(public.storefront_orders(false)) x where x->>'id' = '00000000-0000-0000-0000-0000011400d1';
select proof.ok((select x->>'pr_status' from o) = 'approved' and (select x->>'pr_fulfilment' from o) = 'awaiting_po', 'the order shows its PR as approved, awaiting PO');
select proof.ok((select bool_and((l->>'pr_line')::boolean and l->'po' = 'null'::jsonb) from o, jsonb_array_elements(x->'lines') l), 'each line shows it is on the PR with no PO yet');

-- a cashier cannot switch; a reason is required
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.storefront_order_line_to_stock('00000000-0000-0000-0000-0000011400e1', 'on hand')$$, 'Only a Sales approver', 'a cashier cannot switch a line');
select proof.as_user('00000000-0000-0000-0000-000000000014');
select proof.fails($$select public.storefront_order_line_to_stock('00000000-0000-0000-0000-0000011400e1', ' ')$$, 'Say why', 'a reason is required');

-- the Sales approver switches the capacitor to stock
select public.storefront_order_line_to_stock('00000000-0000-0000-0000-0000011400e1', 'Found 2 on the shelf');
select proof.as_owner();
select proof.ok((select fulfilment from sales_order_items where id = '00000000-0000-0000-0000-0000011400e1') = 'stock', 'the line is now from stock');
select proof.ok((select count(*) from purchase_requisition_items where requisition_id = proof.get('pr')::uuid) = 1, 'the line left the PR');
select proof.ok((select estimated_total from purchase_requisitions where id = proof.get('pr')::uuid) = 500, 'the PR estimate is recomputed');
select proof.ok(exists (select 1 from audit_log where entity_id = '00000000-0000-0000-0000-0000011400e1' and action = 'order_line_switched_to_stock' and detail->>'reason' = 'Found 2 on the shelf'), 'the switch is in the audit log with its reason');
select proof.as_user('00000000-0000-0000-0000-000000000014');
select proof.fails($$select public.storefront_order_line_to_stock('00000000-0000-0000-0000-0000011400e1', 'again')$$, 'already supplied from stock', 'a stock line cannot be switched again');

-- once a PO is made for a line, it can no longer be switched
select proof.as_owner();
insert into purchase_orders(id, business_id, requisition_id, supplier_id, order_date, status)
values ('00000000-0000-0000-0000-0000011400f1', proof.get('pili')::uuid, proof.get('pr')::uuid, '30000000-0000-0000-0000-000000000002', current_date, 'draft');
insert into purchase_order_items(business_id, purchase_order_id, source_requisition_item_id, item_id, description, quantity, unit, unit_cost)
select proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011400f1', id, item_id, description, quantity, unit, 500 from purchase_requisition_items where requisition_id = proof.get('pr')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000014');
select proof.ok((select l->'po'->>'po_number' from jsonb_array_elements(public.storefront_orders(false)) x, jsonb_array_elements(x->'lines') l
                 where l->>'id' = '00000000-0000-0000-0000-0000011400e2') is not null, 'the fan motor line shows its PO');
select proof.fails($$select public.storefront_order_line_to_stock('00000000-0000-0000-0000-0000011400e2', 'on hand')$$, 'purchase order was already made', 'a line with a PO cannot be switched');

-- a PR left with no lines is cancelled
select proof.as_owner();
delete from purchase_order_items where purchase_order_id = '00000000-0000-0000-0000-0000011400f1';
delete from purchase_orders where id = '00000000-0000-0000-0000-0000011400f1';
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.storefront_order_line_to_stock('00000000-0000-0000-0000-0000011400e2', 'All on hand');
select proof.as_owner();
select proof.ok((select fulfillment_status from purchase_requisitions where id = proof.get('pr')::uuid) = 'cancelled', 'the emptied PR is marked cancelled (Business Admin did the switch)');
rollback;
