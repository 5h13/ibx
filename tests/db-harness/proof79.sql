-- Build 79 proof: price and cost by lot (SF-31), order-only items (CAT-38),
-- delete unused deactivated items (CAT-37). Runs after proof78 on the same database.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
select proof.as_owner();

\warn '== N. Price and cost follow the lot (SF-31)'
-- item A: Refrigerant (add-on 0%), markup 20%, current cost 120; lots at 150 (Alpha, older) and 100 (Beta, newer) at the store
insert into finance_procurement_items(id, item_name, category, unit, standard_cost, item_type) values ('40000000-0000-0000-0000-000000000011', 'Compressor A', 'Refrigerant', 'pc', 120, 'product');
insert into finance_catalog_item_pricing(business_id, item_id, markup_percent) values (proof.get('PILI')::uuid, '40000000-0000-0000-0000-000000000011', 20);
select proof.set('inv_a', ensure_inventory_link('40000000-0000-0000-0000-000000000011', proof.get('PILI')::uuid)::text);
insert into logistics_receipts(id, business_id, supplier_id, location_id, receipt_date, status) values
 ('50000000-0000-0000-0000-000000000011', proof.get('PILI')::uuid, '30000000-0000-0000-0000-000000000001', proof.get('ST')::uuid, current_date - 10, 'approved'),
 ('50000000-0000-0000-0000-000000000012', proof.get('PILI')::uuid, '30000000-0000-0000-0000-000000000002', proof.get('ST')::uuid, current_date - 3, 'approved');
insert into logistics_receipt_items(id, receipt_id, business_id, inventory_item_id, quantity, unit_cost) values
 ('51000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000011', proof.get('PILI')::uuid, proof.get('inv_a')::uuid, 10, 150),
 ('51000000-0000-0000-0000-000000000012', '50000000-0000-0000-0000-000000000012', proof.get('PILI')::uuid, proof.get('inv_a')::uuid, 5, 100);
select proof.as_user(proof.get('LOG')::uuid);
select post_receipt_to_stock('50000000-0000-0000-0000-000000000011', proof.get('LOG')::uuid);
select post_receipt_to_stock('50000000-0000-0000-0000-000000000012', proof.get('LOG')::uuid);
select proof.as_owner();
select proof.set('a150', (select id::text from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000011'));
select proof.set('a100', (select id::text from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000012'));

select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((select list_price = 180 and floor_price = 160.50 and default_lot_id::text = proof.get('a150') from storefront_price_lines(array['40000000-0000-0000-0000-000000000011'::uuid])),
                'counter starts on the oldest lot: 150 × 1.20 = 180, floor 160.50');
select proof.ok((select (lots->0->>'supplier') = 'Alpha Supply Co.' and (lots->0->>'list_price')::numeric = 180 and (lots->1->>'supplier') = 'Beta Trading'
                        and (lots->1->>'list_price')::numeric = 120 and (lots->1->>'unit_cost')::numeric = 100
                   from storefront_price_lines(array['40000000-0000-0000-0000-000000000011'::uuid])), 'lot list by supplier: Alpha bought 150 → sells 180; Beta bought 100 → sells 120');
select proof.ok((select store_price = 180 from catalog_product_search('Compressor A')), 'Product Search price from the oldest lot with stock (180)');
select proof.set('SA1', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 2, 'lot_id', proof.get('a100'))),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 240)), 'issue_dr', true))->>'id'));
select proof.ok((select status = 'completed' and total = 240 and cost_total = 200 from storefront_sales where id = proof.get('SA1')::uuid), 'sold 2 from the ₱100 lot at 120 each; cost 2 × 100 = 200');
select proof.ok((select unit_cost = 100 and list_price = 120 and floor_price = 107 from storefront_sale_items where sale_id = proof.get('SA1')::uuid), 'line cost = lot purchase price (not the average)');
select proof.set('SA2', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a100'), 'unit_price', 106)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 106)), 'issue_dr', true))->>'id'));
select proof.ok((select status = 'pending_approval' and 'below_floor' = any(approval_reasons) from storefront_sales where id = proof.get('SA2')::uuid), '₱100 lot at 106 is below its floor 107 → approver');
select storefront_cancel_sale(proof.get('SA2')::uuid);
select proof.set('SA3', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a100'), 'unit_price', 107)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 107)), 'issue_dr', true))->>'id'));
select proof.ok((select status = 'completed' from storefront_sales where id = proof.get('SA3')::uuid), '₱100 lot at 107 goes through');
select proof.set('SA4', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a150'), 'unit_price', 150)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 150)), 'issue_dr', true))->>'id'));
select proof.ok((select status = 'pending_approval' from storefront_sales where id = proof.get('SA4')::uuid), '₱150 lot at 150 is below its floor (160.50) → approver');
select storefront_cancel_sale(proof.get('SA4')::uuid);
select storefront_return(jsonb_build_object('sale_id', proof.get('SA1'), 'reason', 'extra unit',
        'lines', jsonb_build_array(jsonb_build_object('sale_item_id', (select id from storefront_sale_items where sale_id = proof.get('SA1')::uuid), 'quantity', 1, 'condition', 'back_to_stock')),
        'refunds', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 120))));
select proof.as_owner();
select proof.ok((select cost_total = 100 from storefront_returns where sale_id = proof.get('SA1')::uuid), 'return cost at the lot price (100)');
select proof.ok(inventory_lot_on_hand(proof.get('a100')::uuid, proof.get('ST')::uuid) = 3, '₱100 lot: 5 − 2 − 1 + 1 returned = 3');
-- order DR: the order's price, the lot's cost
insert into sales_orders(id, business_id, customer_id, order_date, status, subtotal, payment_terms)
values ('53000000-0000-0000-0000-000000000011', proof.get('PILI')::uuid, proof.get('CUST')::uuid, current_date, 'approved', 200, 'COD');
insert into sales_order_items(id, order_id, business_id, catalog_item_id, description, quantity, unit, unit_price, fulfilment) values
 ('54000000-0000-0000-0000-000000000011', '53000000-0000-0000-0000-000000000011', proof.get('PILI')::uuid, '40000000-0000-0000-0000-000000000011', 'Compressor A', 1, 'pc', 200, 'stock');
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('DRA', (storefront_order_dr(jsonb_build_object('order_id', '53000000-0000-0000-0000-000000000011', 'lines', jsonb_build_array(
        jsonb_build_object('sales_order_item_id', '54000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a150'))))))->>'id');
