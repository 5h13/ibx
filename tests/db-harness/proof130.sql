-- Build 130 (sales history — one sale per DR, no item lines — counts in the Sales Manager app) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('cool', (select id::text from finance_customers where business_id = proof.get('pili')::uuid order by created_at limit 1));
select proof.set('loc', (select id::text from logistics_locations where business_id = proof.get('pili')::uuid order by created_at limit 1));
select proof.set('y', extract(year from (now() at time zone 'Asia/Manila'))::text);
select proof.set('m', extract(month from ((now() at time zone 'Asia/Manila') - interval '2 months'))::text);
select proof.set('y2', extract(year from ((now() at time zone 'Asia/Manila') - interval '2 months'))::text);
select proof.set('d', (date_trunc('month', (now() at time zone 'Asia/Manila') - interval '2 months')::date + 4)::text);

insert into storefront_sales(business_id, sale_number, status, customer_id, location_id, dr_number, subtotal, total, amount_paid, balance, sale_date)
values (proof.get('pili')::uuid, 'HIST-T-1', 'completed', proof.get('cool')::uuid, proof.get('loc')::uuid, 'PILI-DR-T-1', 12000, 12000, 12000, 0, proof.get('d')::date),
       (proof.get('pili')::uuid, 'HIST-T-2', 'completed', proof.get('cool')::uuid, proof.get('loc')::uuid, 'PILI-DR-T-2', 3500.50, 3500.50, 3500.50, 0, proof.get('d')::date + 1);

select proof.as_user('00000000-0000-0000-0000-000000000011');   -- Business Admin
select proof.ok((public.manager_month(proof.get('y2')::int, proof.get('m')::int)->>'total')::numeric
  = (select round(coalesce(sum(total), 0), 2) from storefront_sales where business_id = proof.get('pili')::uuid and status = 'completed'
       and date_trunc('month', sale_date) = date_trunc('month', proof.get('d')::date)),
  'the month total includes the sales recorded by DR total only (no item lines)');
select proof.ok((public.manager_month(proof.get('y2')::int, proof.get('m')::int)->>'total')::numeric >= 15500.50, 'both history DRs are counted');
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_month(proof.get('y2')::int, proof.get('m')::int)->'by_category') x
  where x->>'name' = 'Sales history' and (x->>'total')::numeric >= 15500.50 and x->'margin' = 'null'::jsonb), 'they show as "Sales history", with no margin (cost unknown)');
select proof.ok((select abs(sum((x->>'total')::numeric) - (public.manager_month(proof.get('y2')::int, proof.get('m')::int)->>'total')::numeric) < 0.05
  from jsonb_array_elements(public.manager_month(proof.get('y2')::int, proof.get('m')::int)->'by_client') x)
  or jsonb_array_length(public.manager_month(proof.get('y2')::int, proof.get('m')::int)->'by_client') = 12, 'the clients add up to the month (or the list is the top 12)');
select proof.ok(exists (select 1 from jsonb_array_elements(public.manager_month(proof.get('y2')::int, proof.get('m')::int)->'by_client') x
  where (x->>'id')::uuid = proof.get('cool')::uuid and (x->>'total')::numeric >= 15500.50), 'the history sales count for their client');
select proof.ok((select abs(sum((x->>'total')::numeric) - (public.manager_month(proof.get('y2')::int, proof.get('m')::int)->>'total')::numeric) < 0.05
  from jsonb_array_elements(public.manager_month(proof.get('y2')::int, proof.get('m')::int)->'by_channel') x), 'the channels add up to the month');
select proof.ok(not (public.manager_client(proof.get('cool')::uuid)->'lapsed') ? 'Sales history', 'the client page never says they stopped buying "Sales history"');
select proof.ok((public.manager_client(proof.get('cool')::uuid)->>'year')::numeric >= 15500.50 or proof.get('y2') <> proof.get('y'), 'the client''s year includes the history sales');
rollback;
