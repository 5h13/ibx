-- Build 127 — Sales Manager phone app (/manager).
-- For Sales approvers (and the Business Admin): today, approvals, team against monthly targets,
-- the month's sales by category / client / channel, a client's purchases, and collections with
-- payment promises. Sales = completed counter / agent sales (storefront) less returns, by date;
-- margin is on sales without VAT. Sales under the store's own house agent count as counter
-- sales. Everything is for the store being worked in (current_business_id).

-- ------------------------------------------------------------------ access --
create or replace function public.manager_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or public.has_workflow_role((select id from public.sections where code = 'sales'), 'approver');
$$;
revoke all on function public.manager_access() from public;
grant execute on function public.manager_access() to authenticated;

-- ----------------------------------------------------------------- targets --
create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  year int not null check (year between 2000 and 2100),
  month int not null check (month between 1 and 12),
  agent_id uuid references public.sales_agents(id),
  user_id uuid references public.users(id),
  amount numeric(14,2) not null check (amount >= 0),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  check (agent_id is null or user_id is null)
);
-- one target per store-month (no person), per agent and per counter person
create unique index if not exists sales_targets_one on public.sales_targets
  (business_id, year, month, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.sales_targets enable row level security;
drop policy if exists sales_targets_read on public.sales_targets;
create policy sales_targets_read on public.sales_targets for select
  using ((public.is_super_admin() or business_id = public.current_business_id()) and (public.manager_access() or public.has_section_access('sales')));
grant select on public.sales_targets to authenticated;

create or replace function public.manager_set_target(p_year int, p_month int, p_agent uuid, p_user uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_id uuid;
begin
  if not public.manager_access() then raise exception 'Only the Sales Manager or the Business Admin sets targets.'; end if;
  if v_b is null then raise exception 'Select a store in "Acting as" first.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the target (₱0 or more).'; end if;
  if p_agent is not null and p_user is not null then raise exception 'A target is for one agent or one counter person.'; end if;
  if p_agent is not null and not exists (select 1 from public.sales_agents where id = p_agent) then raise exception 'Agent not found.'; end if;
  if p_user is not null and not exists (select 1 from public.users where id = p_user and business_id = v_b) then raise exception 'Person not found in this store.'; end if;
  select id into v_id from public.sales_targets where business_id = v_b and year = p_year and month = p_month
     and agent_id is not distinct from p_agent and user_id is not distinct from p_user;
  if v_id is null then
    insert into public.sales_targets(business_id, year, month, agent_id, user_id, amount, updated_by) values (v_b, p_year, p_month, p_agent, p_user, round(p_amount, 2), auth.uid()) returning id into v_id;
  else
    update public.sales_targets set amount = round(p_amount, 2), updated_by = auth.uid(), updated_at = now() where id = v_id;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_targets', v_id, 'edited', jsonb_build_object('year', p_year, 'month', p_month, 'agent_id', p_agent, 'user_id', p_user, 'amount', p_amount));
end $$;
revoke all on function public.manager_set_target(int, int, uuid, uuid, numeric) from public;
grant execute on function public.manager_set_target(int, int, uuid, uuid, numeric) to authenticated;

-- ------------------------------------------------------- collection promises --
create table if not exists public.collection_promises (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  customer_id uuid not null references public.finance_customers(id),
  promise_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists collection_promises_customer on public.collection_promises(customer_id, created_at desc);
alter table public.collection_promises enable row level security;
drop policy if exists collection_promises_read on public.collection_promises;
create policy collection_promises_read on public.collection_promises for select
  using ((public.is_super_admin() or business_id = public.current_business_id()) and (public.manager_access() or public.has_section_access('sales') or public.has_section_access('finance')));
grant select on public.collection_promises to authenticated;

create or replace function public.manager_log_promise(p_customer uuid, p_date date, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_id uuid;
begin
  if not public.manager_access() then raise exception 'Access denied.'; end if;
  if not exists (select 1 from public.finance_customers where id = p_customer and business_id = v_b) then raise exception 'Client not found in this store.'; end if;
  if p_date is null or p_date < (now() at time zone 'Asia/Manila')::date then raise exception 'The promised date must be today or later.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the promised amount.'; end if;
  insert into public.collection_promises(business_id, customer_id, promise_date, amount, note, created_by)
  values (v_b, p_customer, p_date, round(p_amount, 2), nullif(btrim(coalesce(p_note, '')), ''), auth.uid()) returning id into v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'collection_promises', v_id, 'created', jsonb_build_object('customer_id', p_customer, 'date', p_date, 'amount', p_amount));
  return v_id;
end $$;
revoke all on function public.manager_log_promise(uuid, date, numeric, text) from public;
grant execute on function public.manager_log_promise(uuid, date, numeric, text) to authenticated;

-- ------------------------------------------------------------- sales lines --
-- One row per completed sale line (positive) and per return (negative), with its category.
-- agent_id is null for counter sales (including sales under the store's own house agent).
create or replace function public.manager_sales_lines(p_business uuid, p_from date, p_to date)
returns table(day date, sale_id uuid, customer_id uuid, agent_id uuid, staff_id uuid, online boolean, category text, amount numeric, net numeric, cost numeric)
language sql stable security definer set search_path = public as $$
  with sales as (
    select s.* from public.storefront_sales s
     where s.business_id = p_business and s.status = 'completed' and s.sale_date between p_from and p_to
  )
  select s.sale_date, s.id, s.customer_id, case when a.id is null then null else s.agent_id end, s.created_by, coalesce(a.online, false),
         coalesce(nullif(btrim(i.category), ''), 'Uncategorised'),
         -- the sale's total (VAT, any whole-sale discount) spread over its lines by line value
         case when sum(si.line_total) over (partition by s.id) <> 0 then si.line_total / sum(si.line_total) over (partition by s.id) * s.total else s.total / count(*) over (partition by s.id) end,
         case when sum(si.line_total) over (partition by s.id) <> 0 then si.line_total / sum(si.line_total) over (partition by s.id) * (s.total - coalesce(s.vat_amount, 0)) else (s.total - coalesce(s.vat_amount, 0)) / count(*) over (partition by s.id) end,
         coalesce(si.unit_cost, si.acquisition_cost, 0) * si.quantity
    from sales s join public.storefront_sale_items si on si.sale_id = s.id
    left join public.finance_procurement_items i on i.id = si.item_id
    left join public.sales_agents a on a.id = s.agent_id and a.kind <> 'store'
  union all
  select r.return_date, s.id, s.customer_id, case when a.id is null then null else s.agent_id end, s.created_by, coalesce(a.online, false), 'Returns',
         -r.total, -(r.total - coalesce(r.vat_amount, 0)), -coalesce(r.cost_total, 0)
    from public.storefront_returns r join public.storefront_sales s on s.id = r.sale_id
    left join public.sales_agents a on a.id = s.agent_id and a.kind <> 'store'
   where r.business_id = p_business and r.return_date between p_from and p_to;
$$;
revoke all on function public.manager_sales_lines(uuid, date, date) from public;

create or replace function public.manager_store_target(p_business uuid, p_year int, p_month int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select amount from public.sales_targets where business_id = p_business and year = p_year and month = p_month and agent_id is null and user_id is null),
    nullif((select sum(amount) from public.sales_targets where business_id = p_business and year = p_year and month = p_month and (agent_id is not null or user_id is not null)), 0));
$$;
revoke all on function public.manager_store_target(uuid, int, int) from public;

-- Receivables per client: open invoices, overdue part, oldest overdue due date.
create or replace function public.manager_ar(p_business uuid)
returns table(customer_id uuid, owed numeric, overdue numeric, invoices int, oldest_due date)
language sql stable security definer set search_path = public as $$
  select i.customer_id, sum(i.balance_due), sum(i.balance_due) filter (where i.due_date < (now() at time zone 'Asia/Manila')::date),
         count(*)::int, min(i.due_date) filter (where i.due_date < (now() at time zone 'Asia/Manila')::date)
    from public.finance_customer_invoices i
   where i.business_id = p_business and coalesce(i.balance_due, 0) > 0 and i.status::text not in ('draft', 'voided', 'paid')
   group by i.customer_id;
$$;
revoke all on function public.manager_ar(uuid) from public;

create or replace function public.manager_approval_counts(p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'quotes', (select count(*) from public.sales_quotations where business_id = p_business and status::text in ('prepared', 'reviewed')),
    'orders', (select count(*) from public.sales_orders where business_id = p_business and status::text in ('prepared', 'reviewed')),
    'prices', (select count(*) from public.storefront_sales where business_id = p_business and status = 'pending_approval'),
    'cancels', (select count(*) from public.storefront_sales where business_id = p_business and cancel_status = 'requested'),
    'closings', (select count(*) from public.storefront_closings where business_id = p_business and status = 'submitted'));
$$;
revoke all on function public.manager_approval_counts(uuid) from public;

-- ------------------------------------------------------------------- today --
create or replace function public.manager_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_today date := (now() at time zone 'Asia/Manila')::date;
        v_m0 date := date_trunc('month', (now() at time zone 'Asia/Manila'))::date; v_today_sales numeric; v_avg numeric; v_mtd numeric; v_target numeric;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return jsonb_build_object('no_store', true); end if;
  select coalesce(sum(amount), 0) into v_today_sales from public.manager_sales_lines(v_b, v_today, v_today);
  -- the same weekday over the last 4 weeks
  select avg(t) into v_avg from (select coalesce(sum(l.amount), 0) t from generate_series(1, 4) w
     left join lateral public.manager_sales_lines(v_b, v_today - 7 * w, v_today - 7 * w) l on true group by w) x;
  select coalesce(sum(amount), 0) into v_mtd from public.manager_sales_lines(v_b, v_m0, v_today);
  v_target := public.manager_store_target(v_b, extract(year from v_today)::int, extract(month from v_today)::int);
  return jsonb_build_object(
    'date', v_today,
    'sales_today', round(v_today_sales, 2),
    'same_day_avg', round(coalesce(v_avg, 0), 2),
    'collected_today', (select round(coalesce(sum(amount), 0), 2) from public.storefront_payments
                         where business_id = v_b and kind in ('sale', 'ar_collection') and (received_at at time zone 'Asia/Manila')::date = v_today),
    'mtd', round(v_mtd, 2), 'target', v_target,
    'approvals', public.manager_approval_counts(v_b),
    'first_approval', (select jsonb_build_object('kind', 'quote', 'id', q.id, 'number', q.quotation_number, 'client', coalesce(c.trade_name, c.legal_name), 'amount', q.total_amount,
                              'below_floor', (select count(*) from public.sales_quotation_items qi where qi.quotation_id = q.id and qi.below_floor))
                         from public.sales_quotations q left join public.finance_customers c on c.id = q.customer_id
                        where q.business_id = v_b and q.status::text in ('prepared', 'reviewed')
                        order by (select count(*) from public.sales_quotation_items qi where qi.quotation_id = q.id and qi.below_floor) desc, q.total_amount desc limit 1),
    'team', coalesce((select jsonb_agg(t order by (t->>'total')::numeric desc) from (
                select jsonb_build_object('kind', case when g.agent_id is not null then 'Agent' else 'Counter' end,
                         'name', coalesce(a.name, u.full_name, u.username, 'Counter'), 'total', round(g.total, 2), 'count', g.cnt) t
                  from (select agent_id, case when agent_id is null then staff_id end staff, sum(amount) total, count(distinct sale_id) cnt
                          from public.manager_sales_lines(v_b, v_today, v_today) group by 1, 2) g
                  left join public.sales_agents a on a.id = g.agent_id left join public.users u on u.id = g.staff) x), '[]'::jsonb),
    'closing_today', (select status from public.storefront_closings where business_id = v_b and closing_date = v_today and status <> 'returned' limit 1),
    'overdue', (select jsonb_build_object('amount', round(coalesce(sum(overdue), 0), 2), 'clients', count(*) filter (where overdue > 0)) from public.manager_ar(v_b)));
end $$;
revoke all on function public.manager_today() from public;
grant execute on function public.manager_today() to authenticated;

-- ------------------------------------------------------------------- month --
create or replace function public.manager_month(p_year int, p_month int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_from date := make_date(p_year, p_month, 1);
        v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_end date; v_total numeric; v_net numeric; v_cost numeric;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return jsonb_build_object('no_store', true); end if;
  v_end := least(v_to, v_today);
  create temp table if not exists mgr_lines on commit drop as select * from public.manager_sales_lines(v_b, v_from, v_end) limit 0;
  delete from mgr_lines;
  insert into mgr_lines select * from public.manager_sales_lines(v_b, v_from, v_end);
  select coalesce(sum(amount), 0), coalesce(sum(net), 0), coalesce(sum(cost), 0) into v_total, v_net, v_cost from mgr_lines;
  create temp table if not exists mgr_prev on commit drop as select null::uuid customer_id, 0::numeric total limit 0;
  delete from mgr_prev;
  insert into mgr_prev select customer_id, sum(amount) from public.manager_sales_lines(v_b, (v_from - interval '1 month')::date, (v_from - 1)) group by customer_id;
  create temp table if not exists mgr_arx on commit drop as select * from public.manager_ar(v_b) limit 0;
  delete from mgr_arx;
  insert into mgr_arx select * from public.manager_ar(v_b);
  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'through', v_end, 'days_in_month', extract(day from v_to)::int, 'days_gone', greatest(0, (v_end - v_from) + 1),
    'total', round(v_total, 2), 'margin', case when v_net > 0 then round((v_net - v_cost) / v_net * 100, 1) end,
    'target', public.manager_store_target(v_b, p_year, p_month),
    'days', (select jsonb_agg(jsonb_build_object('d', d::date, 'total', round(coalesce((select sum(amount) from mgr_lines where day = d::date), 0), 2)) order by d)
               from generate_series(v_from, v_end, interval '1 day') d),
    'by_category', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
        select jsonb_build_object('name', category, 'total', round(sum(amount), 2),
               'margin', case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end) x
          from mgr_lines group by category) c), '[]'::jsonb),
    'by_channel', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
        select jsonb_build_object('name', ch, 'total', round(sum(amount), 2), 'margin', case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end) x
          from (select case when agent_id is null then 'Counter' when online then 'Online' else 'Agents' end ch, amount, net, cost from mgr_lines) y group by ch) c), '[]'::jsonb),
    'by_client', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
        select jsonb_build_object('id', l.customer_id, 'name', coalesce(c.trade_name, c.legal_name, 'Walk-in (no account)'), 'total', round(sum(l.amount), 2),
               'margin', case when sum(l.net) > 0 then round((sum(l.net) - sum(l.cost)) / sum(l.net) * 100, 1) end,
               'sales', count(distinct l.sale_id), 'last', max(l.day), 'agent', max(a.name),
               'prev', (select round(coalesce(sum(p.total), 0), 2) from mgr_prev p where p.customer_id is not distinct from l.customer_id),
               'overdue', (select round(coalesce(ar.overdue, 0), 2) from mgr_arx ar where ar.customer_id = l.customer_id)) x
          from mgr_lines l left join public.finance_customers c on c.id = l.customer_id
          left join public.sales_agents a on a.id = c.agent_id and a.kind <> 'store'
         group by l.customer_id, c.trade_name, c.legal_name order by sum(l.amount) desc limit 12) c), '[]'::jsonb),
    'open_quotes', (select jsonb_build_object('total', round(coalesce(sum(total_amount), 0), 2), 'count', count(*), 'older7', count(*) filter (where quotation_date < v_today - 7))
                      from public.sales_quotations where business_id = v_b and status::text in ('draft', 'prepared', 'reviewed', 'approved', 'sent')),
    'orders_open', (select jsonb_build_object('total', round(coalesce(sum(total_amount), 0), 2), 'count', count(*))
                      from public.sales_orders where business_id = v_b and status::text in ('approved', 'processing')));
