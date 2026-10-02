-- Build 78 backfill proof, part 2: after applying 20261208-20261210 to the part-1 database.
\set ON_ERROR_STOP 1
select proof.as_owner();
select proof.ok((select count(*) from inventory_lots) = 2, 'stock on record gets 2 lots: the receipt and the opening count');
select proof.ok((select source = 'receipt' and received_qty = 8 and unit_cost = 40 and supplier_lot_no = 'OLD-1' and supplier_id = '30000000-0000-0000-0000-000000000001' and receipt_id = '50000000-0000-0000-0000-000000000009'
                   from inventory_lots where source = 'receipt'), 'receipt lot: 8 at 40 from Alpha, batch OLD-1, linked to its receipt');
select proof.ok((select source = 'opening' and received_qty = 3 and unit_cost = 990 from inventory_lots where source = 'opening'), 'opening lot: 3 at 990');
select proof.ok((select count(*) from logistics_stock_movements where lot_id is null and movement_type = 'issue') = 2, 'earlier counter-sale issues stay "No lot"');
select proof.ok(not exists (select 1 from logistics_stock_balance a full join proof.bal_before b using (inventory_item_id, location_id) where a.on_hand is distinct from b.on_hand), 'stock balances unchanged');
select proof.ok(not exists (select 1 from inventory_item_costs a full join proof.cost_before b using (business_id, item_id) where a.avg_cost is distinct from b.avg_cost), 'weighted average costs unchanged');
select proof.ok((select count(*) from logistics_stock_movements m join inventory_lots l on l.id = m.lot_id where m.lot_number = l.lot_code) = 2, 'backfilled movements show their lot code');
\warn 'proof78 backfill: all checks passed'
