-- Build 90 (access by function) proof: run after the other proofs on the same database. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.ok((select count(*) from app_functions) = 20, 'the function list is loaded (12 Finance, 8 Sales)');

\echo == A. no limits = the whole section (as before)
select proof.as_user('00000000-0000-0000-0000-000000000015');   -- PILI finance
select proof.ok(public.has_function('finance.ap') and public.has_function('catalog.edit') and public.has_function('catalog.photos'), 'a Finance user with no limits holds every Finance function');
select proof.ok(not public.has_function('sales.counter'), 'but no Sales function (no Sales section)');
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- PILI cashier
select proof.ok(public.has_function('sales.counter') and public.has_function('sales.closing'), 'a cashier with no limits holds every Sales function');
select proof.ok(not public.has_function('finance.ap'), 'a cashier holds no Finance function');
select proof.ok(not public.has_function('nonsense.code'), 'an unknown function is never held');

\echo == B. who may set limits
select proof.fails($$insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000015', 'catalog.photos')$$, 'row-level security', 'a cashier cannot give functions');
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI business admin
insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000015', 'catalog.photos');
select proof.ok(exists (select 1 from user_functions where user_id = '00000000-0000-0000-0000-000000000015'), 'the Business Admin limits a Finance user of the same business');
select proof.fails($$insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000021', 'sales.counter')$$, 'row-level security', 'the PILI Business Admin cannot touch an ATON user');
select proof.fails($$insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000012', 'catalog.photos')$$, 'row-level security', 'nor another Business Admin');
select proof.fails($$insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000013', 'no.such')$$, 'foreign key', 'only listed functions can be given');

\echo == C. a photos-only user
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok((select count(*) from user_functions) = 1, 'the user sees his own limits');
select proof.ok(public.has_function('catalog.photos'), 'he holds Catalog photos');
select proof.ok(not public.has_function('catalog.edit') and not public.has_function('finance.ap') and not public.has_function('procurement.po'), 'and nothing else in Finance');
select proof.ok(public.can_search_catalog(), 'he can use Product Search');
select proof.ok((select count(*) from public.catalog_product_search(null, null, null, null, false, 5, 0)) >= 0, 'catalog_product_search runs for him');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.ok(not exists (select 1 from user_functions where user_id = '00000000-0000-0000-0000-000000000015'), 'a cashier does not see other people''s limits');

\echo == D. limits are per section; Catalog items & prices includes photos
select proof.as_user('00000000-0000-0000-0000-000000000011');
delete from user_functions where user_id = '00000000-0000-0000-0000-000000000015';
insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000015', 'catalog.edit'), ('00000000-0000-0000-0000-000000000015', 'finance.ap');
insert into user_functions(user_id, function_code) values ('00000000-0000-0000-0000-000000000013', 'sales.ar_collect');
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.ok(public.has_function('catalog.photos'), 'Catalog items & prices also allows photos');
select proof.ok(public.has_function('finance.ap') and not public.has_function('finance.payroll'), 'two functions given, others refused');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.ok(public.has_function('sales.ar_collect') and not public.has_function('sales.counter') and not public.has_function('sales.closing'), 'a cashier limited to receiving AR');
select proof.as_user('00000000-0000-0000-0000-000000000014');
select proof.ok(public.has_function('sales.counter'), 'another Sales user is not affected');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok(public.has_function('finance.payroll') and public.has_function('sales.counter'), 'Business Admin holds every function');
delete from user_functions where user_id = '00000000-0000-0000-0000-000000000013';
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.ok(public.has_function('sales.counter'), 'removing the limits gives the whole section back');

rollback;