end $$;
revoke all on function public.manager_month(int, int) from public;
grant execute on function public.manager_month(int, int) to authenticated;

-- -------------------------------------------------------------------- team --
create or replace function public.manager_team(p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_from date := make_date(p_year, p_month, 1);
        v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(p order by (p->>'total')::numeric desc) from (
    -- agents of this store (active, or with sales this month)
    select jsonb_build_object('kind', case when a.online then 'Online' else 'Agent' end, 'agent_id', a.id, 'user_id', null, 'name', a.name, 'phone', a.phone,
             'total', round(coalesce(s.total, 0), 2), 'sales', coalesce(s.sales, 0), 'clients', coalesce(s.clients, 0), 'last', s.last,
             'target', (select amount from public.sales_targets t where t.business_id = v_b and t.year = p_year and t.month = p_month and t.agent_id = a.id)) p
      from public.sales_agents a
      left join (select agent_id, sum(amount) total, count(distinct sale_id) sales, count(distinct customer_id) clients, max(day) last
                   from public.manager_sales_lines(v_b, v_from, v_to) where agent_id is not null group by agent_id) s on s.agent_id = a.id
     where a.kind <> 'store' and (a.home_business_id = v_b or s.agent_id is not null) and (a.active or s.agent_id is not null)
    union all
    -- counter staff: who rang the sales
    select jsonb_build_object('kind', 'Counter', 'agent_id', null, 'user_id', u.id, 'name', coalesce(u.full_name, u.username), 'phone', null,
             'total', round(s.total, 2), 'sales', s.sales, 'clients', s.clients, 'last', s.last,
             'target', (select amount from public.sales_targets t where t.business_id = v_b and t.year = p_year and t.month = p_month and t.user_id = u.id))
      from (select staff_id, sum(amount) total, count(distinct sale_id) sales, count(distinct customer_id) clients, max(day) last
              from public.manager_sales_lines(v_b, v_from, v_to) where agent_id is null group by staff_id) s
      join public.users u on u.id = s.staff_id
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.manager_team(int, int) from public;
grant execute on function public.manager_team(int, int) to authenticated;

-- ------------------------------------------------------------------ client --
create or replace function public.manager_client(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); c record; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_m0 date := date_trunc('month', (now() at time zone 'Asia/Manila'))::date; v_y0 date := date_trunc('year', (now() at time zone 'Asia/Manila'))::date;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  select * into c from public.finance_customers where id = p_customer and business_id = v_b;
  if not found then raise exception 'Client not found in this store.'; end if;
  create temp table if not exists mgr_client on commit drop as select * from public.manager_sales_lines(v_b, v_today, v_today) limit 0;
  delete from mgr_client;
  insert into mgr_client select * from public.manager_sales_lines(v_b, (v_m0 - interval '11 months')::date, v_today) where customer_id = p_customer;
  return jsonb_build_object(
    'id', c.id, 'name', coalesce(c.trade_name, c.legal_name), 'phone', c.phone, 'contact', c.contact_person, 'terms', c.payment_terms, 'since', c.created_at::date,
    'credit_limit', c.credit_limit, 'agent', (select name from public.sales_agents where id = c.agent_id and kind <> 'store'),
    'month', round(coalesce((select sum(amount) from mgr_client where day >= v_m0), 0), 2),
    'prev_month', round(coalesce((select sum(amount) from mgr_client where day >= (v_m0 - interval '1 month')::date and day < v_m0), 0), 2),
    'year', round(coalesce((select sum(amount) from mgr_client where day >= v_y0), 0), 2),
    'year_margin', (select case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end from mgr_client where day >= v_y0),
    'ar', (select jsonb_build_object('owed', round(coalesce(owed, 0), 2), 'overdue', round(coalesce(overdue, 0), 2), 'invoices', invoices, 'oldest_due', oldest_due) from public.manager_ar(v_b) where customer_id = p_customer),
    'months', (select jsonb_agg(jsonb_build_object('m', to_char(m, 'Mon'), 'total', round(coalesce((select sum(amount) from mgr_client where date_trunc('month', day) = m), 0), 2)) order by m)
                 from generate_series((v_m0 - interval '5 months'), v_m0, interval '1 month') m),
    'categories', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
        select jsonb_build_object('name', category, 'total', round(sum(amount), 2)) x from mgr_client where day >= v_y0 and category <> 'Returns' group by category) y), '[]'::jsonb),
    -- bought in at least 3 of the 6 months before the last 60 days, nothing since
    'lapsed', coalesce((select jsonb_agg(category) from (
        select category from mgr_client where category not in ('Returns', 'Uncategorised')
         group by category
        having count(distinct date_trunc('month', day)) filter (where day >= v_today - 240 and day < v_today - 60) >= 3
           and count(*) filter (where day >= v_today - 60) = 0) z), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r order by r->>'date' desc) from (
        select jsonb_build_object('kind', 'sale', 'number', coalesce(s.dr_number, s.si_number, s.sale_number), 'date', s.sale_date, 'total', s.total, 'balance', s.balance,
                 'items', (select string_agg(si.description || ' × ' || trim(to_char(si.quantity, 'FM999990.##')), ', ' order by si.line_total desc) from public.storefront_sale_items si where si.sale_id = s.id)) r
          from public.storefront_sales s where s.customer_id = p_customer and s.business_id = v_b and s.status = 'completed'
         order by s.sale_date desc, s.created_at desc limit 6) y), '[]'::jsonb),
    'open_quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'number', q.quotation_number, 'date', q.quotation_date, 'total', q.total_amount, 'status', q.status) order by q.quotation_date desc)
                    from public.sales_quotations q where q.customer_id = p_customer and q.business_id = v_b and q.status::text in ('prepared', 'reviewed', 'approved', 'sent')), '[]'::jsonb),
    'promises', coalesce((select jsonb_agg(jsonb_build_object('date', p.promise_date, 'amount', p.amount, 'note', p.note, 'logged', p.created_at::date) order by p.created_at desc)
                    from (select * from public.collection_promises where customer_id = p_customer order by created_at desc limit 5) p), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', i.invoice_number, 'date', i.invoice_date, 'due', i.due_date, 'total', i.total_amount, 'balance', i.balance_due) order by i.due_date nulls last, i.invoice_date)
                    from public.finance_customer_invoices i where i.customer_id = p_customer and i.business_id = v_b and coalesce(i.balance_due, 0) > 0 and i.status::text not in ('draft', 'voided', 'paid')), '[]'::jsonb));