select proof.as_owner();
select proof.ok((select unit_price = 200 and unit_cost = 150 from storefront_sale_items where sale_id = proof.get('DRA')::uuid), 'order DR keeps the order price (200), costs the lot (150)');
select proof.as_user(proof.get('SAPP')::uuid);
select proof.ok((select supplier_cost = 120 and cost_basis = 150 and store_price = 180 from price_review_items('Compressor A')), 'Price Review: current cost 120, priced from the oldest lot 150 → 180');
select proof.ok((select count(*) = 2 and min(supplier) = 'Alpha Supply Co.' from price_review_purchases('40000000-0000-0000-0000-000000000011')), 'purchase prices: 2, by supplier');
select proof.ok((select array_agg(unit_cost order by supplier) = array[150, 100]::numeric[] from price_review_purchases('40000000-0000-0000-0000-000000000011')), 'Alpha 150, Beta 100');
select proof.ok((select srp = 180 from get_catalog_sales_price('40000000-0000-0000-0000-000000000011', null, null)), 'quotation pricing from the oldest lot (180)');

\warn '== O. Order-only items (CAT-38)'
select proof.as_owner();
insert into finance_procurement_items(id, item_name, category, unit, standard_cost, item_type) values ('40000000-0000-0000-0000-000000000012', 'Special Valve', 'Parts', 'pc', 300, 'product');
select catalog_import_update_items(jsonb_build_array(jsonb_build_object('id', '40000000-0000-0000-0000-000000000012', 'stock_type', 'order_only')));
select proof.ok((select stock_type from finance_procurement_items where id = '40000000-0000-0000-0000-000000000012') = 'order_only', 'upload sets STOCK TYPE = Order only');
select catalog_import_update_items(jsonb_build_array(jsonb_build_object('id', '40000000-0000-0000-0000-000000000012', 'stock_type', 'nonsense')));
select proof.ok((select stock_type from finance_procurement_items where id = '40000000-0000-0000-0000-000000000012') = 'order_only', 'an unknown value leaves it unchanged');
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000012', 'quantity', 1)), 'payments', '[]'::jsonb, 'issue_dr', true))$$,
                   'order-only item with 0 on hand', 'order-only item with none on hand: counter refuses, points to a quotation');
