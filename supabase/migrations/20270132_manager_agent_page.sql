-- Build 132 — Sales targets per person, the agent's page in the Sales Manager app, and the agent app's Home.
-- Default target (owner, 2026-10-17): the person's average monthly sales + 20%, rounded up to the next ₱100.
--   Average = their sales over the 12 months before the target month, divided by the months since their first
--   sale in that window (a new agent is not averaged over months before they started; months with no sales
--   after their first one count as ₱0). No sales in the window = no default.
--   The Sales Manager may set another target for the month (any amount) with a note; the agent (or counter
--   person) is notified with the note. The store's target, when not set, adds up the people's targets.

alter table public.sales_targets add column if not exists note text;

create or replace function public.manager_person_stats(p_business uuid, p_year int, p_month int)
returns table(agent_id uuid, user_id uuid, average numeric, default_target numeric)
language sql stable security definer set search_path = public as $$
  with h as (
    select l.agent_id, case when l.agent_id is null then l.staff_id end as user_id, date_trunc('month', l.day)::date as m, sum(l.amount) as amt
      from public.manager_sales_lines(p_business, (make_date(p_year, p_month, 1) - interval '12 months')::date, make_date(p_year, p_month, 1) - 1) l
     group by 1, 2, 3
  ), g as (
    select h.agent_id, h.user_id, sum(h.amt) as total, min(h.m) as first from h group by 1, 2
  ), a as (
    select g.agent_id, g.user_id,
           g.total / greatest(1, (p_year * 12 + p_month) - (extract(year from g.first)::int * 12 + extract(month from g.first)::int)) as average
      from g where g.total > 0 and (g.agent_id is not null or g.user_id is not null)
  )
  select a.agent_id, a.user_id, round(a.average, 2), ceil(a.average * 1.2 / 100) * 100 from a;
$$;
revoke all on function public.manager_person_stats(uuid, int, int) from public;

create or replace function public.manager_store_target(p_business uuid, p_year int, p_month int)
returns numeric language sql stable security definer set search_path = public as $$
  with people as (
    select t.agent_id, t.user_id, t.amount from public.sales_targets t
     where t.business_id = p_business and t.year = p_year and t.month = p_month and (t.agent_id is not null or t.user_id is not null)
  ), eff as (
    select amount from people
    union all
    select s.default_target from public.manager_person_stats(p_business, p_year, p_month) s
     where not exists (select 1 from people p where p.agent_id is not distinct from s.agent_id and p.user_id is not distinct from s.user_id)
  )
  select coalesce(
    (select amount from public.sales_targets where business_id = p_business and year = p_year and month = p_month and agent_id is null and user_id is null),
    nullif((select sum(amount) from eff), 0));
$$;
revoke all on function public.manager_store_target(uuid, int, int) from public;

