-- Build 120 (Paste list: sizes kept, joined / split words) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
insert into finance_procurement_items(id, item_code, item_name, category, unit, standard_cost, item_type) values
  ('00000000-0000-0000-0000-0000012000a1', 'T120-1', 'SOFTDRAWN 1/4 X 50FT', 'Parts', 'pc', 1500, 'product'),
  ('00000000-0000-0000-0000-0000012000a2', 'T120-2', 'SOFTDRAWN 1/2 X 50FT', 'Parts', 'pc', 3500, 'product'),
  ('00000000-0000-0000-0000-0000012000a3', 'T120-3', 'SOFTDRAWN 3/8 X 50FT', 'Parts', 'pc', 2500, 'product'),
  ('00000000-0000-0000-0000-0000012000a4', 'T120-4', 'SOFTDRAWN 5/8 X 50FT', 'Parts', 'pc', 4500, 'product'),
  ('00000000-0000-0000-0000-0000012000a5', 'T120-5', 'CIRCUIT BREAKER 30A 2 POLE', 'Parts', 'pc', 400, 'product'),
  ('00000000-0000-0000-0000-0000012000a6', 'T120-6', 'RUBBER INSULATION 5/8 X 1 THICK', 'Parts', 'pc', 150, 'product');
select proof.ok(public.catalog_paste_phrase('Soft Drawn 1/4" x 0.71mm / 0.028" x 15M') = 'soft drawn 1/4 x 0.71mm 0.028 x 15m', 'sizes (1/4, 0.71) stay one word; stray dots and slashes go');
select proof.as_user('00000000-0000-0000-0000-000000000013');
create temp table m as select x from jsonb_array_elements(public.catalog_paste_match(
  '["Soft Drawn 1/4\" x 0.71mm / 0.028\" x 15M (standard)", "Soft Drawn 1/2\" x 0.71mm / 0.028\" x 15M (standard)", "Soft Drawn 3/8\" x 0.71mm / 0.028\" x 15M (standard)", "Soft Drawn 5/8\" x 0.71mm / 0.028\" x 15M (standard)", "Circuit Breaker 30amps/ 2-pole", "softdrawn 3/8", "Rubber Insulation 5/8\" diam x 1\" thick"]'::jsonb,
  proof.get('pili')::uuid)) x;
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 1) = 'T120-1', '"Soft Drawn 1/4" (DR wording) → SOFTDRAWN 1/4');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 2) = 'T120-2', '"Soft Drawn 1/2" → SOFTDRAWN 1/2');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 3) = 'T120-3', '"Soft Drawn 3/8" → SOFTDRAWN 3/8');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 4) = 'T120-4', '"Soft Drawn 5/8" → SOFTDRAWN 5/8, not the 5/8 rubber insulation');
select proof.ok((select (x->'candidates'->0->>'score')::int > (x->'candidates'->1->>'score')::int from m where (x->>'line')::int = 1), 'the right size scores above the other sizes');
select proof.ok((select x->'candidates'->0->'matched' ? 'soft' and x->'candidates'->0->'matched' ? 'drawn' from m where (x->>'line')::int = 1), '"soft" and "drawn" both found in SOFTDRAWN');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 5) = 'T120-5', '"Circuit Breaker 30amps/ 2-pole" → the 30A 2-pole breaker');
select proof.ok((select x->'candidates'->0->>'item_code' from m where (x->>'line')::int = 7) = 'T120-6', 'rubber insulation 5/8 → the insulation, not the 5/8 copper');
rollback;
