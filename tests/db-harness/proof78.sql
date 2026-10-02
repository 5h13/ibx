-- Build 78 proof: lots, reservation, hardcopy DR no., quick price review.
-- Run after replay.sh + seed78.sql + lib.sql.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;

-- ids
select proof.as_owner();
select proof.set('PILI', (select id::text from businesses where code = 'PILI'));
select proof.set('ATON', (select id::text from businesses where code = 'ATON'));
select proof.set('SA',   '00000000-0000-0000-0000-000000000001');
select proof.set('BA',   '00000000-0000-0000-0000-000000000011');
select proof.set('BA2',  '00000000-0000-0000-0000-000000000012');
select proof.set('CASH', '00000000-0000-0000-0000-000000000013');
select proof.set('SAPP', '00000000-0000-0000-0000-000000000014');
select proof.set('FIN',  '00000000-0000-0000-0000-000000000015');
select proof.set('LOG',  '00000000-0000-0000-0000-000000000016');
select proof.set('LAPP', '00000000-0000-0000-0000-000000000017');
select proof.set('ACASH','00000000-0000-0000-0000-000000000021');
select proof.set('ASAPP','00000000-0000-0000-0000-000000000022');
select proof.set('CAP', '40000000-0000-0000-0000-000000000001');
select proof.set('R32', '40000000-0000-0000-0000-000000000002');
select proof.set('FAN', '40000000-0000-0000-0000-000000000003');
select proof.set('ST',  '10000000-0000-0000-0000-000000000001');
select proof.set('WH',  '10000000-0000-0000-0000-000000000002');
select proof.set('AST', '10000000-0000-0000-0000-000000000003');
select proof.set('inv_cap', ensure_inventory_link(proof.get('CAP')::uuid, proof.get('PILI')::uuid)::text);
select proof.set('inv_r32', ensure_inventory_link(proof.get('R32')::uuid, proof.get('PILI')::uuid)::text);
select proof.set('inv_fan', ensure_inventory_link(proof.get('FAN')::uuid, proof.get('PILI')::uuid)::text);

-- store locations
select proof.as_user(proof.get('BA')::uuid);
select storefront_set_location(proof.get('ST')::uuid);
select proof.as_owner();
insert into storefront_settings(business_id, location_id) values (proof.get('ATON')::uuid, proof.get('AST')::uuid) on conflict (business_id) do update set location_id = excluded.location_id;

