-- Build 138 (Add store, Copy pricing, readiness) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
-- give PILI some pricing to copy
insert into finance_catalog_category_pricing(business_id, category_id, addon_percent, active)
select proof.get('pili')::uuid, id, 15, true from finance_catalog_categories limit 2 on conflict (business_id, category_id) do update set addon_percent = 15, active = true;
insert into finance_catalog_item_pricing(business_id, item_id, markup_percent, active)
select proof.get('pili')::uuid, id, 25, true from finance_procurement_items where active limit 2 on conflict (business_id, item_id) do update set markup_percent = 25, active = true;
select proof.set('pcat', (select count(*)::text from finance_catalog_category_pricing where business_id = proof.get('pili')::uuid and active));
select proof.set('pitem', (select count(*)::text from finance_catalog_item_pricing where business_id = proof.get('pili')::uuid and active));

\echo == A. who can add a store
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.fails($$select public.business_add('{"code": "TALA", "legal_name": "Tala Trading"}')$$, 'Only the Super Admin', 'a Business Admin cannot add a store');
select proof.fails($$select public.business_copy_pricing(proof.get('pili')::uuid, proof.get('aton')::uuid, false)$$, 'Only the Super Admin', 'a Business Admin cannot copy pricing');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.business_add('{"code": "TALA", "legal_name": "Tala Trading"}')$$, 'Only the Super Admin', 'a cashier cannot add a store');

\echo == B. checks
select proof.as_user('00000000-0000-0000-0000-000000000001');   -- Super Admin
select proof.fails($$select public.business_add('{"code": "T", "legal_name": "x"}')$$, '2 to 12 letters', 'a code needs 2-12 letters or digits');
select proof.fails($$select public.business_add('{"code": "pili", "legal_name": "x"}')$$, 'already exists', 'codes are unique (any case)');
select proof.fails($$select public.business_add('{"code": "TALA"}')$$, 'legal', 'the legal name is required');

\echo == C. a new store with PILI pricing
select proof.set('tala', public.business_add(jsonb_build_object('code', 'tala', 'legal_name', 'Tala Trading Corp.', 'trade_name', 'TALA AIRCON',
   'address', 'Tala, Caloocan', 'phone', '0917 000 0000', 'vat_registered', true, 'copy_pricing_from', proof.get('pili')))::text);
select proof.as_owner();   -- read back across stores (the Super Admin sees one store at a time)
select proof.ok((select code = 'TALA' and trade_name = 'TALA AIRCON' and vat_registered and is_active from businesses where id = proof.get('tala')::uuid), 'the store is created, code in capitals');
select proof.ok(exists (select 1 from logistics_locations l join storefront_settings s on s.location_id = l.id where s.business_id = proof.get('tala')::uuid and l.business_id = proof.get('tala')::uuid), 'it has a main stock location set for the Storefront');
select proof.ok((select walk_in_customer_id is not null from storefront_settings where business_id = proof.get('tala')::uuid), 'it has a walk-in customer');
select proof.ok(exists (select 1 from business_operating_modes where business_id = proof.get('tala')::uuid and mode = 'full'), 'operating mode Full');
select proof.ok(exists (select 1 from agent_commission_settings where business_id = proof.get('tala')::uuid) and exists (select 1 from hr_store_settings where business_id = proof.get('tala')::uuid), 'commission and HR settings exist');
select proof.ok((select count(*) from finance_chart_of_accounts where business_id = proof.get('tala')::uuid) = (select count(*) from finance_chart_of_accounts where business_id = proof.get('pili')::uuid), 'it has the full chart of accounts (same codes as PILI)');
select proof.ok(exists (select 1 from finance_chart_of_accounts where business_id = proof.get('tala')::uuid and account_code = '1040') and exists (select 1 from finance_chart_of_accounts where business_id = proof.get('tala')::uuid and account_code = '5400'), 'including Checks on Hand and Sales Commission');
select proof.ok((select count(*) from finance_bank_accounts f join finance_chart_of_accounts c on c.id = f.gl_account_id and c.business_id = f.business_id where f.business_id = proof.get('tala')::uuid and f.account_code like 'SF-%') = 3, 'counter cash, card and check accounts, linked to its own ledger accounts');
select proof.ok((select count(*) from agent_commission_brackets where business_id = proof.get('tala')::uuid) = 10, 'standard commission brackets');
select proof.ok(exists (select 1 from finance_bank_accounts where business_id = proof.get('tala')::uuid and is_cash_on_hand), 'it has a Cash on hand account');
select proof.ok(exists (select 1 from months where business_id = proof.get('tala')::uuid), 'the current month exists');
select proof.ok((select slug = 'tala' and not enabled from shop_settings where business_id = proof.get('tala')::uuid), 'its shop is /shop/tala, switched off');
select proof.ok((select count(*) from finance_catalog_category_pricing where business_id = proof.get('tala')::uuid and active)::text = proof.get('pcat')
            and (select count(*) from finance_catalog_item_pricing where business_id = proof.get('tala')::uuid and active)::text = proof.get('pitem'), 'PILI add-ons and markups were copied');
select proof.ok((select count(*) from audit_log where entity_id = proof.get('tala')::uuid) = 2, 'creation and pricing copy are in the audit log');
select proof.ok(exists (select 1 from users where business_id = proof.get('tala')::uuid) or exists (select 1 from sales_agents where business_id = proof.get('tala')::uuid), 'the store''s house agent was made');
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.fails($$select public.business_add('{"code": "TALA", "legal_name": "again"}')$$, 'already exists', 'the same code cannot be added twice');

\echo == D. copy pricing to an existing store
select proof.as_owner(); update finance_catalog_category_pricing set addon_percent = 99 where business_id = proof.get('tala')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.ok((public.business_copy_pricing(proof.get('pili')::uuid, proof.get('tala')::uuid, false)->>'categories')::int = 0, 'without overwrite the store keeps its own add-ons');
select proof.as_owner();
select proof.ok((select bool_and(addon_percent = 99) from finance_catalog_category_pricing where business_id = proof.get('tala')::uuid), '... and they stay at 99%');
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.ok((public.business_copy_pricing(proof.get('pili')::uuid, proof.get('tala')::uuid, true)->>'categories')::text = proof.get('pcat'), 'with overwrite they are replaced');
select proof.as_owner();
select proof.ok(not exists (select 1 from finance_catalog_category_pricing t join finance_catalog_category_pricing s on s.category_id = t.category_id and s.business_id = proof.get('pili')::uuid
   where t.business_id = proof.get('tala')::uuid and t.addon_percent <> s.addon_percent), '... back to PILI''s add-ons');
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.fails($$select public.business_copy_pricing(proof.get('pili')::uuid, proof.get('pili')::uuid, true)$$, 'two different', 'cannot copy a store onto itself');

\echo == E. readiness
select proof.ok((public.business_readiness(proof.get('tala')::uuid)->>'location')::boolean and not (public.business_readiness(proof.get('tala')::uuid)->>'business_admin')::boolean
   and (public.business_readiness(proof.get('tala')::uuid)->>'pricing')::int > 0, 'readiness: location yes, pricing yes, no Business Admin yet');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.business_readiness(proof.get('tala')::uuid)$$, 'Access denied', 'another store''s admin cannot see its readiness');
rollback;