drop function if exists public.manager_set_target(int, int, uuid, uuid, numeric);
create or replace function public.manager_set_target(p_year int, p_month int, p_agent uuid, p_user uuid, p_amount numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_id uuid; v_old numeric; v_def numeric; v_note text := nullif(btrim(coalesce(p_note, '')), '');
        v_who text; v_to uuid; v_name text; v_mon text := to_char(make_date(p_year, p_month, 1), 'FMMonth YYYY'); v_store text;
begin
  if not public.manager_access() then raise exception 'Only the Sales Manager or the Business Admin sets targets.'; end if;
  if v_b is null then raise exception 'Select a store in "Acting as" first.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter the target (₱0 or more).'; end if;
  if p_agent is not null and p_user is not null then raise exception 'A target is for one agent or one counter person.'; end if;
  if p_agent is not null then
    select user_id, name into v_to, v_name from public.sales_agents where id = p_agent;
    if v_name is null then raise exception 'Agent not found.'; end if;
  end if;
  if p_user is not null then
    select id, coalesce(full_name, username) into v_to, v_name from public.users where id = p_user and business_id = v_b;
    if v_name is null then raise exception 'Person not found in this store.'; end if;
  end if;
  if (p_agent is not null or p_user is not null) and v_note is null then
    raise exception 'Add a note for %: it is sent with the new target.', v_name;
  end if;
  select id, amount into v_id, v_old from public.sales_targets where business_id = v_b and year = p_year and month = p_month
     and agent_id is not distinct from p_agent and user_id is not distinct from p_user;
  if p_agent is not null or p_user is not null then
    select s.default_target into v_def from public.manager_person_stats(v_b, p_year, p_month) s
     where s.agent_id is not distinct from p_agent and s.user_id is not distinct from p_user;
  end if;
  if v_id is null then
    insert into public.sales_targets(business_id, year, month, agent_id, user_id, amount, note, updated_by)
    values (v_b, p_year, p_month, p_agent, p_user, round(p_amount, 2), v_note, auth.uid()) returning id into v_id;
  else
    update public.sales_targets set amount = round(p_amount, 2), note = v_note, updated_by = auth.uid(), updated_at = now() where id = v_id;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_targets', v_id, 'edited', jsonb_build_object('year', p_year, 'month', p_month, 'agent_id', p_agent, 'user_id', p_user,
          'amount', p_amount, 'previous', coalesce(v_old, v_def), 'default', v_def, 'note', v_note));
  -- tell the person (agents through the agent app; counter staff in the office app)
  if v_to is not null then
    select coalesce(nullif(btrim(full_name), ''), username) into v_who from public.users where id = auth.uid();
    select coalesce(nullif(btrim(trade_name), ''), legal_name) into v_store from public.businesses where id = v_b;
    insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
    values (v_b, v_to, 'sales', 'sales_targets', v_id, 'Your ' || v_mon || ' sales target: ₱' || to_char(round(p_amount), 'FM999,999,999,990'),
            coalesce(v_who, 'The Sales Manager') || ' set your ' || v_mon || ' target at ' || coalesce(v_store, 'the store') || ' to ₱' || to_char(round(p_amount), 'FM999,999,999,990')
              || coalesce(' (was ₱' || to_char(round(coalesce(v_old, v_def)), 'FM999,999,999,990') || ')', '') || '. Note: ' || v_note,
            case when p_agent is not null then '/agent' end, auth.uid());
  end if;
end $$;
revoke all on function public.manager_set_target(int, int, uuid, uuid, numeric, text) from public;
grant execute on function public.manager_set_target(int, int, uuid, uuid, numeric, text) to authenticated;

-- Team: each person's target is the one set for the month, or else the default (average + 20%).
create or replace function public.manager_team(p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_from date := make_date(p_year, p_month, 1);
        v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return '[]'::jsonb; end if;
  return (
    with l as materialized (select * from public.manager_sales_lines(v_b, v_from, v_to)),
         st as materialized (select * from public.manager_person_stats(v_b, p_year, p_month)),
         tg as materialized (select agent_id, user_id, amount, note from public.sales_targets where business_id = v_b and year = p_year and month = p_month and (agent_id is not null or user_id is not null)),
         ag as (select agent_id, sum(amount) total, count(distinct sale_id) sales, count(distinct customer_id) clients, max(day) last from l where agent_id is not null group by agent_id),
         cs as (select staff_id, sum(amount) total, count(distinct sale_id) sales, count(distinct customer_id) clients, max(day) last from l where agent_id is null group by staff_id),
         people as (
           select case when a.online then 'Online' else 'Agent' end kind, a.id agent_id, null::uuid user_id, a.name, a.phone,
                  coalesce(s.total, 0) total, coalesce(s.sales, 0) sales, coalesce(s.clients, 0) clients, s.last
             from public.sales_agents a left join ag s on s.agent_id = a.id
            where a.kind <> 'store' and (a.home_business_id = v_b or s.agent_id is not null) and (a.active or s.agent_id is not null)
           union all
           select 'Counter', null, u.id, coalesce(u.full_name, u.username), null, s.total, s.sales, s.clients, s.last
             from cs s join public.users u on u.id = s.staff_id)
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', p.kind, 'agent_id', p.agent_id, 'user_id', p.user_id, 'name', p.name, 'phone', p.phone,
             'total', round(p.total, 2), 'sales', p.sales, 'clients', p.clients, 'last', p.last,
             'target', coalesce(t.amount, s.default_target), 'target_set', t.amount is not null, 'note', t.note,
             'default', s.default_target, 'average', s.average) order by p.total desc), '[]'::jsonb)
      from people p
      left join st s on s.agent_id is not distinct from p.agent_id and s.user_id is not distinct from p.user_id
      left join tg t on t.agent_id is not distinct from p.agent_id and t.user_id is not distinct from p.user_id);
