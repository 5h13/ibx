-- Build 85 (statements with a period) proof: run after proof78-81 on the same database. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('sup', '30000000-0000-0000-0000-000000000001');
select proof.set('cust1', (select customer_id::text from finance_customer_invoices where business_id = proof.get('pili')::uuid and status in ('approved','partially_paid') and balance_due > 0 order by created_at limit 1));
-- a fully paid counter sale for the same customer (no AR invoice) and a pending supplier check
insert into storefront_sales(business_id, sale_number, sale_date, status, customer_id, location_id, total, subtotal, amount_paid, balance, hardcopy_dr_no, notes)
select proof.get('pili')::uuid, 'PILI-T85-1', current_date - 3, 'completed', proof.get('cust1')::uuid, location_id, 1234, 1234, 1234, 0, '8585', 'proof85'
  from storefront_settings where business_id = proof.get('pili')::uuid;
insert into finance_supplier_payments(business_id, payment_number, invoice_id, payment_date, amount, payment_method, reference_number, status)
values (proof.get('pili')::uuid, 'SP-T-85', '00000000-0000-0000-0000-0000000a0002', current_date + 20, 500, 'Check', 'Check 85', 'approved');

\echo == A. customer statement
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.set('st', public.customer_statement(proof.get('cust1')::uuid)::text);
select proof.ok((select count(*) from jsonb_array_elements(proof.get('st')::jsonb->'lines') l where l->>'dr' = '8585' and l->>'status' = 'Paid' and (l->>'paid')::numeric = 1234) = 1,
                'a DR paid at the counter is listed, marked Paid, with its payment');
select proof.ok((select count(*) from jsonb_array_elements(proof.get('st')::jsonb->'lines') l where (l->>'charge')::numeric > 0 and l->>'status' <> 'Paid') >= 1, 'open DRs are listed too');
select proof.ok((proof.get('st')::jsonb->>'closing')::numeric = (proof.get('st')::jsonb->'aging'->>'total')::numeric, 'closing balance = total open invoices');
select proof.ok((select (l->>'balance')::numeric from jsonb_array_elements(proof.get('st')::jsonb->'lines') with ordinality x(l, n) order by n desc limit 1) = (proof.get('st')::jsonb->>'closing')::numeric, 'running balance ends at the closing balance');
select proof.set('st2', public.customer_statement(proof.get('cust1')::uuid, current_date, current_date)::text);
select proof.ok((proof.get('st2')::jsonb->>'opening')::numeric + (proof.get('st2')::jsonb->>'charges')::numeric - (proof.get('st2')::jsonb->>'payments_total')::numeric = (proof.get('st')::jsonb->>'closing')::numeric,
                'a shorter period carries the earlier balance forward (opening + charges − payments = closing)');
select proof.ok(not exists (select 1 from jsonb_array_elements(proof.get('st2')::jsonb->'lines') l where l->>'dr' = '8585'), 'the period filters the lines');
select proof.fails($$select public.customer_statement(proof.get('cust1')::uuid, current_date, current_date - 1)$$, 'period start', 'a reversed period is refused');

\echo == B. supplier statement
select proof.set('ss', public.supplier_statement(proof.get('sup')::uuid)::text);
select proof.ok((proof.get('ss')::jsonb->>'closing')::numeric = 7000, 'supplier closing balance 7,000 (5,000 + 2,000)');
select proof.ok((select count(*) from jsonb_array_elements(proof.get('ss')::jsonb->'lines') l where l->>'dr' = '7781' and l->>'status' = 'Open') = 1, 'a purchase entered from a supplier DR is listed with its status');
select proof.ok((select count(*) from jsonb_array_elements(proof.get('ss')::jsonb->'lines') l where l->>'ref' = 'SP-T-1') = 1, 'posted payments are listed');
select proof.ok((select count(*) from jsonb_array_elements(proof.get('ss')::jsonb->'pending') p where p->>'number' = 'SP-T-85') = 1
                and not exists (select 1 from jsonb_array_elements(proof.get('ss')::jsonb->'lines') l where l->>'ref' = 'SP-T-85'), 'a check not yet posted is listed as pending, not as paid');
\echo == Build 85 proof passed
rollback;