end $$;
revoke all on function public.manager_client(uuid) from public;
grant execute on function public.manager_client(uuid) to authenticated;

-- ------------------------------------------------------------- collections --
create or replace function public.manager_collections()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return jsonb_build_object('no_store', true); end if;
  return jsonb_build_object(
    'owed', (select round(coalesce(sum(owed), 0), 2) from public.manager_ar(v_b)),
    'overdue', (select round(coalesce(sum(overdue), 0), 2) from public.manager_ar(v_b)),
    'checks_week', (select jsonb_build_object('total', round(coalesce(sum(amount), 0), 2), 'count', count(*)) from public.storefront_checks
                     where business_id = v_b and status in ('on_hand', 'deposited') and check_date between v_today and v_today + 7),
    'clients', coalesce((select jsonb_agg(x order by x->>'oldest_due' nulls last, (x->>'owed')::numeric desc) from (
        select jsonb_build_object('id', ar.customer_id, 'name', coalesce(c.trade_name, c.legal_name), 'phone', c.phone, 'agent', a.name,
                 'owed', round(ar.owed, 2), 'overdue', round(coalesce(ar.overdue, 0), 2), 'invoices', ar.invoices, 'oldest_due', ar.oldest_due,
                 'days', case when ar.oldest_due is not null then v_today - ar.oldest_due end,
                 'promise', (select jsonb_build_object('date', p.promise_date, 'amount', p.amount) from public.collection_promises p where p.customer_id = ar.customer_id order by p.created_at desc limit 1),
                 'contact', c.contact_person,
                 'open_invoices', (select jsonb_agg(jsonb_build_object('number', i.invoice_number, 'date', i.invoice_date, 'due', i.due_date, 'total', i.total_amount, 'balance', i.balance_due) order by i.due_date nulls last, i.invoice_date)
                                from public.finance_customer_invoices i where i.customer_id = ar.customer_id and i.business_id = v_b and coalesce(i.balance_due, 0) > 0 and i.status::text not in ('draft', 'voided', 'paid'))) x
          from public.manager_ar(v_b) ar join public.finance_customers c on c.id = ar.customer_id
          left join public.sales_agents a on a.id = c.agent_id and a.kind <> 'store') y), '[]'::jsonb));
