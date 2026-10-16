-- Build 118 (VAT choice on a counter sale; second SI booklet) proof. Runs after proofs 78-116. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('ISH', (select id::text from businesses where code = 'ISHABELLA'));
update businesses set vat_registered = (id = proof.get('ISH')::uuid) where id in (proof.get('ISH')::uuid, proof.get('PILI')::uuid);
create or replace function pg_temp.sale(p_vat jsonb, p_si text) returns uuid language sql as $$
  select (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a100'))),
          'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 120)), 'issue_dr', true, 'si_number', p_si) || coalesce(jsonb_build_object('vat', p_vat), '{}'::jsonb))->>'id')::uuid $$;

-- second booklet: must be the other kind
select proof.as_user(proof.get('BA')::uuid);
select proof.fails($$select storefront_set_booklet2('$$ || proof.get('PILI') || $$')$$, 'other kind', 'a second booklet of the same kind is refused');
select storefront_set_booklet2(proof.get('ISH')::uuid);
select proof.ok((storefront_booklet_pair()->>'vat_booklet') = proof.get('ISH') and (storefront_booklet_pair()->>'nonvat_booklet') = proof.get('PILI'), 'PILI: own non-VAT booklet + ISHABELLA''s VAT booklet');

select proof.as_user(proof.get('CASH')::uuid);
select proof.set('V1', pg_temp.sale('false'::jsonb, null)::text);
select proof.set('V2', pg_temp.sale('true'::jsonb, null)::text);
select proof.set('V3', pg_temp.sale('true'::jsonb, 'VAT-9001')::text);
select proof.set('V4', pg_temp.sale('false'::jsonb, 'NV-9001')::text);
select proof.set('V5', pg_temp.sale(null, 'OLD-9001')::text);
select proof.as_owner();
select proof.ok((select not vat_applied and vat_amount = 0 from storefront_sales where id = proof.get('V1')::uuid), 'Without VAT, DR only: no VAT');
select proof.ok((select vat_applied and vat_amount = round(120 * 12 / 112.0, 2) from storefront_sales where id = proof.get('V2')::uuid), 'With VAT, DR only: VAT 12/112 included (₱12.86)');
select proof.ok((select vat_applied and si_booklet_business_id = proof.get('ISH')::uuid from storefront_sales where id = proof.get('V3')::uuid), 'With VAT + SI: SI from ISHABELLA''s VAT booklet');
select proof.ok((select not vat_applied and si_booklet_business_id = proof.get('PILI')::uuid from storefront_sales where id = proof.get('V4')::uuid), 'Without VAT + SI: SI from PILI''s own non-VAT booklet');
select proof.ok((select not vat_applied from storefront_sales where id = proof.get('V5')::uuid), 'no choice sent: the booklet decides, as before (non-VAT booklet → no VAT)');

-- same SI number can be used once per booklet
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select pg_temp.sale('true'::jsonb, 'VAT-9001')$$, 'already used on this SI booklet', 'an SI number is checked per booklet');
select pg_temp.sale('false'::jsonb, 'VAT-9001');
select proof.ok(true, 'the same number on the other booklet is fine');

-- without a VAT booklet, With VAT + SI is refused (DR only still works)
select proof.as_user(proof.get('BA')::uuid);
select storefront_set_booklet2(null);
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select pg_temp.sale('true'::jsonb, 'VAT-9002')$$, 'no VAT-registered SI booklet', 'With VAT + SI without a VAT booklet is refused');
select proof.ok(pg_temp.sale('true'::jsonb, null) is not null, 'With VAT, DR only, still works');
rollback;