\warn '== A. Every receipt line becomes a lot'
insert into logistics_receipts(id, business_id, supplier_id, location_id, receipt_date, status)
values ('50000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, '30000000-0000-0000-0000-000000000001', proof.get('WH')::uuid, current_date - 40, 'approved'),
       ('50000000-0000-0000-0000-000000000002', proof.get('PILI')::uuid, '30000000-0000-0000-0000-000000000002', proof.get('WH')::uuid, current_date - 5, 'approved');
insert into logistics_receipt_items(id, receipt_id, business_id, inventory_item_id, quantity, unit_cost, lot_number) values
 ('51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 10, 40, null),
 ('51000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 5, 44, 'A-1'),
 ('51000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('inv_r32')::uuid, 4, 1000, null),
 ('51000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000002', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 7, 46, 'B-77');
-- the second CAP receipt: 1 of 7 damaged, so 6 accepted
update logistics_receipt_items set damaged_qty = 1, accepted_qty = 6 where id = '51000000-0000-0000-0000-000000000004';
select proof.as_user(proof.get('LOG')::uuid);
select post_receipt_to_stock('50000000-0000-0000-0000-000000000001', proof.get('LOG')::uuid);
select post_receipt_to_stock('50000000-0000-0000-0000-000000000002', proof.get('LOG')::uuid);
select proof.as_owner();
select proof.set('lot1', (select id::text from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000001'));
select proof.set('lot2', (select id::text from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000002'));
select proof.set('lotR', (select id::text from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000003'));
select proof.set('lot3', (select id::text from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000004'));
select proof.set('lot3code', (select lot_code from inventory_lots where receipt_item_id = '51000000-0000-0000-0000-000000000004'));
select proof.ok((select count(*) from inventory_lots where receipt_id = '50000000-0000-0000-0000-000000000001') = 3, 'receipt with 3 lines → 3 lots (two lines of the same item = two lots)');
select proof.ok((select lot_code from inventory_lots where id = proof.get('lot1')::uuid) ~ '^PILI-LOT-[0-9]{4}-000001$', 'lot code PILI-LOT-YYYY-000001');
select proof.ok((select received_qty = 6 and unit_cost = 46 and supplier_lot_no = 'B-77' and supplier_id = '30000000-0000-0000-0000-000000000002' from inventory_lots where id = proof.get('lot3')::uuid),
                'lot keeps accepted qty 6 (1 damaged), price 46, supplier batch B-77, supplier Beta');
select proof.ok((select count(*) from logistics_stock_movements where source_table = 'logistics_receipts' and lot_id is not null) = 4
            and (select count(*) from logistics_stock_movements where source_table = 'logistics_receipts' and lot_id is null) = 0, 'each receipt movement carries its lot');
select proof.ok((select lot_number from logistics_stock_movements where lot_id = proof.get('lot2')::uuid) = (select lot_code from inventory_lots where id = proof.get('lot2')::uuid), 'movement lot_number = lot code');

\warn '== B. Who sees lot prices'
select proof.as_user(proof.get('LOG')::uuid);
select proof.ok((select count(*) from inventory_lots) = 0, 'Logistics reads no lot rows directly (they carry the price)');
select proof.ok((select count(*) = 3 and bool_and(unit_cost is null) from inventory_lots_for_item(proof.get('CAP')::uuid, proof.get('WH')::uuid)), 'Logistics lot picker: 3 CAP lots, no price');
select proof.ok((select sum(on_hand_here) from inventory_lots_for_item(proof.get('CAP')::uuid, proof.get('WH')::uuid)) = 21, 'lot balances at WH add up to 21');
select proof.as_user(proof.get('FIN')::uuid);
select proof.ok(round(inventory_unit_cost(proof.get('PILI')::uuid, proof.get('inv_cap')::uuid), 2) = round((400 + 220 + 276)::numeric / 21, 2), 'weighted average unchanged in method: (400+220+276)/21 = 42.67');
select proof.ok((select array_agg(unit_cost order by lot_code) from inventory_lots_for_item(proof.get('CAP')::uuid, null)) = array[40, 44, 46]::numeric[], 'Finance sees lot prices 40 / 44 / 46');
select proof.ok((select count(*) from inventory_item_purchase_history(proof.get('CAP')::uuid)) = 3, 'purchase-price history of CAP from receipts: 3 purchases');
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select * from inventory_item_purchase_history('40000000-0000-0000-0000-000000000001')$$, 'Finance and admins only', 'cashier cannot read purchase prices');
select proof.fails($$insert into inventory_lots(business_id, inventory_item_id, lot_code, source, received_date, received_qty) values ('f6dac031-5b12-4346-9f1d-031b91a03aa1', '40000000-0000-0000-0000-000000000001', 'X', 'receipt', current_date, 1)$$, 'permission denied', 'no direct writes to lots');

\warn '== C. Transfers move lots (chosen, or oldest first)'
select proof.as_owner();
insert into logistics_stock_transfers(id, business_id, from_location_id, to_location_id, status) values
 ('52000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('WH')::uuid, proof.get('ST')::uuid, 'approved'),
 ('52000000-0000-0000-0000-000000000002', proof.get('PILI')::uuid, proof.get('WH')::uuid, proof.get('ST')::uuid, 'approved'),
 ('52000000-0000-0000-0000-000000000003', proof.get('PILI')::uuid, proof.get('WH')::uuid, proof.get('ST')::uuid, 'approved');
insert into logistics_stock_transfer_items(transfer_id, business_id, inventory_item_id, quantity, lot_id) values
 ('52000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 12, null),
 ('52000000-0000-0000-0000-000000000002', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 3, proof.get('lot3')::uuid),
 ('52000000-0000-0000-0000-000000000003', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 5, proof.get('lot3')::uuid);
select proof.fails($$insert into logistics_stock_transfer_items(transfer_id, business_id, inventory_item_id, quantity, lot_id) values ('52000000-0000-0000-0000-000000000003', 'f6dac031-5b12-4346-9f1d-031b91a03aa1', '$$ || proof.get('inv_cap') || $$', 1, '$$ || proof.get('lotR') || $$')$$,
                   'not a lot of that item', 'transfer line with another item''s lot refused');
select proof.as_user(proof.get('LOG')::uuid);
select post_transfer_to_stock('52000000-0000-0000-0000-000000000001', proof.get('LOG')::uuid);
select post_transfer_to_stock('52000000-0000-0000-0000-000000000002', proof.get('LOG')::uuid);
select proof.fails($$select post_transfer_to_stock('52000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000016')$$, 'has only', 'transfer of 5 from a lot holding 3 refused (item has 6)');
select proof.ok(inventory_lot_on_hand(proof.get('lot1')::uuid, proof.get('ST')::uuid) = 10 and inventory_lot_on_hand(proof.get('lot2')::uuid, proof.get('ST')::uuid) = 2,
                'no lot chosen → oldest first: 10 from lot 1, 2 from lot 2');
select proof.ok(inventory_lot_on_hand(proof.get('lot3')::uuid, proof.get('ST')::uuid) = 3 and inventory_lot_on_hand(proof.get('lot3')::uuid, proof.get('WH')::uuid) = 3, 'chosen lot 3: 3 moved, 3 left at WH');
select proof.ok((select count(*) from logistics_stock_movements where source_table = 'logistics_stock_transfers' and source_record_id = '52000000-0000-0000-0000-000000000001') = 4, 'split transfer → out + in per lot (4 movements)');
select proof.ok((select lot_code from logistics_stock_transfer_items where transfer_id = '52000000-0000-0000-0000-000000000002') = proof.get('lot3code'), 'transfer line shows its lot code to Logistics');

\warn '== D. Counter sale: the lot on every line, oldest filled in'
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((select default_lot_id::text = proof.get('lot1') and jsonb_array_length(lots) = 3 and on_hand = 15 and reserved = 0 from storefront_price_lines(array[proof.get('CAP')::uuid])),
                'price line: oldest lot with stock filled in, 3 lots to choose, 15 on hand, 0 reserved');
select proof.set('S1', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('CAP'), 'quantity', 3)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 163.80)), 'issue_dr', true))->>'id'));
select proof.ok((select lot_id::text from storefront_sale_items where sale_id = proof.get('S1')::uuid) = proof.get('lot1'), 'no lot sent → oldest lot (lot 1) recorded on the line');
select proof.set('S2', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(
        jsonb_build_object('item_id', proof.get('CAP'), 'quantity', 1, 'lot_id', proof.get('lot2')),
        jsonb_build_object('item_id', proof.get('CAP'), 'quantity', 2, 'lot_id', proof.get('lot1'))),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 169.26)), 'issue_dr', true))->>'id'));  -- Build 79: lot 2 line at 60.06
select proof.as_owner();
select proof.ok((select status from storefront_sales where id = proof.get('S2')::uuid) = 'completed'
            and (select count(*) from logistics_stock_movements where source_table = 'storefront_sales' and source_record_id = proof.get('S2')::uuid) = 2, 'one item from two lots → two lines, two movements');
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000001', 'quantity', 1, 'lot_id', '$$ || proof.get('lot1') || $$'), jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000001', 'quantity', 1, 'lot_id', '$$ || proof.get('lot1') || $$')), 'payments', '[]'::jsonb, 'issue_dr', true))$$,
                   'twice from the same lot', 'same item from the same lot twice refused');
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000001', 'quantity', 1, 'lot_id', '$$ || proof.get('lotR') || $$')), 'payments', '[]'::jsonb, 'issue_dr', true))$$,
                   'not a lot of this item', 'lot of another item refused');
