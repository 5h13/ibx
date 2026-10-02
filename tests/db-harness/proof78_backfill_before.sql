-- Build 78 backfill proof, part 1: on a Build 77 database (replay.sh ibx77 20261207_build77_integration.sql),
-- record stock the old way: a receipt, an opening count, a counter sale.
\set ON_ERROR_STOP 1
select proof.as_owner();
select proof.set('PILI', (select id::text from businesses where code = 'PILI'));
select proof.set('inv_cap', ensure_inventory_link('40000000-0000-0000-0000-000000000001', proof.get('PILI')::uuid)::text);
select proof.as_user('00000000-0000-0000-0000-000000000011');
select storefront_set_location('10000000-0000-0000-0000-000000000001');
select proof.as_owner();
insert into logistics_receipts(id, business_id, supplier_id, location_id, receipt_date, status)
values ('50000000-0000-0000-0000-000000000009', proof.get('PILI')::uuid, '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_date - 20, 'approved');
insert into logistics_receipt_items(receipt_id, business_id, inventory_item_id, quantity, unit_cost, lot_number) values
 ('50000000-0000-0000-0000-000000000009', proof.get('PILI')::uuid, proof.get('inv_cap')::uuid, 8, 40, 'OLD-1');
select proof.as_user('00000000-0000-0000-0000-000000000016');
select post_receipt_to_stock('50000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000016');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000001', 'quantity', 3),
        jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000003', 'quantity', 1)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 846.30)), 'issue_dr', true));
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.set('CNT', (inventory_opening_count_create(jsonb_build_object('location_id', '10000000-0000-0000-0000-000000000002',
        'lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000002', 'qty', 3, 'unit_cost', 990))))->>'id'));
select proof.as_user('00000000-0000-0000-0000-000000000011');
select inventory_opening_count_decide(proof.get('CNT')::uuid, true, null);
select proof.as_owner();
create table proof.cost_before as select business_id, item_id, avg_cost from inventory_item_costs;
create table proof.bal_before as select * from logistics_stock_balance;