end $$;
revoke all on function public.manager_collections() from public;
grant execute on function public.manager_collections() to authenticated;

-- --------------------------------------------------------------- approvals --
create or replace function public.manager_approvals()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id();
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x->>'at' desc) from (
    select jsonb_build_object('kind', 'quote', 'id', q.id, 'number', q.quotation_number, 'status', q.status, 'client', coalesce(c.trade_name, c.legal_name), 'amount', q.total_amount,
             'by', coalesce(a.name, u.full_name, u.username), 'at', coalesce(q.prepared_at, q.created_at),
             'flag', (select case when count(*) > 0 then count(*) || ' line(s) below the floor' end from public.sales_quotation_items qi where qi.quotation_id = q.id and qi.below_floor)) x
      from public.sales_quotations q left join public.finance_customers c on c.id = q.customer_id
      left join public.sales_agents a on a.id = q.agent_id and a.kind <> 'store' left join public.users u on u.id = q.prepared_by
     where q.business_id = v_b and q.status::text in ('prepared', 'reviewed')
    union all
    select jsonb_build_object('kind', 'order', 'id', o.id, 'number', o.order_number, 'status', o.status, 'client', coalesce(c.trade_name, c.legal_name), 'amount', o.total_amount,
             'by', coalesce(a.name, u.full_name, u.username), 'at', coalesce(o.prepared_at, o.created_at),
             'flag', case when o.go_signal_date is not null then 'Go-signal ' || to_char(o.go_signal_date, 'DD Mon') || coalesce(' via ' || o.go_signal_via, '') end)
      from public.sales_orders o left join public.finance_customers c on c.id = o.customer_id
      left join public.sales_agents a on a.id = o.agent_id and a.kind <> 'store' left join public.users u on u.id = o.prepared_by
     where o.business_id = v_b and o.status::text in ('prepared', 'reviewed')
    union all
    select jsonb_build_object('kind', 'price', 'id', s.id, 'number', s.sale_number, 'status', s.status, 'client', coalesce(c.trade_name, c.legal_name, 'Walk-in'), 'amount', s.total,
             'by', coalesce(u.full_name, u.username), 'at', s.created_at, 'flag', array_to_string(s.approval_reasons, ' · '))
      from public.storefront_sales s left join public.finance_customers c on c.id = s.customer_id left join public.users u on u.id = s.created_by
     where s.business_id = v_b and s.status = 'pending_approval'
    union all
    select jsonb_build_object('kind', 'cancel', 'id', s.id, 'number', s.sale_number, 'status', s.cancel_status, 'client', coalesce(c.trade_name, c.legal_name, 'Walk-in'), 'amount', s.total,
             'by', coalesce(u.full_name, u.username), 'at', s.cancel_requested_at, 'flag', s.cancel_reason)
      from public.storefront_sales s left join public.finance_customers c on c.id = s.customer_id left join public.users u on u.id = s.cancel_requested_by
     where s.business_id = v_b and s.cancel_status = 'requested'
    union all
    select jsonb_build_object('kind', 'closing', 'id', k.id, 'number', k.closing_number, 'status', k.status, 'client', 'Daily closing ' || to_char(k.closing_date, 'DD Mon'), 'amount', k.sales_total,
             'by', coalesce(u.full_name, u.username), 'at', k.submitted_at,
             'flag', case when k.variance <> 0 then 'Cash ' || case when k.variance < 0 then 'short ₱' else 'over ₱' end || to_char(abs(k.variance), 'FM999,999,990.00') end)
      from public.storefront_closings k left join public.users u on u.id = k.submitted_by
     where k.business_id = v_b and k.status = 'submitted'
  ) y), '[]'::jsonb);
