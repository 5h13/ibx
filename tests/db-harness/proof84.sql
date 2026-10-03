-- Build 84 (cascading catalog filters) proof: each pick-list narrows to the other selections. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
insert into finance_procurement_items(item_code, item_name, category, generic_item, brand, default_supplier_id, active) values
 ('C84-1','Split aircon 1HP','Parts','Aircon','Carrier','30000000-0000-0000-0000-000000000001', true),
 ('C84-2','Window aircon','Parts','Aircon','Koppel','30000000-0000-0000-0000-000000000002', true),
 ('C84-3','R32 tank','Refrigerant','Gas tank','Koppel', null, true),
 ('C84-4','Old compressor','Refrigerant','Compressor','Tecumseh', null, false);
select proof.as_user('00000000-0000-0000-0000-000000000015');
\echo == A. no selection lists everything active
select proof.ok((select count(*) from catalog_filter_values() where kind='brand' and value in ('Carrier','Koppel')) = 2, 'all brands of active items');
select proof.ok(not exists (select 1 from catalog_filter_values() where value = 'Tecumseh'), 'inactive items are not offered');
\echo == B. cascade
select proof.ok((select string_agg(value, ',' order by value) from catalog_filter_values('Refrigerant') where kind='item') = 'Gas tank', 'category Refrigerant -> items: Gas tank only');
select proof.ok((select string_agg(value, ',' order by value) from catalog_filter_values('Parts', 'aircon') where kind='brand' and value in ('Carrier','Koppel')) = 'Carrier,Koppel', 'Parts + item "aircon" (typed, any case) -> brands Carrier, Koppel');
select proof.ok((select string_agg(value, ',' order by value) from catalog_filter_values(null, null, 'Koppel') where kind='category') = 'Parts,Refrigerant', 'brand Koppel -> categories Parts, Refrigerant');
select proof.ok((select count(*) from catalog_filter_values('Refrigerant', null, null) where kind='category') >= 2, 'the category list ignores its own selection (can still switch category)');
select proof.ok((select string_agg(value, ',') from catalog_filter_values(null, null, 'Koppel', '30000000-0000-0000-0000-000000000002') where kind='item') = 'Aircon', 'supplier + brand -> items narrowed');
select proof.ok((select string_agg(value, ',') from catalog_filter_values(null, null, null, 'none') where kind='item' and value in ('Aircon','Gas tank')) = 'Gas tank', 'supplier "No supplier" -> only items without one');
select proof.ok((select string_agg(value, ',' order by value) from catalog_filter_values('Parts') where kind='supplier') like '%30000000-0000-0000-0000-000000000002%', 'suppliers narrowed by category');
select proof.ok((select count(*) from catalog_filter_values(null, '50%_\', null, 'not-a-uuid')) >= 0, 'wildcards and a bad supplier id are harmless');
\echo == Build 84 proof passed
rollback;
