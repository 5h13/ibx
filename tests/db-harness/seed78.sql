-- Base data for the Build 78 proofs (run as the database owner after replay.sh).
-- Fixed ids so proofs can refer to them.
\set ON_ERROR_STOP 1
begin;
-- businesses (from the A001 seed): PILI, ATON
create temp table ids(k text primary key, v uuid);
insert into ids select 'PILI', id from businesses where code='PILI';
insert into ids select 'ATON', id from businesses where code='ATON';

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-000000000001','sa@test'),
 ('00000000-0000-0000-0000-000000000011','pili.ba@test'),
 ('00000000-0000-0000-0000-000000000012','pili.ba2@test'),
 ('00000000-0000-0000-0000-000000000013','pili.cashier@test'),
 ('00000000-0000-0000-0000-000000000014','pili.salesapp@test'),
 ('00000000-0000-0000-0000-000000000015','pili.finance@test'),
 ('00000000-0000-0000-0000-000000000016','pili.logistics@test'),
 ('00000000-0000-0000-0000-000000000017','pili.logapp@test'),
 ('00000000-0000-0000-0000-000000000021','aton.cashier@test'),
 ('00000000-0000-0000-0000-000000000022','aton.salesapp@test');
insert into users(id, email, full_name, role, business_id, acting_business_id) values
 ('00000000-0000-0000-0000-000000000001','sa@test','Super Admin','super_admin',null,(select v from ids where k='PILI')),
 ('00000000-0000-0000-0000-000000000011','pili.ba@test','Pili Admin','business_admin',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000012','pili.ba2@test','Pili Admin Two','business_admin',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000013','pili.cashier@test','Pili Cashier','sales',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000014','pili.salesapp@test','Pili Sales Approver','sales',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000015','pili.finance@test','Pili Finance','finance',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000016','pili.logistics@test','Pili Logistics','logistics',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000017','pili.logapp@test','Pili Logistics Approver','logistics',(select v from ids where k='PILI'),null),
 ('00000000-0000-0000-0000-000000000021','aton.cashier@test','Aton Cashier','sales',(select v from ids where k='ATON'),null),
 ('00000000-0000-0000-0000-000000000022','aton.salesapp@test','Aton Sales Approver','sales',(select v from ids where k='ATON'),null);
insert into user_access(user_id, section_id, workflow_role)
select u::uuid, s.id, r::workflow_role from (values
 ('00000000-0000-0000-0000-000000000013','sales','preparer'),
 ('00000000-0000-0000-0000-000000000014','sales','approver'),
 ('00000000-0000-0000-0000-000000000015','finance','preparer'),
 ('00000000-0000-0000-0000-000000000015','finance','approver'),
 ('00000000-0000-0000-0000-000000000016','logistics','preparer'),
 ('00000000-0000-0000-0000-000000000017','logistics','approver'),
 ('00000000-0000-0000-0000-000000000021','sales','preparer'),
 ('00000000-0000-0000-0000-000000000022','sales','approver')) x(u, sec, r)
join sections s on s.code = x.sec;

-- locations
insert into logistics_locations(id, business_id, location_code, location_name, location_type) values
 ('10000000-0000-0000-0000-000000000001',(select v from ids where k='PILI'),'PILI-ST','Pili Store','store'),
 ('10000000-0000-0000-0000-000000000002',(select v from ids where k='PILI'),'PILI-WH','Pili Warehouse','warehouse'),
 ('10000000-0000-0000-0000-000000000003',(select v from ids where k='ATON'),'ATON-ST','Aton Store','store');

-- catalog masters, suppliers, items
insert into finance_catalog_units(name) values ('pc') on conflict do nothing;
insert into finance_catalog_categories(id, name) values ('20000000-0000-0000-0000-000000000001','Parts'),('20000000-0000-0000-0000-000000000002','Refrigerant');
insert into finance_suppliers(id, legal_name) values ('30000000-0000-0000-0000-000000000001','Alpha Supply Co.'),('30000000-0000-0000-0000-000000000002','Beta Trading');
insert into finance_procurement_items(id, item_name, category, unit, standard_cost, item_type, brand, default_supplier_id) values
 ('40000000-0000-0000-0000-000000000001','Capacitor 35uF','Parts','pc',40,'product','Acme','30000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','R32 Refrigerant 3kg','Refrigerant','pc',1000,'product','Coolco','30000000-0000-0000-0000-000000000002'),
 ('40000000-0000-0000-0000-000000000003','Fan Motor','Parts','pc',500,'product','Acme','30000000-0000-0000-0000-000000000002');
-- PILI pricing: Parts +5% add-on, 30% markup on the capacitor and fan motor; Refrigerant +0%, 20%
insert into finance_catalog_category_pricing(business_id, category_id, addon_percent) values
 ((select v from ids where k='PILI'),'20000000-0000-0000-0000-000000000001',5),
 ((select v from ids where k='PILI'),'20000000-0000-0000-0000-000000000002',0),
 ((select v from ids where k='ATON'),'20000000-0000-0000-0000-000000000001',5);
insert into finance_catalog_item_pricing(business_id, item_id, markup_percent) values
 ((select v from ids where k='PILI'),'40000000-0000-0000-0000-000000000001',30),
 ((select v from ids where k='PILI'),'40000000-0000-0000-0000-000000000002',20),
 ((select v from ids where k='PILI'),'40000000-0000-0000-0000-000000000003',30),
 ((select v from ids where k='ATON'),'40000000-0000-0000-0000-000000000001',30);
commit;
