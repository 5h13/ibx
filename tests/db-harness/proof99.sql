-- Build 99 (ledger part 1: receiving, payables, advances, opening balances, stock counts) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
select proof.set('loc', (select id::text from logistics_locations where business_id = proof.get('b')::uuid limit 1));
-- helper: balance of an account in this test's entries
create temporary table t99_sources(module text);
create or replace function pg_temp.bal(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from finance_journal_lines l join finance_journal_entries e on e.id = l.journal_entry_id
    join finance_chart_of_accounts a on a.id = l.account_id
   where e.business_id = proof.get('b')::uuid and a.account_code = p_code and e.status = 'posted' and e.created_at >= proof.get('t0')::timestamptz $$;
select proof.set('t0', now()::text);
insert into finance_suppliers(id, supplier_code, legal_name) values ('00000000-0000-0000-0000-0000009900a1', 'T99-SUP', 'Supplier T99');
insert into finance_bank_accounts(id, business_id, account_name, account_code, bank_name) values ('00000000-0000-0000-0000-0000009900b1', proof.get('b')::uuid, 'BDO T99', 'T99-BDO', 'BDO');
insert into logistics_inventory_items(id, business_id, item_code, item_name) values ('00000000-0000-0000-0000-0000009900c1', proof.get('b')::uuid, 'T99-IT', 'Item T99');
insert into purchase_orders(id, business_id, supplier_id, po_number, status, subtotal) values ('00000000-0000-0000-0000-0000009900d1', proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900a1', 'T99-PO1', 'approved', 1000);
insert into purchase_order_items(id, business_id, purchase_order_id, description, quantity, unit_cost) values ('00000000-0000-0000-0000-0000009900d2', proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900d1', 'Item T99', 10, 100);

\echo == A. goods received: Dr Inventory, Cr Goods Received Not Billed
-- (the PO line check needs a catalogue link; the ledger entry is the same with or without the PO)
insert into logistics_receipts(id, business_id, receipt_number, location_id, supplier_id, status, receipt_date)
values ('00000000-0000-0000-0000-0000009900e1', proof.get('b')::uuid, 'T99-RCV1', proof.get('loc')::uuid, '00000000-0000-0000-0000-0000009900a1', 'approved', current_date);
insert into logistics_receipt_items(business_id, receipt_id, inventory_item_id, quantity, accepted_qty, unit_cost) values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900e1', '00000000-0000-0000-0000-0000009900c1', 10, 10, 100);
update logistics_receipts set status = 'posted' where id = '00000000-0000-0000-0000-0000009900e1';
select proof.ok(pg_temp.bal('1200') = 1000 and pg_temp.bal('2010') = -1000, 'receiving 10 × ₱100: inventory +₱1,000, received-not-billed ₱1,000');
update logistics_receipts set status = 'posted' where id = '00000000-0000-0000-0000-0000009900e1';
select proof.ok((select count(*) from finance_journal_entries where source_record_id = '00000000-0000-0000-0000-0000009900e1') = 1, 'the receipt is booked once');

\echo == B. supplier bill on the PO, ₱5 dearer per unit plus VAT
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, purchase_order_id, invoice_date, subtotal, tax_amount, status)
values ('00000000-0000-0000-0000-0000009900f1', proof.get('b')::uuid, 'T99-SI1', '00000000-0000-0000-0000-0000009900a1', '00000000-0000-0000-0000-0000009900d1', current_date, 1050, 126, 'reviewed');
insert into finance_supplier_invoice_items(business_id, invoice_id, purchase_order_item_id, description, quantity, unit_cost)
values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900f1', '00000000-0000-0000-0000-0000009900d2', 'Item T99', 10, 105);
update finance_supplier_invoices set status = 'approved' where id = '00000000-0000-0000-0000-0000009900f1';
select proof.ok(pg_temp.bal('2010') = 0, 'the bill clears received-not-billed at the PO cost (₱1,000)');
select proof.ok(pg_temp.bal('1200') = 1050 and pg_temp.bal('1320') = 126 and pg_temp.bal('2000') = -1176, 'price difference ₱50 to inventory, input VAT ₱126, payable ₱1,176');

\echo == C. paying the bill from the chosen bank account
insert into finance_supplier_payments(id, business_id, payment_number, invoice_id, payment_date, amount, payment_method, bank_account, status)
values ('00000000-0000-0000-0000-0000009900f2', proof.get('b')::uuid, 'T99-PAY1', '00000000-0000-0000-0000-0000009900f1', current_date, 1176, 'Bank transfer', '00000000-0000-0000-0000-0000009900b1', 'approved');
select proof.ok((select bank_account_id = '00000000-0000-0000-0000-0000009900b1' and bank_account = 'BDO T99' from finance_supplier_payments where id = '00000000-0000-0000-0000-0000009900f2'), 'the chosen account is linked (name shown)');
update finance_supplier_payments set status = 'posted' where id = '00000000-0000-0000-0000-0000009900f2';
select proof.ok(pg_temp.bal('2000') = 0 and pg_temp.bal('1010') = -1176, 'payment: payable cleared, bank −₱1,176');
select proof.ok((select status::text from finance_supplier_invoices where id = '00000000-0000-0000-0000-0000009900f1') = 'paid', 'the bill shows paid');

\echo == D. a deposit on a PO before the bill, applied when the bill comes
insert into purchase_orders(id, business_id, supplier_id, po_number, status, subtotal) values ('00000000-0000-0000-0000-0000009900d3', proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900a1', 'T99-PO2', 'approved', 500);
insert into purchase_order_items(id, business_id, purchase_order_id, description, quantity, unit_cost) values ('00000000-0000-0000-0000-0000009900d4', proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900d3', 'Item T99', 5, 100);
insert into finance_supplier_payments(id, business_id, payment_number, purchase_order_id, po_payment_kind, payment_date, amount, payment_method, status)
values ('00000000-0000-0000-0000-0000009900f3', proof.get('b')::uuid, 'T99-PAY2', '00000000-0000-0000-0000-0000009900d3', 'deposit', current_date, 200, 'Cash', 'approved');
update finance_supplier_payments set status = 'posted' where id = '00000000-0000-0000-0000-0000009900f3';
select proof.ok(pg_temp.bal('1310') = 200 and pg_temp.bal('1000') = -200, 'deposit in cash: advances to suppliers ₱200');
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, purchase_order_id, invoice_date, subtotal, status)
values ('00000000-0000-0000-0000-0000009900f4', proof.get('b')::uuid, 'T99-SI2', '00000000-0000-0000-0000-0000009900a1', '00000000-0000-0000-0000-0000009900d3', current_date, 500, 'reviewed');
insert into finance_supplier_invoice_items(business_id, invoice_id, purchase_order_item_id, description, quantity, unit_cost)
values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900f4', '00000000-0000-0000-0000-0000009900d4', 'Item T99', 5, 100);
update finance_supplier_invoices set status = 'approved' where id = '00000000-0000-0000-0000-0000009900f4';
select proof.ok(pg_temp.bal('1310') = 0 and pg_temp.bal('2000') = -300, 'the bill uses the deposit: advance cleared, ₱300 still payable');
select proof.ok(pg_temp.bal('2010') = 500, 'billed before receiving: received-not-billed shows ₱500 until the goods arrive');

\echo == E. voiding reverses
insert into finance_supplier_payments(id, business_id, payment_number, invoice_id, payment_date, amount, payment_method, status)
values ('00000000-0000-0000-0000-0000009900f5', proof.get('b')::uuid, 'T99-PAY3', '00000000-0000-0000-0000-0000009900f4', current_date, 300, 'Cash', 'approved');
update finance_supplier_payments set status = 'posted' where id = '00000000-0000-0000-0000-0000009900f5';
select proof.ok(pg_temp.bal('2000') = 0, 'paid in full');
update finance_supplier_payments set status = 'voided' where id = '00000000-0000-0000-0000-0000009900f5';
select proof.ok(pg_temp.bal('2000') = -300 and (select reversal_journal_id is not null from finance_supplier_payments where id = '00000000-0000-0000-0000-0000009900f5'), 'voiding the payment puts the ₱300 back');

\echo == F. opening balances
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, invoice_date, subtotal, status, is_opening)
values ('00000000-0000-0000-0000-0000009900f6', proof.get('b')::uuid, 'T99-OPEN', '00000000-0000-0000-0000-0000009900a1', current_date, 7000, 'reviewed', true);
update finance_supplier_invoices set status = 'approved' where id = '00000000-0000-0000-0000-0000009900f6';
select proof.ok(pg_temp.bal('3900') = 7000 and pg_temp.bal('2000') = -7300, 'opening bill ₱7,000: opening balance equity, not an expense');
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, invoice_date, subtotal, status)
values ('00000000-0000-0000-0000-0000009900f7', proof.get('b')::uuid, 'T99-SI3', '00000000-0000-0000-0000-0000009900a1', current_date, 800, 'reviewed');
update finance_supplier_invoices set status = 'approved' where id = '00000000-0000-0000-0000-0000009900f7';
select proof.ok(pg_temp.bal('5200') = 800, 'a bill with no PO is an operating expense');

\echo == G. stock counts
delete from inventory_opening_counts where business_id = proof.get('b')::uuid and status = 'approved' and false;
select proof.set('first', (not exists (select 1 from inventory_opening_counts where business_id = proof.get('b')::uuid and status = 'approved'))::text);
insert into inventory_opening_counts(id, business_id, count_number, location_id, count_date) values ('00000000-0000-0000-0000-0000009900a7', proof.get('b')::uuid, 'T99-CNT1', proof.get('loc')::uuid, current_date);
insert into inventory_opening_count_lines(business_id, count_id, item_id, counted_qty, unit_cost, on_hand_before)
values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000009900a7', '40000000-0000-0000-0000-000000000003', 20, 50, 4);
update inventory_opening_counts set status = 'approved' where id = '00000000-0000-0000-0000-0000009900a7';
select proof.ok(pg_temp.bal('1200') = 1050 + 500 * 0 + 800, 'count adds 16 × ₱50 = ₱800 to inventory');
select proof.ok(case when proof.get('first')::boolean then pg_temp.bal('3900') = 7000 - 800 else pg_temp.bal('5020') = -800 end,
                'first count → opening balance equity; a later count → count adjustments');

\echo == H. every entry balances; AP in the ledger = open bills
select proof.ok(not exists (select 1 from finance_journal_entries e where e.business_id = proof.get('b')::uuid and e.created_at >= proof.get('t0')::timestamptz
                 and (select sum(debit) - sum(credit) from finance_journal_lines where journal_entry_id = e.id) <> 0), 'every entry balances');
select proof.ok(-pg_temp.bal('2000') = (select sum(total_amount - amount_paid) from finance_supplier_invoices where supplier_id = '00000000-0000-0000-0000-0000009900a1' and status::text in ('approved','partially_paid','paid')),
                'AP in the ledger = what the open bills still owe (₱8,100)');
rollback;