select proof.ok(inventory_lot_on_hand(proof.get('lot1')::uuid, proof.get('ST')::uuid) = 5 and inventory_lot_on_hand(proof.get('lot2')::uuid, proof.get('ST')::uuid) = 1, 'lot 1 at the store 10−3−2 = 5, lot 2 2−1 = 1');

\warn '== E. Reservation'
select proof.set('CUST', storefront_add_customer('Cool Contractors', '0917', null, null)::text);
select proof.as_owner();
insert into sales_orders(id, business_id, customer_id, order_date, status, subtotal, payment_terms)
values ('53000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('CUST')::uuid, current_date, 'approved', 382.20, 'COD'),
       ('53000000-0000-0000-0000-000000000002', proof.get('PILI')::uuid, proof.get('CUST')::uuid, current_date, 'approved', 109.20, 'COD');
insert into sales_order_items(id, order_id, business_id, catalog_item_id, description, quantity, unit, unit_price, fulfilment) values
 ('54000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid, proof.get('CAP')::uuid, 'Capacitor 35uF', 7, 'pc', 54.60, 'stock');
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((select on_hand = 9 and reserved = 7 and available = 2 from storefront_price_lines(array[proof.get('CAP')::uuid])), 'counter: 9 on hand, 7 reserved for the order, 2 available');
select proof.set('S5', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('CAP'), 'quantity', 3)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 163.80)), 'issue_dr', true))->>'id'));
select proof.ok((select status = 'pending_approval' and 'reserved_stock' = any(approval_reasons) from storefront_sales where id = proof.get('S5')::uuid), 'selling 3 when 2 are free → needs an approver (reserved stock)');
select proof.as_owner();
select proof.ok((select count(*) from logistics_stock_movements where source_record_id = proof.get('S5')::uuid) = 0, 'no stock moves while it waits');
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('S6', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('CAP'), 'quantity', 2)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 109.20)), 'issue_dr', true))->>'id'));
select proof.ok((select status from storefront_sales where id = proof.get('S6')::uuid) = 'completed', 'selling the 2 free units goes through');
select storefront_cancel_sale(proof.get('S5')::uuid);
select proof.ok((select on_hand = 13 and reserved = 7 and available = 6 from catalog_product_search('Capacitor')), 'Product Search (whole store, all locations): 13 on hand, 7 reserved, 6 available');
select proof.ok((select (catalog_product_detail(proof.get('CAP')::uuid)->>'available')::numeric = 6), 'product detail: available 6');
select proof.fails($$select storefront_order_dr(jsonb_build_object('order_id', '53000000-0000-0000-0000-000000000001', 'lines', jsonb_build_array(jsonb_build_object('sales_order_item_id', '54000000-0000-0000-0000-000000000001', 'quantity', 4, 'lot_id', '$$ || proof.get('lot1') || $$'), jsonb_build_object('sales_order_item_id', '54000000-0000-0000-0000-000000000001', 'quantity', 4, 'lot_id', '$$ || proof.get('lot3') || $$'))))$$,
                   'only 7', 'DR rows of one order line are added up: 8 of 7 refused');
