-- Build 107 (catalogue search by words) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('b', (select id::text from businesses where code = 'PILI'));
insert into finance_procurement_items(id, item_code, item_name, category, brand, generic_item) values
  ('00000000-0000-0000-0000-0000010700a1', 'T107-1', 'BLOWER MOTOR, TOYOTA INNOVA', 'Parts', 'DENSO', 'Blower motor'),
  ('00000000-0000-0000-0000-0000010700a2', 'T107-2', 'BLOWER MOTOR, TOYOTA VIOS', 'Parts', 'DENSO', 'Blower motor'),
  ('00000000-0000-0000-0000-0000010700a3', 'T107-3', 'COMPRESSOR, TOYOTA INNOVA', 'Parts', 'SANDEN', 'Compressor');
create or replace function pg_temp.hits(p_q text) returns text language sql as $$
  select coalesce(string_agg(item_code, ',' order by item_code), '') from public.catalog_product_search_for(proof.get('b')::uuid, p_q, null, null, null, false, 100, 0) where item_code like 'T107-%' $$;
select proof.ok(pg_temp.hits('blower inno') = 'T107-1', '"blower inno" finds the Innova blower motor only');
select proof.ok(pg_temp.hits('inno blower') = 'T107-1', 'words in any order');
select proof.ok(pg_temp.hits('innova') = 'T107-1,T107-3', 'one word finds every Innova item');
select proof.ok(pg_temp.hits('toyota denso') = 'T107-1,T107-2', 'name and brand together');
select proof.ok(pg_temp.hits('blower motor, toyota in') = 'T107-1', 'the long way still works');
select proof.ok(pg_temp.hits('blower city') = '', 'a word that matches nothing narrows to nothing');
select proof.ok(pg_temp.hits('t107-3') = 'T107-3', 'item code');
rollback;