end $$;
revoke all on function public.manager_approvals() from public;
grant execute on function public.manager_approvals() to authenticated;

-- A quotation's lines for review: price, floor, margin, last price to this client.
create or replace function public.manager_quote(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); q record;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  select * into q from public.sales_quotations where id = p_quote and business_id = v_b;
  if not found then raise exception 'Quotation not found in this store.'; end if;
  return jsonb_build_object(
    'id', q.id, 'number', q.quotation_number, 'status', q.status, 'date', q.quotation_date, 'total', q.total_amount, 'discount', q.discount_amount,
    'vat', q.vat_amount, 'terms', q.payment_terms, 'notes', q.notes, 'prepared_by', q.prepared_by,
    'client', (select jsonb_build_object('id', c.id, 'name', coalesce(c.trade_name, c.legal_name), 'terms', c.payment_terms) from public.finance_customers c where c.id = q.customer_id),
    'agent', (select name from public.sales_agents where id = q.agent_id and kind <> 'store'),
    'ar', (select jsonb_build_object('owed', round(owed, 2), 'overdue', round(coalesce(overdue, 0), 2)) from public.manager_ar(v_b) where customer_id = q.customer_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('name', qi.description, 'qty', qi.quantity, 'unit', qi.unit, 'price', qi.unit_price, 'total', qi.amount,
                 'floor', qi.floor_price, 'below_floor', qi.below_floor, 'srp', qi.pricing_srp, 'engine', qi.engine_unit_price,
                 'margin', case when qi.unit_price > 0 and coalesce(qi.pricing_acquisition_cost, 0) > 0 then round((qi.unit_price - qi.pricing_acquisition_cost) / qi.unit_price * 100, 1) end,
                 'last', (select si.unit_price from public.storefront_sale_items si join public.storefront_sales s on s.id = si.sale_id
                           where s.customer_id = q.customer_id and s.status = 'completed' and si.item_id = qi.catalog_item_id order by s.sale_date desc limit 1)) order by qi.created_at)
                 from public.sales_quotation_items qi where qi.quotation_id = q.id), '[]'::jsonb),
    'cost', (select round(sum(coalesce(pricing_acquisition_cost, 0) * quantity), 2) from public.sales_quotation_items where quotation_id = q.id));
end $$;
revoke all on function public.manager_quote(uuid) from public;
grant execute on function public.manager_quote(uuid) to authenticated;
