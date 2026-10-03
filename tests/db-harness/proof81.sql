-- Build 81 (AR-01 / AP-01) proof: run after proof78-80 on the same database (it uses proof78's Storefront AR invoices).
\set ON_ERROR_STOP 1
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('ar1', (select s.ar_invoice_id::text from storefront_sales s where s.business_id = proof.get('pili')::uuid and s.ar_invoice_id is not null and s.dr_number is not null order by s.created_at limit 1));
select proof.set('dr1', (select coalesce(nullif(btrim(hardcopy_dr_no), ''), dr_number) from storefront_sales where ar_invoice_id = proof.get('ar1')::uuid and dr_number is not null limit 1));  -- Build 85: the paper DR no. first
select proof.set('cust1', (select customer_id::text from finance_customer_invoices where id = proof.get('ar1')::uuid));
select proof.set('sup', '30000000-0000-0000-0000-000000000001');

-- AP data: an invoice entered from the supplier's DR (no SI), an invoice with an SI, a payment
insert into finance_supplier_invoices(id, business_id, invoice_number, supplier_dr_number, supplier_id, invoice_date, due_date, subtotal, status, created_by)
values ('00000000-0000-0000-0000-0000000a0001', proof.get('pili')::uuid, 'DR 7781', '7781', proof.get('sup')::uuid, current_date - 40, current_date - 10, 5000, 'approved', '00000000-0000-0000-0000-000000000015'),
       ('00000000-0000-0000-0000-0000000a0002', proof.get('pili')::uuid, 'SI-5520', null, proof.get('sup')::uuid, current_date - 5, current_date + 25, 3000, 'approved', '00000000-0000-0000-0000-000000000015');
insert into finance_supplier_payments(business_id, payment_number, invoice_id, payment_date, amount, payment_method, reference_number, status)
values (proof.get('pili')::uuid, 'SP-T-1', '00000000-0000-0000-0000-0000000a0002', current_date, 1000, 'Bank transfer', 'BT-1', 'posted');
update finance_supplier_invoices set amount_paid = 1000, status = 'partially_paid' where id = '00000000-0000-0000-0000-0000000a0002';

\echo == A. AR references
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok((select dr_numbers from public.ar_invoice_refs(array[proof.get('ar1')::uuid])) like '%' || proof.get('dr1') || '%', 'an AR invoice shows the DR number of its sale');
select proof.ok((select si_number from public.ar_invoice_refs(array[proof.get('ar1')::uuid])) is null, 'a sale without an SI shows no SI number');
select proof.ok((select count(*) from jsonb_array_elements(public.customer_statement(proof.get('cust1')::uuid)->'invoices') x where x->>'dr' like '%' || proof.get('dr1') || '%') >= 1,
                'the statement of account lists the invoice by its DR number');
select proof.as_user('00000000-0000-0000-0000-000000000021');
select proof.ok((select count(*) from public.ar_invoice_refs(array[proof.get('ar1')::uuid])) = 0, 'another store sees no references for this store''s invoices');

\echo == B. AP references and supplier statement
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok((select supplier_si is null and supplier_dr = '7781' from public.ap_invoice_refs(array['00000000-0000-0000-0000-0000000a0001'::uuid])), 'a payable entered from a supplier DR shows the DR and no SI');
select proof.ok((select supplier_si = 'SI-5520' and supplier_dr is null from public.ap_invoice_refs(array['00000000-0000-0000-0000-0000000a0002'::uuid])), 'a payable with an SI shows the SI');
select proof.set('st', public.supplier_statement(proof.get('sup')::uuid)::text);
select proof.ok((proof.get('st')::jsonb->'aging'->>'total')::numeric = 7000, 'supplier statement: total owed 5,000 + 2,000 balance');
select proof.ok((proof.get('st')::jsonb->'aging'->>'d1_30')::numeric = 5000 and (proof.get('st')::jsonb->'aging'->>'current')::numeric = 2000, 'supplier statement aging: 5,000 overdue 10 days, 2,000 not yet due');
select proof.ok((select count(*) from jsonb_array_elements(proof.get('st')::jsonb->'lines') x where x->>'ref' = 'SP-T-1' and x->>'si' = 'SI-5520') = 1, 'supplier statement lists the payment made');  -- Build 85: transactions list
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.supplier_statement(proof.get('sup')::uuid)$$, 'Finance access', 'a Sales user cannot open a supplier statement');
select proof.ok((select count(*) from public.ap_invoice_refs(array['00000000-0000-0000-0000-0000000a0001'::uuid])) = 0, 'a Sales user sees no AP references');
\echo == Build 81 proof passed