select proof.ok((select stock_type = 'order_only' from catalog_product_search('Special Valve')), 'Product Search knows it is order-only');
select proof.as_owner();
select proof.set('inv_v', ensure_inventory_link('40000000-0000-0000-0000-000000000012', proof.get('PILI')::uuid)::text);
insert into logistics_receipts(id, business_id, location_id, receipt_date, status) values ('50000000-0000-0000-0000-000000000013', proof.get('PILI')::uuid, proof.get('ST')::uuid, current_date, 'approved');
insert into logistics_receipt_items(receipt_id, business_id, inventory_item_id, quantity, unit_cost) values ('50000000-0000-0000-0000-000000000013', proof.get('PILI')::uuid, proof.get('inv_v')::uuid, 2, 300);
select proof.as_user(proof.get('LOG')::uuid);
select post_receipt_to_stock('50000000-0000-0000-0000-000000000013', proof.get('LOG')::uuid);
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000012', 'quantity', 3)), 'payments', '[]'::jsonb, 'issue_dr', true))$$,
                   'with 2.000 on hand', 'leftovers: 3 of 2 refused');
select proof.ok((storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000012', 'quantity', 2)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 660)), 'issue_dr', true))->>'status') = 'completed', 'leftovers: 2 on hand sold at the counter (300 + 10% add-on = 330 each)');
select proof.as_owner();
insert into logistics_inventory_location_settings(business_id, inventory_item_id, location_id, reorder_level) values
 (proof.get('PILI')::uuid, proof.get('inv_v')::uuid, proof.get('ST')::uuid, 5);
select proof.as_user(proof.get('LOG')::uuid);
select proof.set('low_before', (select low_stock_items::text from logistics_dashboard_kpis() where business_code = 'PILI'));
select proof.as_owner();
update finance_procurement_items set stock_type = 'stock' where id = '40000000-0000-0000-0000-000000000012';
select proof.as_user(proof.get('LOG')::uuid);
select proof.ok((select low_stock_items from logistics_dashboard_kpis() where business_code = 'PILI') = proof.get('low_before')::bigint + 1, 'reorder warning only once it is a stock item');

\warn '== P. Delete unused deactivated items (CAT-37)'
select proof.as_owner();
insert into finance_procurement_items(id, item_name, category, unit, standard_cost, item_type, active) values ('40000000-0000-0000-0000-000000000013', 'Old Duplicate', 'Parts', 'pc', 10, 'product', true);
insert into finance_catalog_item_pricing(business_id, item_id, markup_percent) values (proof.get('PILI')::uuid, '40000000-0000-0000-0000-000000000013', 25);
insert into finance_procurement_item_suppliers(item_id, supplier_id) values ('40000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000001');
select ensure_inventory_link('40000000-0000-0000-0000-000000000013', proof.get('PILI')::uuid);
update finance_procurement_items set active = false where id in ('40000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000002');
select proof.as_user(proof.get('BA')::uuid);
select proof.fails($$select * from catalog_purge_unused(false)$$, 'Only the Super Admin', 'Business Admin cannot delete catalog items');
select proof.as_user(proof.get('SA')::uuid);
select proof.ok((select reason = 'Will be deleted' from catalog_purge_unused(false) where item_code = (select item_code from finance_procurement_items where id = '40000000-0000-0000-0000-000000000013')), 'check: unused duplicate will be deleted');
select proof.ok((select not deleted and reason like 'Kept: used in Storefront sales%' from catalog_purge_unused(false) where item_id = '40000000-0000-0000-0000-000000000002'), 'check: an item with sales is kept, with the reason');
select proof.ok((select count(*) from finance_procurement_items where id = '40000000-0000-0000-0000-000000000013') = 1, 'the check deletes nothing');
select count(*) from catalog_purge_unused(true);
select proof.as_owner();
select proof.ok((select count(*) from finance_procurement_items where id = '40000000-0000-0000-0000-000000000013') = 0
            and (select count(*) from finance_catalog_item_pricing where item_id = '40000000-0000-0000-0000-000000000013') = 0
            and (select count(*) from logistics_inventory_items where procurement_item_id = '40000000-0000-0000-0000-000000000013') = 0, 'unused duplicate deleted with its markup, supplier link and inventory link');
select proof.ok((select not active from finance_procurement_items where id = '40000000-0000-0000-0000-000000000002'), 'used item stays, deactivated');
select proof.fails($$delete from finance_procurement_items where id = '40000000-0000-0000-0000-000000000002'$$, 'cannot be deleted', 'a direct delete is still refused');

\warn '== Q. Consistency'
select proof.ok(not exists (
  select 1 from (select inventory_item_id, location_id, sum(on_hand) s from inventory_lot_balances group by 1, 2) a
  join logistics_stock_balance b using (inventory_item_id, location_id) where a.s <> b.on_hand), 'lots (incl. "No lot") = on hand');
\warn 'proof79: all checks passed'
