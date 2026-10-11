-- Build 103 (purchase price control: "To be quoted", free lines, quote confirmation, bill tolerance) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
select proof.set('loc', (select id::text from logistics_locations where business_id = proof.get('b')::uuid limit 1));
select proof.set('t0', now()::text);
create or replace function pg_temp.bal(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from finance_journal_lines l join finance_journal_entries e on e.id = l.journal_entry_id
    join finance_chart_of_accounts a on a.id = l.account_id
   where e.business_id = proof.get('b')::uuid and a.account_code = p_code and e.status = 'posted' and e.created_at >= proof.get('t0')::timestamptz $$;
insert into finance_suppliers(id, supplier_code, legal_name) values ('00000000-0000-0000-0000-0000010300a1', 'T103-SUP', 'Supplier T103');
insert into finance_procurement_items(id, item_code, item_name, category) values
  ('00000000-0000-0000-0000-0000010300c1', 'T103-A', 'Compressor T103', 'Parts'),
  ('00000000-0000-0000-0000-0000010300c2', 'T103-B', 'Capacitor T103', 'Parts');
-- an earlier purchase of item A at ₱1,000 from this supplier (for the review flag)
insert into purchase_orders(id, business_id, supplier_id, po_number, status, order_date) values ('00000000-0000-0000-0000-0000010300d0', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300a1', 'T103-PO0', 'draft', current_date - 30);
insert into purchase_order_items(id, business_id, purchase_order_id, item_id, description, quantity, unit_cost) values ('00000000-0000-0000-0000-0000010300e0', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300d0', '00000000-0000-0000-0000-0000010300c1', 'Compressor T103', 1, 1000);
update purchase_orders set status = 'approved' where id = '00000000-0000-0000-0000-0000010300d0';

\echo == A. every line priced, to be quoted, or free with a reason
insert into purchase_orders(id, business_id, supplier_id, po_number, status, order_date) values ('00000000-0000-0000-0000-0000010300d1', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300a1', 'T103-PO1', 'draft', current_date);
insert into purchase_order_items(id, business_id, purchase_order_id, item_id, description, quantity, unit_cost) values
  ('00000000-0000-0000-0000-0000010300e1', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300d1', '00000000-0000-0000-0000-0000010300c1', 'Compressor T103', 4, 1150),
  ('00000000-0000-0000-0000-0000010300e2', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300d1', '00000000-0000-0000-0000-0000010300c2', 'Capacitor T103', 10, 0),
  ('00000000-0000-0000-0000-0000010300e3', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300d1', null, 'Warranty replacement fan', 1, 0);
select proof.fails($$update purchase_orders set status = 'prepared' where id = '00000000-0000-0000-0000-0000010300d1'$$, 'No price on: Capacitor T103, Warranty replacement fan', 'a blank price cannot be prepared');
update purchase_order_items set price_status = 'to_be_quoted', unit_cost = 55 where id = '00000000-0000-0000-0000-0000010300e2';
select proof.ok((select unit_cost = 0 from purchase_order_items where id = '00000000-0000-0000-0000-0000010300e2'), '"To be quoted" keeps the price empty (₱0) until the quote is confirmed');
update purchase_order_items set price_status = 'free' where id = '00000000-0000-0000-0000-0000010300e3';
select proof.fails($$update purchase_orders set status = 'prepared' where id = '00000000-0000-0000-0000-0000010300d1'$$, 'reason the line is free', 'a free line needs its reason');
update purchase_order_items set price_note = 'Warranty claim WC-77' where id = '00000000-0000-0000-0000-0000010300e3';
update purchase_orders set status = 'prepared' where id = '00000000-0000-0000-0000-0000010300d1';
select proof.ok(true, 'priced + to be quoted + free with reason: prepared');
select proof.as_user('00000000-0000-0000-0000-000000000015');   -- Finance preparer / approver
select proof.ok((select (x->>'flag')::boolean and (x->>'change_pct')::numeric = 15 and (x->>'last_price')::numeric = 1000
                   from jsonb_array_elements(public.po_review_lines('00000000-0000-0000-0000-0000010300d1')) x where x->>'id' = '00000000-0000-0000-0000-0000010300e1'),
                'review: ₱1,150 vs last ₱1,000 from this supplier = +15 %, flagged (over 10 %)');
reset role; select proof.as_owner();
update purchase_orders set subtotal = 4600 where id = '00000000-0000-0000-0000-0000010300d1';
update purchase_orders set status = 'reviewed' where id = '00000000-0000-0000-0000-0000010300d1';
update purchase_orders set status = 'approved' where id = '00000000-0000-0000-0000-0000010300d1';
select proof.ok((select count(*) from finance_item_supplier_price_history where purchase_order_id = '00000000-0000-0000-0000-0000010300d1') = 1,
                'approval records only the priced line in purchase price history (no ₱0 "last price")');
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.fails($$update purchase_order_items set unit_cost = 60 where id = '00000000-0000-0000-0000-0000010300e1'$$, 'cannot be changed here', 'an approved PO''s prices cannot be edited');
select proof.fails($$update purchase_order_items set quote_price = 60, quote_approved_at = now() where id = '00000000-0000-0000-0000-0000010300e2'$$, 'Enter quote', 'no back door to a confirmed quote');
reset role; select proof.as_owner();

\echo == B. received before the price is confirmed
select proof.set('inv', (select id::text from logistics_inventory_items where procurement_item_id = '00000000-0000-0000-0000-0000010300c2' and business_id = proof.get('b')::uuid));
insert into logistics_receipts(id, business_id, receipt_number, purchase_order_id, location_id, supplier_id, status, receipt_date)
values ('00000000-0000-0000-0000-0000010300f1', proof.get('b')::uuid, 'T103-RCV1', '00000000-0000-0000-0000-0000010300d1', proof.get('loc')::uuid, '00000000-0000-0000-0000-0000010300a1', 'approved', current_date);
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- lines entered by a user (the PO check needs one)
insert into logistics_receipt_items(business_id, receipt_id, inventory_item_id, quantity, accepted_qty) values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300f1', proof.get('inv')::uuid, 6, 6);
reset role; select proof.as_owner();
update logistics_receipts set status = 'posted' where id = '00000000-0000-0000-0000-0000010300f1';
select proof.ok(pg_temp.bal('1200') = 0 and pg_temp.bal('2010') = 0, '6 capacitors received with no price: no value booked yet');
select proof.ok(public.po_line_received('00000000-0000-0000-0000-0000010300e2') = 6, 'received quantity shows on the line');
-- a second delivery still in draft
insert into logistics_receipts(id, business_id, receipt_number, purchase_order_id, location_id, supplier_id, status, receipt_date)
values ('00000000-0000-0000-0000-0000010300f2', proof.get('b')::uuid, 'T103-RCV2', '00000000-0000-0000-0000-0000010300d1', proof.get('loc')::uuid, '00000000-0000-0000-0000-0000010300a1', 'draft', current_date);
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- lines entered by a user (the PO check needs one)
insert into logistics_receipt_items(business_id, receipt_id, inventory_item_id, quantity, accepted_qty) values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300f2', proof.get('inv')::uuid, 4, 4);
reset role; select proof.as_owner();

\echo == C. a bill cannot be approved before the quote is confirmed
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, purchase_order_id, invoice_date, subtotal, status)
values ('00000000-0000-0000-0000-0000010300b1', proof.get('b')::uuid, 'T103-SI1', '00000000-0000-0000-0000-0000010300a1', '00000000-0000-0000-0000-0000010300d1', current_date, 330, 'reviewed');
insert into finance_supplier_invoice_items(business_id, invoice_id, purchase_order_item_id, description, quantity, unit_cost)
values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300b1', '00000000-0000-0000-0000-0000010300e2', 'Capacitor T103', 6, 55);
select proof.fails($$update finance_supplier_invoices set status = 'approved' where id = '00000000-0000-0000-0000-0000010300b1'$$, 'not confirmed yet', 'even the owner cannot approve the bill before the quote is confirmed');

\echo == D. enter and confirm the quote
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.po_quote_enter('00000000-0000-0000-0000-0000010300e2', 55, 'Q-1')$$, 'enters supplier quotes', 'a cashier cannot enter quotes');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.fails($$select public.po_quote_enter('00000000-0000-0000-0000-0000010300e2', 55, '')$$, 'quote reference', 'the quote reference is required');
select public.po_quote_enter('00000000-0000-0000-0000-0000010300e2', 55, 'Viber quote 11 Oct');
select proof.ok((select (x->>'state') = 'to_approve' and (x->>'received')::numeric = 6 from jsonb_array_elements(public.po_open_quotes()) x where x->>'id' = '00000000-0000-0000-0000-0000010300e2'),
                'open quotes list: waiting for approval, 6 received');
select proof.fails($$select public.po_quote_decide('00000000-0000-0000-0000-0000010300e2', true)$$, 'someone other than the person who entered it', 'the person who entered the quote cannot confirm it');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.ok((public.po_quote_decide('00000000-0000-0000-0000-0000010300e2', true) ->> 'received_costed')::numeric = 6, 'Business Admin confirms ₱55');
reset role; select proof.as_owner();
select proof.ok((select unit_cost = 55 and price_status = 'quoted' and quote_approved_by = '00000000-0000-0000-0000-000000000011' from purchase_order_items where id = '00000000-0000-0000-0000-0000010300e2'), 'the line now carries ₱55, with who confirmed it');
select proof.ok((select subtotal = 5150 from purchase_orders where id = '00000000-0000-0000-0000-0000010300d1'), 'PO subtotal follows: 4 × 1,150 + 10 × 55 = ₱5,150');
select proof.ok(pg_temp.bal('1200') = 330 and pg_temp.bal('2010') = -330, 'the 6 already received are costed: inventory +₱330, received-not-billed ₱330');
select proof.ok((select avg_cost = 55 from inventory_item_costs where business_id = proof.get('b')::uuid and item_id = proof.get('inv')::uuid), 'the item''s average cost is ₱55');
select proof.ok((select unit_cost = 55 from logistics_receipt_items where receipt_id = '00000000-0000-0000-0000-0000010300f2'), 'the draft delivery picks up ₱55');
select proof.ok((select po_unit_price = 55 from finance_item_supplier_price_history where purchase_order_item_id = '00000000-0000-0000-0000-0000010300e2'), 'purchase price history gets ₱55');
select proof.ok(not exists (select 1 from jsonb_array_elements(public.po_open_quotes()) x where x->>'id' = '00000000-0000-0000-0000-0000010300e2'), 'off the open quotes list');

\echo == E. the bill now clears; tolerance on prices above the PO
select proof.as_user('00000000-0000-0000-0000-000000000015');
update finance_supplier_invoices set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000015', approved_at = now() where id = '00000000-0000-0000-0000-0000010300b1';
reset role; select proof.as_owner();
select proof.ok(pg_temp.bal('2010') = 0 and pg_temp.bal('2000') = -330, 'bill at ₱55 approved by the Finance approver: received-not-billed cleared');
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, purchase_order_id, invoice_date, subtotal, status)
values ('00000000-0000-0000-0000-0000010300b2', proof.get('b')::uuid, 'T103-SI2', '00000000-0000-0000-0000-0000010300a1', '00000000-0000-0000-0000-0000010300d1', current_date, 4740, 'reviewed');
insert into finance_supplier_invoice_items(business_id, invoice_id, purchase_order_item_id, description, quantity, unit_cost)
values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300b2', '00000000-0000-0000-0000-0000010300e1', 'Compressor T103', 4, 1185);
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.fails($$update finance_supplier_invoices set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000015', approved_at = now() where id = '00000000-0000-0000-0000-0000010300b2'$$,
                   'needs the Business Admin''s approval', 'billed ₱1,185 vs PO ₱1,150 (+3 %): the Finance approver cannot approve');
update finance_supplier_invoice_items set unit_cost = 1170 where invoice_id = '00000000-0000-0000-0000-0000010300b2';
update finance_supplier_invoices set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000015', approved_at = now() where id = '00000000-0000-0000-0000-0000010300b2';
select proof.ok(true, 'billed ₱1,170 (+1.7 %, within 2 %): approved by the Finance approver');
reset role; select proof.as_owner();
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_id, purchase_order_id, invoice_date, subtotal, status)
values ('00000000-0000-0000-0000-0000010300b3', proof.get('b')::uuid, 'T103-SI3', '00000000-0000-0000-0000-0000010300a1', '00000000-0000-0000-0000-0000010300d1', current_date, 500, 'reviewed');
insert into finance_supplier_invoice_items(business_id, invoice_id, purchase_order_item_id, description, quantity, unit_cost)
values (proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300b3', '00000000-0000-0000-0000-0000010300e3', 'Warranty replacement fan', 1, 500);
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.fails($$update finance_supplier_invoices set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000015', approved_at = now() where id = '00000000-0000-0000-0000-0000010300b3'$$,
                   'free of charge on the PO but billed', 'a charge on a free line needs the Business Admin');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');
update finance_supplier_invoices set status = 'approved', approved_by = '00000000-0000-0000-0000-000000000011', approved_at = now() where id = '00000000-0000-0000-0000-0000010300b3';
select proof.ok(true, 'the Business Admin can approve it');

\echo == F. rejecting a quote; settings per store
reset role; select proof.as_owner();
insert into purchase_orders(id, business_id, supplier_id, po_number, status, order_date) values ('00000000-0000-0000-0000-0000010300d2', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300a1', 'T103-PO2', 'draft', current_date);
insert into purchase_order_items(id, business_id, purchase_order_id, item_id, description, quantity, price_status) values ('00000000-0000-0000-0000-0000010300e4', proof.get('b')::uuid, '00000000-0000-0000-0000-0000010300d2', '00000000-0000-0000-0000-0000010300c2', 'Capacitor T103', 5, 'to_be_quoted');
update purchase_orders set status = 'approved' where id = '00000000-0000-0000-0000-0000010300d2';
select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.po_quote_enter('00000000-0000-0000-0000-0000010300e4', 90, 'Q-90');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.fails($$select public.po_quote_decide('00000000-0000-0000-0000-0000010300e4', false)$$, 'reason', 'rejecting needs a reason');
select public.po_quote_decide('00000000-0000-0000-0000-0000010300e4', false, 'Too high, ask for ₱60');
select proof.ok((select (x->>'state') = 'waiting' from jsonb_array_elements(public.po_open_quotes()) x where x->>'id' = '00000000-0000-0000-0000-0000010300e4'), 'rejected: back to waiting for a quote');
select proof.fails($$select public.procurement_price_settings_save(5, 1)$$, 'Business Admin', 'only the Business Admin sets the levels');
reset role; select proof.as_user('00000000-0000-0000-0000-000000000011');
select public.procurement_price_settings_save(5, 1);
select proof.ok(public.procurement_price_settings_get() = '{"po_increase_flag_pct": 5.00, "bill_tolerance_pct": 1.00}'::jsonb, 'levels saved for this store');
reset role;
rollback;
