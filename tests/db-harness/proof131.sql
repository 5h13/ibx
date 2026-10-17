-- Build 131 (PILI history cost per DR -> margins in the Sales Manager app) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('cust', (select id::text from finance_customers where business_id = proof.get('pili')::uuid order by created_at limit 1));
select proof.set('loc', (select id::text from logistics_locations where business_id = proof.get('pili')::uuid order by created_at limit 1));
-- two history DRs from the record (0102-01: ₱1,800, cost ₱1,150; 0102-04: ₱7,800, cost ₱6,732) and one whose total differs
insert into storefront_sales(business_id, sale_number, status, customer_id, location_id, dr_number, subtotal, total, amount_paid, balance, sale_date)
values (proof.get('pili')::uuid, 'HIST-P-1', 'completed', proof.get('cust')::uuid, proof.get('loc')::uuid, 'PILI-DR-0102-01', 1800, 1800, 1800, 0, '2026-01-02'),
       (proof.get('pili')::uuid, 'HIST-P-4', 'completed', proof.get('cust')::uuid, proof.get('loc')::uuid, 'PILI-DR-0102-04', 7800, 7800, 7800, 0, '2026-01-02'),
       (proof.get('pili')::uuid, 'HIST-P-2', 'completed', proof.get('cust')::uuid, proof.get('loc')::uuid, 'PILI-DR-0102-02', 9999, 9999, 9999, 0, '2026-01-02');
\i supabase/migrations/20270131_pili_history_costs.sql
select proof.ok((select history_cost from storefront_sales where dr_number = 'PILI-DR-0102-01') = 1150, 'the DR''s cost comes from the record');
select proof.ok((select history_capital from storefront_sales where dr_number = 'PILI-DR-0102-01') = 1207.5, 'capital (cost + add-on) is kept');
select proof.ok((select history_commission from storefront_sales where dr_number = 'PILI-DR-0102-03') is null, 'a DR not in the app is skipped');
select proof.ok((select history_cost from storefront_sales where dr_number = 'PILI-DR-0102-02') is null, 'a DR whose total differs from the record is not touched');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- Business Admin
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_month(2026, 1)->'by_category') x
  where x->>'name' = 'Sales history' and (x->>'margin')::numeric = round(((1800 + 7800) - (1150 + 6732))::numeric / (1800 + 7800) * 100, 1)),
  'history margin = (sales - cost) / sales over the DRs with a cost (the ₱9,999 DR without one is left out)');
select proof.ok((public.manager_month(2026, 1)->>'total')::numeric >= 1800 + 7800 + 9999, 'every history DR still counts in the total');
rollback;
