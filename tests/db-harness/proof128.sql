-- Build 128 (Sales Manager: Team / Sales / Client load in a read-only request) proof. Rolled back.
\set ON_ERROR_STOP 1
begin read only;
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok((public.manager_month(extract(year from current_date)::int, extract(month from current_date)::int)->>'total') is not null, 'Sales / Team: the month loads in a read-only request');
select proof.ok(jsonb_typeof(public.manager_team(extract(year from current_date)::int, extract(month from current_date)::int)) = 'array', 'Team list loads in a read-only request');
select proof.ok((public.manager_client((select id from finance_customers where business_id = public.current_business_id() limit 1))->>'name') is not null, 'Client page loads in a read-only request');
rollback;