end $$;
revoke all on function public.manager_team(int, int) from public;
grant execute on function public.manager_team(int, int) to authenticated;

-- One person's page: an agent (p_agent) or a counter person (p_user), for a month.
create or replace function public.manager_person(p_agent uuid, p_user uuid, p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_today date := (now() at time zone 'Asia/Manila')::date;
        v_from date := make_date(p_year, p_month, 1); v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
        v_lo date := (make_date(p_year, p_month, 1) - interval '11 months')::date; v_y0 date := make_date(p_year, 1, 1);
        v_end date; v_name text; v_kind text; v_phone text;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return jsonb_build_object('no_store', true); end if;
  if (p_agent is null) = (p_user is null) then raise exception 'Choose one agent or one counter person.'; end if;
  if p_agent is not null then
    select a.name, case when a.online then 'Online agent' else 'Agent' end, a.phone into v_name, v_kind, v_phone
      from public.sales_agents a where a.id = p_agent and a.kind <> 'store';
  else
    select coalesce(u.full_name, u.username), 'Counter', null into v_name, v_kind, v_phone from public.users u where u.id = p_user and u.business_id = v_b;
  end if;
  if v_name is null then raise exception 'Person not found in this store.'; end if;
  v_end := least(v_to, v_today);
  return (
    with all_l as materialized (select * from public.manager_sales_lines(v_b, v_lo, v_end)),
         l as materialized (select * from all_l where (p_agent is not null and agent_id = p_agent) or (p_user is not null and agent_id is null and staff_id = p_user)),
         mo as (select * from l where day >= v_from),
         ytd as (select * from l where day >= v_y0),
         st as (select * from public.manager_person_stats(v_b, p_year, p_month) s where s.agent_id is not distinct from p_agent and s.user_id is not distinct from p_user),
         tg as (select amount, note, updated_at, updated_by from public.sales_targets where business_id = v_b and year = p_year and month = p_month and agent_id is not distinct from p_agent and user_id is not distinct from p_user),
         rk as (select coalesce(agent_id, staff_id) who, sum(amount) total from all_l where day >= v_from group by 1),
         arx as materialized (select * from public.manager_ar(v_b)),
         mine as (select c.id from public.finance_customers c where p_agent is not null and c.business_id = v_b and c.agent_id = p_agent)
    select jsonb_build_object(
      'name', v_name, 'kind', v_kind, 'phone', v_phone, 'agent_id', p_agent, 'user_id', p_user,
      'from', v_from, 'to', v_to, 'through', v_end, 'days_in_month', extract(day from v_to)::int, 'days_gone', greatest(0, (v_end - v_from) + 1),
      'total', round(coalesce((select sum(amount) from mo), 0), 2),
      'sales', (select count(distinct sale_id) from mo where category <> 'Returns'),
      'clients', (select count(distinct customer_id) from mo where category <> 'Returns'),
      'margin', (select case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end from mo),
      'target_set', (select amount is not null from tg), 'default', (select default_target from st), 'average', (select average from st),
      'target', coalesce((select amount from tg), (select default_target from st)),
      'note', (select note from tg), 'note_at', (select updated_at from tg),
      'note_by', (select coalesce(u.full_name, u.username) from tg join public.users u on u.id = tg.updated_by),
      'rank', (select count(*) + 1 from rk where rk.total > coalesce((select sum(amount) from mo), 0)),
      'team_size', greatest((select count(*) from rk), 1),
      'ytd', round(coalesce((select sum(amount) from ytd), 0), 2),
      'ytd_margin', (select case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end from ytd),
      'months', (select jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'), 'label', to_char(m, 'Mon'),
                   'total', round(coalesce((select sum(amount) from l where date_trunc('month', l.day) = m), 0), 2),
                   'target', (select amount from public.sales_targets t where t.business_id = v_b and t.year = extract(year from m)::int and t.month = extract(month from m)::int
                                and t.agent_id is not distinct from p_agent and t.user_id is not distinct from p_user)) order by m)
                   from generate_series(v_lo::timestamp, v_from::timestamp, interval '1 month') m),
      'categories', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
          select jsonb_build_object('name', category, 'total', round(sum(amount), 2),
                 'margin', case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end) x
            from mo group by category) c), '[]'::jsonb),
      'clients_list', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
          select jsonb_build_object('id', g.customer_id, 'name', coalesce(c.trade_name, c.legal_name, 'Walk-in (no account)'), 'total', round(g.total, 2),
                 'last', (select max(day) from l where l.customer_id is not distinct from g.customer_id),
                 'overdue', (select round(coalesce(ar.overdue, 0), 2) from arx ar where ar.customer_id = g.customer_id)) x
            from (select customer_id, sum(amount) total from ytd group by customer_id order by sum(amount) desc limit 15) g
            left join public.finance_customers c on c.id = g.customer_id) z), '[]'::jsonb),
      -- their own clients with no purchase for 60 days (who had bought before), most recent first
      'quiet', coalesce((select jsonb_agg(x order by x->>'last' desc) from (
          select jsonb_build_object('id', c.id, 'name', coalesce(c.trade_name, c.legal_name), 'last', q.last, 'phone', c.phone) x
            from public.finance_customers c
            join lateral (select max(s.sale_date) last from public.storefront_sales s where s.customer_id = c.id and s.business_id = v_b and s.status = 'completed') q on true
           where c.id in (select id from mine) and c.active and q.last is not null and q.last < v_today - 60
           order by q.last desc limit 15) z), '[]'::jsonb),
      'quotes', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum(total_amount), 0), 2))
                   from public.sales_quotations q where q.business_id = v_b and q.status::text in ('prepared', 'reviewed', 'approved', 'sent')
                    and ((p_agent is not null and q.agent_id = p_agent) or (p_user is not null and q.prepared_by = p_user))),
      'orders', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum(total_amount), 0), 2))
                   from public.sales_orders o where o.business_id = v_b and o.status::text in ('approved', 'processing')
                    and ((p_agent is not null and o.agent_id = p_agent) or (p_user is not null and o.prepared_by = p_user))),
      'collections', case when p_agent is not null then (select jsonb_build_object('owed', round(coalesce(sum(owed), 0), 2), 'overdue', round(coalesce(sum(overdue), 0), 2), 'clients', count(*))
                   from arx where customer_id in (select id from mine)) end,
      'recent', coalesce((select jsonb_agg(r order by r->>'date' desc, r->>'number' desc) from (
          select jsonb_build_object('number', coalesce(s.dr_number, s.si_number, s.sale_number), 'date', s.sale_date, 'total', s.total,
                   'customer_id', s.customer_id, 'customer', coalesce(c.trade_name, c.legal_name)) r
            from public.storefront_sales s
            left join public.sales_agents a on a.id = s.agent_id and a.kind <> 'store'
            left join public.finance_customers c on c.id = s.customer_id
           where s.business_id = v_b and s.status = 'completed' and s.sale_date <= v_end
             and ((p_agent is not null and s.agent_id = p_agent) or (p_user is not null and a.id is null and s.created_by = p_user))
           order by s.sale_date desc, s.created_at desc limit 10) y), '[]'::jsonb)));
