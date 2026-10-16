-- Build 112 (quotation discount by amount or percentage) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
select proof.set('c', (select id::text from finance_customers where business_id = proof.get('b')::uuid order by created_at limit 1));
-- percent discount: amount follows the subtotal
insert into sales_quotations(id, business_id, customer_id, subtotal, discount_percent)
values ('00000000-0000-0000-0000-0000011200a1', proof.get('b')::uuid, proof.get('c')::uuid, 12500, 10);
select proof.ok((select discount_amount from sales_quotations where id = '00000000-0000-0000-0000-0000011200a1') = 1250.00, '10% of ₱12,500 = ₱1,250.00');
select proof.ok((select total_amount from sales_quotations where id = '00000000-0000-0000-0000-0000011200a1') = 11250.00, 'total = subtotal − discount');
update sales_quotations set subtotal = 3333.33 where id = '00000000-0000-0000-0000-0000011200a1';
select proof.ok((select discount_amount from sales_quotations where id = '00000000-0000-0000-0000-0000011200a1') = 333.33, 'subtotal change recomputes the % discount (rounded to centavos)');
-- VAT is computed on the final discount
update sales_quotations set vat_applied = true where id = '00000000-0000-0000-0000-0000011200a1';
select proof.ok((select vat_amount from sales_quotations where id = '00000000-0000-0000-0000-0000011200a1') = round((3333.33 - 333.33) * 12 / 112, 2), 'VAT uses the discounted total');
-- a revision keeps the percent
insert into sales_quotations(id, business_id, customer_id, subtotal, revised_from, revision)
values ('00000000-0000-0000-0000-0000011200a2', proof.get('b')::uuid, proof.get('c')::uuid, 0, '00000000-0000-0000-0000-0000011200a1', 1);
update sales_quotations set subtotal = 20000 where id = '00000000-0000-0000-0000-0000011200a2';
select proof.ok((select discount_percent from sales_quotations where id = '00000000-0000-0000-0000-0000011200a2') = 10, 'revision copies the 10%');
select proof.ok((select discount_amount from sales_quotations where id = '00000000-0000-0000-0000-0000011200a2') = 2000.00, 'revision discount recomputed on the new subtotal');
-- peso discount stays as entered
insert into sales_quotations(id, business_id, customer_id, subtotal, discount_amount)
values ('00000000-0000-0000-0000-0000011200a3', proof.get('b')::uuid, proof.get('c')::uuid, 5000, 500);
update sales_quotations set subtotal = 6000 where id = '00000000-0000-0000-0000-0000011200a3';
select proof.ok((select discount_amount from sales_quotations where id = '00000000-0000-0000-0000-0000011200a3') = 500, 'a peso discount does not change with the subtotal');
-- refusals
select proof.fails($$insert into sales_quotations(business_id, customer_id, subtotal, discount_amount) values ('$$ || proof.get('b') || $$', '$$ || proof.get('c') || $$', 1000, -5)$$, 'cannot be negative', 'negative discount refused');
select proof.fails($$insert into sales_quotations(business_id, customer_id, subtotal, discount_amount) values ('$$ || proof.get('b') || $$', '$$ || proof.get('c') || $$', 1000, 1500)$$, 'more than the lines total', 'discount above the lines total refused');
select proof.fails($$insert into sales_quotations(business_id, customer_id, subtotal, discount_percent) values ('$$ || proof.get('b') || $$', '$$ || proof.get('c') || $$', 1000, 120)$$, 'between 0% and 100%', '% above 100 refused');
-- older rows: a status change is never blocked
alter table sales_quotations disable trigger sales_quotations_discount;
update sales_quotations set discount_amount = 9999 where id = '00000000-0000-0000-0000-0000011200a3';
alter table sales_quotations enable trigger sales_quotations_discount;
update sales_quotations set notes = 'status-like change' where id = '00000000-0000-0000-0000-0000011200a3';
select proof.ok(true, 'an old row with a bad discount can still be updated when the discount and subtotal are unchanged');
rollback;
