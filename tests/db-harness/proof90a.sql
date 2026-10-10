-- Build 90a (percent precision) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.ok((select numeric_scale from information_schema.columns where table_name = 'finance_catalog_customer_discounts' and column_name = 'discount_percent') = 8, 'customer discount keeps 8 decimals');
select proof.ok((select prosrc not like '%round(v_new, 4)%' from pg_proc where proname = 'price_review_set_item'), 'the price review returns the full markup');
insert into finance_catalog_customer_discounts(business_id, customer_id, item_id, discount_percent)
select c.business_id, c.id, (select id from finance_procurement_items limit 1), 7.69230769 from finance_customers c limit 1;
select proof.ok((select discount_percent from finance_catalog_customer_discounts order by created_at desc limit 1) = 7.69230769, 'a discount like 7.69230769% is stored as typed');
rollback;