select proof.set('DR1', (storefront_order_dr(jsonb_build_object('order_id', '53000000-0000-0000-0000-000000000001', 'hardcopy_dr_no', 'HC-500', 'lines', jsonb_build_array(
        jsonb_build_object('sales_order_item_id', '54000000-0000-0000-0000-000000000001', 'quantity', 2, 'lot_id', proof.get('lot3')),
        jsonb_build_object('sales_order_item_id', '54000000-0000-0000-0000-000000000001', 'quantity', 2)))))->>'id');
select proof.ok((select count(*) = 2 and count(*) filter (where lot_id::text = proof.get('lot3')) = 1 from storefront_sale_items where sale_id = proof.get('DR1')::uuid), 'DR line split across two lots (one chosen, one filled in)');
select proof.ok((select reserved from storefront_price_lines(array[proof.get('CAP')::uuid])) = 7, 'DR issued, not released: still reserved');
select proof.ok((select count(*) from jsonb_array_elements(storefront_drs_awaiting_release()) d, jsonb_array_elements(d->'lines') l where l->>'lot_code' is not null) = 2, 'Warehouse release list shows the lot of each line');
select proof.as_user(proof.get('LOG')::uuid);
select storefront_release_dr(proof.get('DR1')::uuid);
select proof.ok((select count(*) = 2 and bool_and(lot_id is not null) from logistics_stock_movements where source_table = 'storefront_sales' and source_record_id = proof.get('DR1')::uuid), 'Warehouse release: one movement per lot');
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((select on_hand = 3 and reserved = 3 and available = 0 from storefront_price_lines(array[proof.get('CAP')::uuid])), 'after release: 3 on hand, 3 still reserved');
select proof.as_owner();
insert into sales_order_items(id, order_id, business_id, catalog_item_id, description, quantity, unit, unit_price, fulfilment) values
 ('54000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000002', proof.get('PILI')::uuid, proof.get('CAP')::uuid, 'Capacitor 35uF', 2, 'pc', 54.60, 'stock');
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((select reserved from storefront_price_lines(array[proof.get('CAP')::uuid])) = 5, 'second order adds 2 → 5 reserved');
select proof.fails($$select sales_order_cancel('53000000-0000-0000-0000-000000000002', 'client backed out')$$, 'Only a Sales approver', 'cashier cannot cancel an order');
select proof.as_user(proof.get('SAPP')::uuid);
select proof.ok((select count(*) from inventory_reservations(proof.get('CAP')::uuid)) = 2, 'reservations list: 2 orders');
select proof.fails($$select sales_order_cancel('53000000-0000-0000-0000-000000000002', ' ')$$, 'Say why', 'cancellation needs a reason');
select proof.fails($$select sales_order_cancel('53000000-0000-0000-0000-000000000001', 'x')$$, 'already has 1 DR', 'order with a DR out cannot be cancelled');
select sales_order_cancel('53000000-0000-0000-0000-000000000002', 'client backed out');
select proof.ok((select reserved from storefront_price_lines(array[proof.get('CAP')::uuid])) = 3, 'cancelled order releases its reservation → 3');