end $$;
revoke all on function public.manager_person(uuid, uuid, int, int) from public;
grant execute on function public.manager_person(uuid, uuid, int, int) to authenticated;

-- ------------------------------------------------------------------ agent app: Home
-- The agent's own month in the chosen store: sales against the target (set or default), the pace, what is
-- needed per day, the last 6 months, clients gone quiet, clients' overdue balances, open quotes and orders,
-- recent sales. No costs or margins (agents see sales only). Each store's figures stay separate.
create or replace function public.agent_home(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require(); v_today date := (now() at time zone 'Asia/Manila')::date;
        v_from date := date_trunc('month', (now() at time zone 'Asia/Manila'))::date; v_to date;
        v_y int; v_m int;
begin
  perform public.agent_check_store(p_business);
  v_to := (v_from + interval '1 month - 1 day')::date; v_y := extract(year from v_from)::int; v_m := extract(month from v_from)::int;
  return (
    with l as materialized (select * from public.manager_sales_lines(p_business, (v_from - interval '5 months')::date, v_today) where agent_id = v),
         mo as (select * from l where day >= v_from),
         st as (select * from public.manager_person_stats(p_business, v_y, v_m) s where s.agent_id = v),
         tg as (select t.amount, t.note, t.updated_at, coalesce(u.full_name, u.username) who from public.sales_targets t left join public.users u on u.id = t.updated_by
                 where t.business_id = p_business and t.year = v_y and t.month = v_m and t.agent_id = v),
         mine as (select c.id, coalesce(c.trade_name, c.legal_name) name, c.phone from public.finance_customers c where c.business_id = p_business and c.agent_id = v and c.active),
         arx as materialized (select * from public.manager_ar(p_business) where customer_id in (select id from mine))
    select jsonb_build_object(
      'month', to_char(v_from, 'FMMonth YYYY'), 'days_in_month', extract(day from v_to)::int, 'days_gone', (v_today - v_from) + 1, 'days_left', (v_to - v_today),
      'total', round(coalesce((select sum(amount) from mo), 0), 2),
      'sales', (select count(distinct sale_id) from mo where category <> 'Returns'),
      'clients_bought', (select count(distinct customer_id) from mo where category <> 'Returns'),
      'today', round(coalesce((select sum(amount) from mo where day = v_today), 0), 2),
      'target', coalesce((select amount from tg), (select default_target from st)),
      'target_set', exists (select 1 from tg), 'default', (select default_target from st), 'average', (select average from st),
      'note', (select note from tg), 'note_by', (select who from tg), 'note_at', (select updated_at from tg),
      'months', (select jsonb_agg(jsonb_build_object('label', to_char(m, 'Mon'),
                   'total', round(coalesce((select sum(amount) from l where date_trunc('month', l.day) = m), 0), 2),
                   'target', (select amount from public.sales_targets t where t.business_id = p_business and t.agent_id = v
                                and t.year = extract(year from m)::int and t.month = extract(month from m)::int)) order by m)
                   from generate_series((v_from - interval '5 months'), v_from::timestamp, interval '1 month') m),
      'clients', (select count(*) from mine),
      'quiet', coalesce((select jsonb_agg(x order by x->>'last' desc) from (
          select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'last', q.last) x
            from mine c
            join lateral (select max(s.sale_date) last from public.storefront_sales s where s.customer_id = c.id and s.business_id = p_business and s.status = 'completed') q on true
           where q.last is not null and q.last < v_today - 60 order by q.last desc limit 8) z), '[]'::jsonb),
      'quiet_count', (select count(*) from mine c where exists (select 1 from public.storefront_sales s where s.customer_id = c.id and s.business_id = p_business and s.status = 'completed')
                        and not exists (select 1 from public.storefront_sales s where s.customer_id = c.id and s.business_id = p_business and s.status = 'completed' and s.sale_date >= v_today - 60)),
      'owed', round(coalesce((select sum(owed) from arx), 0), 2), 'overdue', round(coalesce((select sum(overdue) from arx), 0), 2),
      'overdue_clients', coalesce((select jsonb_agg(jsonb_build_object('id', a.customer_id, 'name', c.name, 'overdue', round(a.overdue, 2), 'oldest_due', a.oldest_due) order by a.oldest_due)
                          from arx a join mine c on c.id = a.customer_id where coalesce(a.overdue, 0) > 0), '[]'::jsonb),
      'quotes', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum(total_amount), 0), 2))
                   from public.sales_quotations q where q.business_id = p_business and q.agent_id = v and q.status::text in ('prepared', 'reviewed', 'approved', 'sent')),
      'orders', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum(total_amount), 0), 2))
                   from public.sales_orders o where o.business_id = p_business and o.agent_id = v and o.status::text in ('approved', 'processing')),
      'recent', coalesce((select jsonb_agg(r order by r->>'date' desc, r->>'number' desc) from (
          select jsonb_build_object('number', coalesce(s.dr_number, s.si_number, s.sale_number), 'date', s.sale_date, 'total', s.total,
                   'customer', coalesce(c.trade_name, c.legal_name)) r
            from public.storefront_sales s left join public.finance_customers c on c.id = s.customer_id
           where s.business_id = p_business and s.status = 'completed' and s.agent_id = v
           order by s.sale_date desc, s.created_at desc limit 5) y), '[]'::jsonb)));
end $$;
revoke all on function public.agent_home(uuid) from public;
grant execute on function public.agent_home(uuid) to authenticated;
