-- Build 88 (AR-02: payments applied oldest invoice first) proof: run after proof78-86 on the same database. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
insert into finance_customers(id, business_id, customer_code, legal_name, active) values ('00000000-0000-0000-0000-0000000c0088', proof.get('pili')::uuid, 'CUS-PILI-T88', 'Proof88 Customer', true);
insert into finance_customer_invoices(id, business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, status, notes) values
 ('00000000-0000-0000-0000-0000000a0881', proof.get('pili')::uuid, 'T88-DR1', '00000000-0000-0000-0000-0000000c0088', current_date - 20, current_date - 5, 10000, 'approved', 'proof88'),
 ('00000000-0000-0000-0000-0000000a0882', proof.get('pili')::uuid, 'T88-DR2', '00000000-0000-0000-0000-0000000c0088', current_date - 10, current_date + 5, 5000, 'approved', 'proof88'),
 ('00000000-0000-0000-0000-0000000a0883', proof.get('pili')::uuid, 'T88-DR3', '00000000-0000-0000-0000-0000000c0088', current_date - 2, current_date + 28, 1000, 'approved', 'proof88');

\echo == A. preview
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- PILI cashier
select proof.ok((select string_agg(invoice_number || ':' || applied::text, ',' order by invoice_date) from public.ar_oldest_allocation('00000000-0000-0000-0000-0000000c0088', 12000) where applied > 0)
                = 'T88-DR1:10000.00,T88-DR2:2000.00', 'preview: 12,000 pays DR1 in full and 2,000 of DR2');

\echo == B. counter payment, oldest first
select proof.set('r', public.storefront_collect_ar_oldest('00000000-0000-0000-0000-0000000c0088', '[{"method":"cash","amount":12000,"tendered":12000}]')::text);
reset role; select proof.as_owner();
select proof.ok((select status::text from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0881') = 'paid', 'DR1 (oldest) is paid');
select proof.ok((select balance_due from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0882') = 3000, 'DR2 balance 3,000');
select proof.ok((select balance_due from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0883') = 1000, 'DR3 (newest) untouched');
select proof.ok((select count(*) from finance_customer_receipts where invoice_id in ('00000000-0000-0000-0000-0000000a0881','00000000-0000-0000-0000-0000000a0882') and status = 'posted') = 2, 'one posted AR receipt per invoice part');
select proof.ok((proof.get('r')::jsonb->>'balance')::numeric = 4000, 'the result shows what is still owed (4,000)');

\echo == C. a check over two invoices stays one check
select proof.as_user('00000000-0000-0000-0000-000000000013');
select public.storefront_collect_ar_oldest('00000000-0000-0000-0000-0000000c0088', ('[{"method":"check","amount":3500,"reference":"CHK-T88","check_bank":"BDO","check_date":"' || current_date || '"}]')::jsonb);
reset role; select proof.as_owner();
select proof.ok((select count(*) from storefront_checks where check_number = 'CHK-T88') = 1 and (select amount from storefront_checks where check_number = 'CHK-T88') = 3500, 'one check record for the full 3,500');
select proof.ok((select balance_due from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0882') = 0
                and (select balance_due from finance_customer_invoices where id = '00000000-0000-0000-0000-0000000a0883') = 500, 'the check paid DR2 (3,000) and 500 of DR3');

\echo == D. refusals
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select public.storefront_collect_ar_oldest('00000000-0000-0000-0000-0000000c0088', '[{"method":"cash","amount":600}]')$$, 'more than what the customer owes', 'paying more than owed is refused');
select proof.fails($$select public.storefront_collect_ar_oldest('00000000-0000-0000-0000-0000000c0088', ('[{"method":"check","amount":100,"reference":"CHK-T88","check_bank":"BDO","check_date":"' || current_date || '"}]')::jsonb)$$,
                   'already used', 'a check number already used on another payment is still refused');
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- ATON cashier
select proof.fails($$select public.storefront_collect_ar_oldest('00000000-0000-0000-0000-0000000c0088', '[{"method":"cash","amount":100}]')$$, 'not found', 'another store cannot collect for this customer');
\echo == Build 88 proof passed
rollback;