\warn '== F. Returns go back into their lot'
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('lot2_before', inventory_lot_on_hand(proof.get('lot2')::uuid, proof.get('ST')::uuid)::text);
select storefront_return(jsonb_build_object('sale_id', proof.get('S2'), 'reason', 'wrong size',
        'lines', jsonb_build_array(jsonb_build_object('sale_item_id', (select id from storefront_sale_items where sale_id = proof.get('S2')::uuid and lot_id = proof.get('lot2')::uuid), 'quantity', 1, 'condition', 'back_to_stock')),
        'refunds', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 60.06))));
select proof.ok(inventory_lot_on_hand(proof.get('lot2')::uuid, proof.get('ST')::uuid) = proof.get('lot2_before')::numeric + 1, 'returned unit back in lot 2');

\warn '== G. Trace a lot to its customers; aging'
select proof.as_user(proof.get('LOG')::uuid);
select proof.ok((select jsonb_array_length(inventory_lot_trace(proof.get('lot1')::uuid)->'customers') = 2), 'lot 1 traced to 2 customers (Walk-in, Cool Contractors)');
select proof.ok((inventory_lot_trace(proof.get('lot1')::uuid)->>'unit_cost') is null, 'trace shows no price to Logistics');
select proof.ok((select count(*) from inventory_lot_register(null, null, true, 100, 0)) = 4, 'lot register: 4 lots with stock');
select proof.ok((select age_bucket from inventory_lot_register(null, null, true, 100, 0) where lot_id = proof.get('lot1')::uuid) = '31-90 days', 'lot 1 (40 days) in the 31-90 days bucket');
select proof.ok((select sum(on_hand) from inventory_lot_aging()) = (select sum(on_hand) from inventory_lot_balances where lot_id is not null and business_id = proof.get('PILI')::uuid), 'aging totals = lot balances');
select proof.as_user(proof.get('FIN')::uuid);
select proof.ok((select value is not null from inventory_lot_aging() limit 1), 'aging value shown to Finance');
select proof.ok((inventory_lot_trace(proof.get('lot3')::uuid)->'movements') @> '[{"hardcopy_dr_no": "HC-500"}]'::jsonb, 'trace shows the hardcopy DR no.');

