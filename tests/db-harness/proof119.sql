-- Build 119 (Paste list: match pasted lines to the catalog; remembered picks) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
insert into finance_procurement_items(id, item_code, item_name, category, unit, standard_cost, item_type, specification) values
  ('00000000-0000-0000-0000-0000011900a1', 'T119-1', 'EVAPORATOR, TOYOTA INNOVA 2005-2015 (OLD MODEL)', 'Parts', 'pc', 3000, 'product', null),
  ('00000000-0000-0000-0000-0000011900a2', 'T119-2', 'EVAPORATOR, TOYOTA INNOVA 2016-UP', 'Parts', 'pc', 3200, 'product', null),
  ('00000000-0000-0000-0000-0000011900a3', 'T119-3', 'CABIN FILTER, TOYOTA INNOVA', 'Parts', 'pc', 150, 'product', null),
  ('00000000-0000-0000-0000-0000011900a4', 'T119-4', 'EXPANSION VALVE, BLOCK TYPE', 'Parts', 'pc', 900, 'product', 'Part no. 9A96'),
  ('00000000-0000-0000-0000-0000011900a5', 'T119-5', 'EXPANSION VALVE, BLOCK TYPE, DENSO', 'Parts', 'pc', 950, 'product', 'Part no. 7B12');
select proof.as_user('00000000-0000-0000-0000-000000000013');
create temp table m as select x from jsonb_array_elements(public.catalog_paste_match('["innova evaporator old", "cabin innova", "exp valve 9a96", "Hi boss pa quote po", "zzzz qqqq"]'::jsonb, proof.get('pili')::uuid)) x;
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 1) = 'T119-1', '"innova evaporator old" → the old-model Innova evaporator first');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 2) = 'T119-3', '"cabin innova" → cabin filter, Toyota Innova');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 3) = 'T119-4', '"exp valve 9a96" → the 9A96 expansion valve (part number weighs most)');
select proof.ok((select (x->'candidates'->0->>'score')::int > (x->'candidates'->1->>'score')::int from m where (x->>'line')::int = 3), 'the 9A96 valve scores above the other valve');
select proof.ok((select x->'words' = '[]'::jsonb and x->'candidates' = '[]'::jsonb from m where (x->>'line')::int = 4), 'a greeting ("Hi boss pa quote po") has only filler words: nothing to match');
select proof.ok((select jsonb_array_length(x->'candidates') = 0 from m where (x->>'line')::int = 5), 'a line with nothing in the catalog has no candidates');
select proof.ok((select x->'candidates'->0->'missed' = '[]'::jsonb from m where (x->>'line')::int = 2), 'each candidate lists the words it matched / missed');

-- receiving: only the PO's items are offered
select proof.ok((select jsonb_agg(c->>'item_code') = '["T119-5"]'::jsonb from jsonb_array_elements(public.catalog_paste_match('["exp valve 9a96"]'::jsonb, proof.get('pili')::uuid,
                  array['00000000-0000-0000-0000-0000011900a5']::uuid[])->0->'candidates') c), 'limited to the PO''s items, the other valve is the only candidate');
select proof.ok((select x->'words' = '[]'::jsonb from jsonb_array_elements(public.catalog_paste_match('["TOTAL"]'::jsonb, proof.get('pili')::uuid)) x), 'DR footer words (TOTAL) are ignored');
-- remembered picks come first next time (per store)
select public.catalog_paste_remember(proof.get('pili')::uuid, '[{"phrase": "Innova evap", "item_id": "00000000-0000-0000-0000-0000011900a2"}]'::jsonb);
select proof.ok((public.catalog_paste_match('["innova evap"]'::jsonb, proof.get('pili')::uuid)->0->'candidates'->0->>'item_code') = 'T119-2'
                and (public.catalog_paste_match('["innova evap"]'::jsonb, proof.get('pili')::uuid)->0->'candidates'->0->>'remembered')::boolean, 'a remembered phrase matches the picked item first');
select proof.ok((public.catalog_paste_match('["innova evap"]'::jsonb, proof.get('aton')::uuid)->0->'candidates'->0->>'remembered')::boolean = false, 'remembered picks are per store');
select public.catalog_paste_remember(proof.get('pili')::uuid, '[{"phrase": "innova  EVAP", "item_id": "00000000-0000-0000-0000-0000011900a1"}]'::jsonb);
select proof.as_owner();
select proof.ok((select item_id = '00000000-0000-0000-0000-0000011900a1' and uses = 2 from catalog_paste_aliases where business_id = proof.get('pili')::uuid and phrase = 'innova evap'), 'picking again updates the remembered item (spacing and case ignored)');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.fails($$select * from catalog_paste_aliases$$, 'permission denied', 'the remembered list is read only through the matcher');
rollback;