\warn '== H. Opening / stock count matched to lots'
select proof.as_user(proof.get('CASH')::uuid);
select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('FAN'), 'quantity', 2)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1365)), 'issue_dr', true));
select proof.as_owner();
select proof.ok(q77_on_hand(proof.get('PILI')::uuid, proof.get('FAN')::uuid, proof.get('ST')::uuid) = -2
            and (select lot_id is null from storefront_sale_items where item_id = proof.get('FAN')::uuid limit 1), 'fan motor sold with no stock: −2, "No lot" (warning only)');
select proof.as_user(proof.get('FIN')::uuid);
select proof.set('CNT', (inventory_opening_count_create(jsonb_build_object('location_id', proof.get('ST'), 'lines', jsonb_build_array(
        jsonb_build_object('item_id', proof.get('FAN'), 'qty', 5, 'unit_cost', 520),
        jsonb_build_object('item_id', proof.get('CAP'), 'qty', 2))))->>'id'));
select proof.set('cap_lots_before', (select jsonb_object_agg(x.lot_id, x.on_hand)::text from inventory_item_lot_balances(proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, proof.get('ST')::uuid) x where x.on_hand <> 0));
select proof.as_user(proof.get('BA')::uuid);
select inventory_opening_count_decide(proof.get('CNT')::uuid, true, null);
select proof.as_owner();
select proof.ok(q77_on_hand(proof.get('PILI')::uuid, proof.get('FAN')::uuid, proof.get('ST')::uuid) = 5, 'fan motor on hand = count (5)');
select proof.ok((select count(*) = 1 and min(source) = 'opening' and min(received_qty) = 5 and min(unit_cost) = 520 from inventory_lots where inventory_item_id = proof.get('inv_fan')::uuid), 'opening lot of 5 at 520 (first lot of the item)');
select proof.ok((select coalesce(sum(on_hand), 0) from inventory_item_lot_balances(proof.get('PILI')::uuid, proof.get('inv_fan')::uuid, proof.get('ST')::uuid) where lot_id is null) = 0, '"No lot" −2 cleared');
select proof.ok(q77_on_hand(proof.get('PILI')::uuid, proof.get('CAP')::uuid, proof.get('ST')::uuid) = 2, 'capacitor recount to 2');
select proof.ok((select sum(on_hand) from inventory_item_lot_balances(proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, proof.get('ST')::uuid) where lot_id = (
                  select l.id from inventory_lots l join (select lot_id from jsonb_object_keys(proof.get('cap_lots_before')::jsonb) k(lot_id)) k on k.lot_id::uuid = l.id order by l.received_date desc, l.lot_code desc limit 1)) > 0,
                'recount keeps the newest lot''s stock first');
select proof.ok((select count(*) from inventory_lots where inventory_item_id = proof.get('inv_cap')::uuid and source = 'count') = 0, 'count below the lots creates no new lot');

\warn '== I. Hardcopy DR no.'
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('S7', (storefront_submit_sale(jsonb_build_object('hardcopy_dr_no', 'HC 001', 'lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('R32'), 'quantity', 1)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1200)), 'issue_dr', true))->>'id'));
select proof.ok((select hardcopy_dr_no from storefront_sales where id = proof.get('S7')::uuid) = 'HC 001', 'hardcopy DR no. recorded');
select proof.fails($$select storefront_submit_sale(jsonb_build_object('hardcopy_dr_no', 'hc001', 'lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000002', 'quantity', 1)), 'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1200)), 'issue_dr', true))$$,
                   'already recorded on sale', 'same hardcopy DR no. (spacing / case ignored) refused in the store');
select proof.ok((storefront_sale_for_return('hc001')->>'id') = proof.get('S7'), 'return lookup finds the sale by hardcopy DR no.');
select proof.as_user(proof.get('ACASH')::uuid);
select proof.ok((storefront_submit_sale(jsonb_build_object('hardcopy_dr_no', 'HC001', 'lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('CAP'), 'quantity', 1)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 54.60)), 'issue_dr', true))->>'status') = 'completed', 'another store may use the same hardcopy number');

\warn '== J. Quick price review'
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select * from price_review_items()$$, 'price review is for', 'cashier refused');
select proof.as_user(proof.get('LOG')::uuid);
select proof.fails($$select * from price_review_items()$$, 'price review is for', 'Logistics refused');
select proof.as_user(proof.get('SAPP')::uuid);
select proof.set('cap_before', (select store_price::text from price_review_items('Capacitor')));
select proof.ok((select markup_percent = 30 and addon_percent = 5 and store_price = round(cost_basis * 1.05 * 1.30, 2) from price_review_items('Capacitor')), 'list: price from the oldest lot with stock × add-on 5% × markup 30%');
select proof.ok((select count(*) from price_review_items(null, 'Parts', null, null)) = 2 and (select count(*) from price_review_items(null, null, 'Coolco', null)) = 1
            and (select count(*) from price_review_items(null, null, null, '30000000-0000-0000-0000-000000000002')) = 2, 'filters: category (2), brand (1), supplier (2)');
select price_review_set_item(proof.get('CAP')::uuid, null, 60);
select proof.ok(proof.price(proof.get('CAP')::uuid, proof.get('PILI')::uuid) = 60, 'store price typed 60 → markup set so the store price is exactly 60');
select proof.fails($$select price_review_set_item('40000000-0000-0000-0000-000000000001', null, 41)$$, 'below its acquisition cost', 'store price below acquisition cost refused');
select proof.fails($$select price_review_set_item('40000000-0000-0000-0000-000000000001', 10, 70)$$, 'either the markup or the store price', 'markup and price together refused');
select proof.as_user(proof.get('FIN')::uuid);
select price_review_set_item(proof.get('FAN')::uuid, 40, null);
select proof.ok(proof.price(proof.get('FAN')::uuid, proof.get('PILI')::uuid) = 764.40, 'Finance sets fan motor markup 40% → 764.40 (from its opening lot at 520)');
select proof.as_user(proof.get('SAPP')::uuid);
select proof.ok((price_review_set_addon('20000000-0000-0000-0000-000000000001', 10)->>'items_affected')::int = 2, 'Parts add-on 10%: 2 items affected');
select proof.ok(proof.price(proof.get('CAP')::uuid, proof.get('PILI')::uuid) = round(60 * 1.10 / 1.05, 2), 'CAP price follows the new add-on');
select proof.ok(proof.price(proof.get('CAP')::uuid, proof.get('ATON')::uuid) = 54.60, 'ATON prices untouched');
select proof.ok((select count(*) from price_review_changes()) = 3 and (select count(*) from price_review_changes() where changed_by = 'Pili Finance') = 1, 'every change logged with who (3 changes)');
select proof.ok((select old_store_price = proof.get('cap_before')::numeric and new_store_price = 60 from price_review_changes() where kind = 'store_price'), 'log keeps old and new store price');
select proof.as_owner();
select proof.ok((select captured_by::text from finance_catalog_pricing_history where rule_type = 'item_markup' and item_id = proof.get('CAP')::uuid order by captured_at desc limit 1) = proof.get('SAPP'),
                'pricing history now names who changed it');
select proof.as_user(proof.get('ASAPP')::uuid);
select proof.ok((select count(*) from price_review_changes()) = 0 and (select count(*) from catalog_price_changes) = 0, 'ATON approver sees none of PILI''s changes');

\warn '== K. Store isolation'
select proof.as_user(proof.get('ACASH')::uuid);
select proof.ok((select count(*) from inventory_lot_register(null, null, false, 100, 0) where lot_code like 'PILI%') = 0, 'ATON lot register shows no PILI lot');
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000001', 'quantity', 1, 'lot_id', '$$ || proof.get('lot1') || $$')), 'payments', '[]'::jsonb, 'issue_dr', true))$$,
                   'not a lot of this item in this store', 'ATON cannot sell from a PILI lot');
select proof.fails($$select inventory_lot_trace('$$ || proof.get('lot1') || $$')$$, 'not found in this store', 'ATON cannot trace a PILI lot');
select proof.as_owner();
select proof.fails($$update logistics_stock_movements set lot_id = null where lot_id = '$$ || proof.get('lot1') || $$'$$, 'immutable', 'a movement''s lot cannot be changed');

\warn '== M. Regression: AR, returns, closing and count rejection still work'
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('S9', (storefront_submit_sale(jsonb_build_object('customer_id', proof.get('CUST'), 'lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('R32'), 'quantity', 1)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 200)), 'issue_dr', true))->>'id'));
select proof.as_owner();
select proof.ok((select i.total_amount = 1200 and i.amount_received = 200 and i.balance_due = 1000 from storefront_sales s join finance_customer_invoices i on i.id = s.ar_invoice_id where s.id = proof.get('S9')::uuid),
                'charge sale ₱1,200 paid ₱200 → AR invoice balance ₱1,000');
select proof.ok((select ar_invoice_id is not null and total = 218.40 from storefront_sales where id = proof.get('DR1')::uuid), 'order DR billed in AR (₱218.40)');
select proof.as_user(proof.get('CASH')::uuid);
select storefront_return(jsonb_build_object('sale_id', proof.get('S9'), 'reason', 'not needed',
        'lines', jsonb_build_array(jsonb_build_object('sale_item_id', (select id from storefront_sale_items where sale_id = proof.get('S9')::uuid), 'quantity', 1, 'condition', 'damaged')), 'refunds', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 200))));
select proof.as_owner();
select proof.ok((select balance_due = 0 from storefront_sales s join finance_customer_invoices i on i.id = s.ar_invoice_id where s.id = proof.get('S9')::uuid), 'return credits the AR balance first, rest refunded');
select proof.ok((select count(*) from storefront_return_items ri join storefront_sale_items si on si.id = ri.sale_item_id where si.sale_id = proof.get('S9')::uuid and ri.stock_movement_id is null) = 1, 'damaged return does not go back to stock');
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((storefront_closing_preview((now() at time zone 'Asia/Manila')::date)->>'sales_count')::int = 7, 'closing preview counts the day''s 7 completed sales');
select proof.as_user(proof.get('FIN')::uuid);
select proof.set('CNT2', (inventory_opening_count_create(jsonb_build_object('location_id', proof.get('WH'), 'lines', jsonb_build_array(jsonb_build_object('item_id', proof.get('R32'), 'qty', 1))))->>'id'));
select proof.as_user(proof.get('BA')::uuid);
select proof.fails($$select inventory_opening_count_decide('$$ || proof.get('CNT2') || $$', false, '')$$, 'Say why', 'rejecting a count needs a note');
select inventory_opening_count_decide(proof.get('CNT2')::uuid, false, 'recount');
select proof.as_owner();
select proof.ok((select status from inventory_opening_counts where id = proof.get('CNT2')::uuid) = 'rejected' and (select count(*) from logistics_stock_movements where source_record_id = proof.get('CNT2')::uuid) = 0, 'rejected count moves nothing');

\warn '== L. Consistency: lot balances add up to stock'
select proof.ok(not exists (
  select 1 from (select inventory_item_id, location_id, sum(on_hand) s from inventory_lot_balances group by 1, 2) a
  join logistics_stock_balance b using (inventory_item_id, location_id) where a.s <> b.on_hand), 'per item and location, lots (incl. "No lot") = on hand');
\warn 'proof78: all checks passed'
