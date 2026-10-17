-- Build 133 — Sales Manager app: "Needs attention".
-- One list of what needs the manager now, worked out live from the store's records: urgent approvals,
-- agents falling behind, clients and money, the pipeline. Each item can be marked Done or snoozed.
-- Red items alert the Sales approvers and the Business Admin at once (once per item); a morning summary
-- goes out at the store's chosen hour (default 8am Manila); an agent behind pace gets a nudge in the
-- agent app (at most once a week). Every threshold is a per-store setting (owner, 2026-10-17).
-- A background job (pg_cron, every 5 minutes) sends the alerts; opening the Manager app does it too.

-- ------------------------------------------------------------------ settings --
create table if not exists public.attention_settings (
  business_id uuid primary key references public.businesses(id),
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.attention_settings enable row level security;
drop policy if exists attention_settings_read on public.attention_settings;
create policy attention_settings_read on public.attention_settings for select
  using ((public.is_super_admin() or business_id = public.current_business_id()) and public.manager_access());
grant select on public.attention_settings to authenticated;

create or replace function public.attention_defaults()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'price_minutes', 15,        -- counter price exception waiting (customer at the counter)
    'order_hours', 4,           -- sales order (go-signal) waiting for approval
    'quote_hours', 24,          -- quotation waiting for review / approval
    'closing_hour', 10,         -- yesterday's daily closing not approved by this hour
    'overdue_days', 60,         -- an order for a client with balances overdue this long
    'behind_pct', 80,           -- agent below this % of where he should be today
    'behind_from_day', 7,       -- ... checked from this day of the month
    'no_sale_days', 7,          -- agent with no sale for this many days
    'missed_months', 2,         -- agent missed the target this many months in a row
    'quiet_days', 45,           -- a top client with no purchase for this many days
    'top_clients', 20,          -- how many top clients (sales this year) to watch
    'quote_followup_days', 7,   -- quotation sent with no answer
    'quote_expiry_days', 2,     -- quotation expiring within
    'undelivered_days', 3,      -- approved order not delivered
    'summary_hour', 8,          -- morning summary (Manila time)
    'agent_nudge', 1);          -- 1 = nudge agents behind pace in the agent app, 0 = off
$$;

create or replace function public.attention_cfg(p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.attention_defaults() || coalesce((select settings from public.attention_settings where business_id = p_business), '{}'::jsonb);
$$;
revoke all on function public.attention_cfg(uuid) from public;

create or replace function public.manager_attention_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); k text; v numeric; v_clean jsonb := '{}'::jsonb;
        v_lim jsonb := jsonb_build_object('price_minutes', '[1,1440]'::jsonb, 'order_hours', '[1,168]'::jsonb, 'quote_hours', '[1,336]'::jsonb, 'closing_hour', '[0,23]'::jsonb,
          'overdue_days', '[1,365]'::jsonb, 'behind_pct', '[1,100]'::jsonb, 'behind_from_day', '[1,28]'::jsonb, 'no_sale_days', '[1,90]'::jsonb, 'missed_months', '[1,12]'::jsonb,
          'quiet_days', '[7,365]'::jsonb, 'top_clients', '[1,200]'::jsonb, 'quote_followup_days', '[1,90]'::jsonb, 'quote_expiry_days', '[0,30]'::jsonb, 'undelivered_days', '[1,60]'::jsonb,
          'summary_hour', '[0,23]'::jsonb, 'agent_nudge', '[0,1]'::jsonb);
begin
  if not public.manager_access() then raise exception 'Only the Sales Manager or the Business Admin changes these settings.'; end if;
  if v_b is null then raise exception 'Select a store in "Acting as" first.'; end if;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if not v_lim ? k then raise exception 'Unknown setting: %', k; end if;
    begin v := (p->>k)::numeric; exception when others then raise exception 'Enter a number for %.', k; end;
    if v is null or v < (v_lim->k->>0)::numeric or v > (v_lim->k->>1)::numeric then
      raise exception '% must be between % and %.', k, v_lim->k->>0, v_lim->k->>1;
    end if;
    v_clean := v_clean || jsonb_build_object(k, round(v));
  end loop;
  insert into public.attention_settings(business_id, settings, updated_by, updated_at) values (v_b, v_clean, auth.uid(), now())
  on conflict (business_id) do update set settings = public.attention_settings.settings || excluded.settings, updated_by = auth.uid(), updated_at = now();
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'attention_settings', v_b, 'edited', v_clean);
  return public.attention_cfg(v_b);
end $$;
revoke all on function public.manager_attention_settings_save(jsonb) from public;
grant execute on function public.manager_attention_settings_save(jsonb) to authenticated;

-- --------------------------------------------------------- done / snoozed --
create table if not exists public.attention_states (
  business_id uuid not null references public.businesses(id),
  key text not null,
  status text not null check (status in ('done', 'snoozed')),
  until timestamptz,
  set_by uuid references public.users(id),
  set_at timestamptz not null default now(),
  primary key (business_id, key)
);
alter table public.attention_states enable row level security;
-- read through the functions only

create or replace function public.manager_attention_set(p_key text, p_status text, p_days int default 3)
returns void language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id();
begin
  if not public.manager_access() then raise exception 'Access denied.'; end if;
  if v_b is null then raise exception 'Select a store in "Acting as" first.'; end if;
  if p_status = 'open' then
    delete from public.attention_states where business_id = v_b and key = p_key;
    return;
  end if;
  if p_status not in ('done', 'snoozed') then raise exception 'Choose Done or Snooze.'; end if;
  insert into public.attention_states(business_id, key, status, until, set_by, set_at)
  values (v_b, p_key, p_status, case when p_status = 'snoozed' then now() + make_interval(days => greatest(1, least(coalesce(p_days, 3), 30))) end, auth.uid(), now())
  on conflict (business_id, key) do update set status = excluded.status, until = excluded.until, set_by = excluded.set_by, set_at = excluded.set_at;
end $$;
revoke all on function public.manager_attention_set(text, text, int) from public;
grant execute on function public.manager_attention_set(text, text, int) to authenticated;

-- ------------------------------------------------------------------- items --
-- level: red (urgent), amber (team / money), info (pipeline). group: approvals, team, clients, pipeline.
create or replace function public.attention_items(p_business uuid)
returns table(key text, level text, grp text, title text, detail text, url text, since timestamptz, agent_id uuid, phone text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb := public.attention_cfg(p_business);
        v_now timestamptz := now(); v_today date := (now() at time zone 'Asia/Manila')::date;
        v_hour int := extract(hour from (now() at time zone 'Asia/Manila'))::int;
        v_m0 date := date_trunc('month', (now() at time zone 'Asia/Manila'))::date;
        v_dim int := extract(day from (date_trunc('month', (now() at time zone 'Asia/Manila')) + interval '1 month - 1 day'))::int;
        v_day int := extract(day from (now() at time zone 'Asia/Manila'))::int;
        v_y int := extract(year from (now() at time zone 'Asia/Manila'))::int; v_mo int := extract(month from (now() at time zone 'Asia/Manila'))::int;
        i int; v_py int; v_pm int;
begin
  -- ---------- approvals (red) ----------
  return query
  select 'price:' || s.id, 'red', 'approvals', 'Counter price waiting ' || (extract(epoch from v_now - s.created_at) / 60)::int || ' min',
         coalesce(cu.trade_name, cu.legal_name, 'Walk-in') || ' · ₱' || to_char(s.total, 'FM999,999,990') || ' — the customer may be waiting at the counter',
         '/manager/approvals?kind=price', s.created_at, null::uuid, null::text
    from public.storefront_sales s left join public.finance_customers cu on cu.id = s.customer_id
   where s.business_id = p_business and s.status = 'pending_approval' and s.created_at < v_now - make_interval(mins => (c->>'price_minutes')::int);

  return query
  select 'cancel:' || s.id, 'red', 'approvals', 'Cancel / refund request', coalesce(s.dr_number, s.sale_number) || ' · ₱' || to_char(s.total, 'FM999,999,990') || coalesce(' — ' || s.cancel_reason, ''),
         '/manager/approvals?kind=cancel', s.cancel_requested_at, null::uuid, null::text
    from public.storefront_sales s where s.business_id = p_business and s.cancel_status = 'requested';

  return query
  with ar as (select * from public.manager_ar(p_business))
  select 'order:' || o.id, 'red', 'approvals',
         case when risky then 'Order for a client with overdue balances' else 'Sales order waiting ' || (extract(epoch from v_now - w) / 3600)::int || ' h' end,
         coalesce(cu.trade_name, cu.legal_name) || ' · ₱' || to_char(o.total_amount, 'FM999,999,990')
           || case when risky then ' — owes ₱' || to_char(coalesce(ar.owed, 0), 'FM999,999,990') || coalesce(', oldest due ' || to_char(ar.oldest_due, 'FMMon DD'), '')
                     || case when coalesce(cu.credit_limit, 0) > 0 and coalesce(ar.owed, 0) + o.total_amount > cu.credit_limit then ' (over the ₱' || to_char(cu.credit_limit, 'FM999,999,990') || ' limit)' else '' end
                   else '' end,
         '/manager/approvals?kind=order', w, null::uuid, cu.phone
    from (select o.*, coalesce(o.reviewed_at, o.prepared_at, o.created_at) w from public.sales_orders o
           where o.business_id = p_business and o.status::text in ('prepared', 'reviewed')) o
    join public.finance_customers cu on cu.id = o.customer_id
    left join ar on ar.customer_id = o.customer_id
    cross join lateral (select (ar.oldest_due is not null and ar.oldest_due < v_today - (c->>'overdue_days')::int)
                              or (coalesce(cu.credit_limit, 0) > 0 and coalesce(ar.owed, 0) + o.total_amount > cu.credit_limit) as risky) r
   where r.risky or o.w < v_now - make_interval(hours => (c->>'order_hours')::int);

  return query
  select 'quote:' || q.id, 'red', 'approvals', 'Quotation waiting ' || (extract(epoch from v_now - w) / 3600)::int || ' h',
         coalesce(cu.trade_name, cu.legal_name) || ' · ' || q.quotation_number || ' · ₱' || to_char(q.total_amount, 'FM999,999,990'),
         '/manager/quotes/' || q.id, w, null::uuid, null::text
    from (select q.*, coalesce(q.reviewed_at, q.prepared_at, q.created_at) w from public.sales_quotations q
           where q.business_id = p_business and q.status::text in ('prepared', 'reviewed')) q
    join public.finance_customers cu on cu.id = q.customer_id
   where q.w < v_now - make_interval(hours => (c->>'quote_hours')::int);

  if v_hour >= (c->>'closing_hour')::int then
    return query
    select 'closing:' || (v_today - 1)::text, 'red', 'approvals',
           case when cl.status = 'submitted' then 'Yesterday''s closing waiting for you' else 'Yesterday''s closing not submitted' end,
           (select count(*) || ' sale(s) · ₱' || to_char(coalesce(sum(total), 0), 'FM999,999,990') from public.storefront_sales s
             where s.business_id = p_business and s.sale_date = v_today - 1 and s.status = 'completed' and s.closing_id is null)
             || case when cl.status = 'submitted' then '' else ' — ask the counter to close the day' end,
           case when cl.status = 'submitted' then '/manager/approvals?kind=closing' else '/manager' end, null::timestamptz, null::uuid, null::text
      from (select 1) x
      left join lateral (select status from public.storefront_closings where business_id = p_business and closing_date = v_today - 1 and status <> 'returned'
                          order by submitted_at desc nulls last limit 1) cl on true
     where coalesce(cl.status, '') <> 'approved'
       and exists (select 1 from public.storefront_sales s where s.business_id = p_business and s.sale_date = v_today - 1 and s.status = 'completed'
                     and (s.closing_id is null or cl.status = 'submitted'));
  end if;

  -- ---------- team (amber) ----------
  if v_day >= (c->>'behind_from_day')::int then
    return query
    with l as materialized (select * from public.manager_sales_lines(p_business, v_m0, v_today) where manager_sales_lines.agent_id is not null),
         st as materialized (select * from public.manager_person_stats(p_business, v_y, v_mo) where manager_person_stats.agent_id is not null),
         tg as (select t.agent_id, t.amount from public.sales_targets t where t.business_id = p_business and t.year = v_y and t.month = v_mo and t.agent_id is not null),
         pp as (select a.id, a.name, a.phone, coalesce(tg.amount, st.default_target) target, coalesce((select sum(amount) from l where l.agent_id = a.id), 0) total
                  from public.sales_agents a left join tg on tg.agent_id = a.id left join st on st.agent_id = a.id
                 where a.kind <> 'store' and a.active and (a.home_business_id = p_business or exists (select 1 from l where l.agent_id = a.id)))
    select 'behind:' || pp.id || ':' || to_char(v_m0, 'YYYY-MM'), 'amber', 'team', pp.name || ' is behind pace',
           '₱' || to_char(pp.total, 'FM999,999,990') || ' of ₱' || to_char(pp.target, 'FM999,999,990') || ' (' || round(pp.total / pp.target * 100) || '%) — should be at ₱'
             || to_char(pp.target * v_day / v_dim, 'FM999,999,990') || ' by today',
           '/manager/team/person?a=' || pp.id, null::timestamptz, pp.id, pp.phone
      from pp where coalesce(pp.target, 0) > 0 and pp.total < pp.target * v_day / v_dim * (c->>'behind_pct')::numeric / 100;
  end if;

  return query
  select 'nosale:' || a.id || ':' || q.last, 'amber', 'team', a.name || ': no sale in ' || (v_today - q.last) || ' days',
         'Last sale ' || to_char(q.last, 'FMMon DD'), '/manager/team/person?a=' || a.id, null::timestamptz, a.id, a.phone
    from public.sales_agents a
    join lateral (select max(s.sale_date) last from public.storefront_sales s where s.business_id = p_business and s.agent_id = a.id and s.status = 'completed') q on true
   where a.kind <> 'store' and a.active and a.home_business_id = p_business and q.last is not null and q.last < v_today - (c->>'no_sale_days')::int;

  -- missed the target N months in a row (the months before this one)
  return query
  with m as (select (v_m0 - make_interval(months => g))::date d from generate_series(1, (c->>'missed_months')::int) g),
       per as (
         select a.id, a.name, a.phone, m.d,
                coalesce((select t.amount from public.sales_targets t where t.business_id = p_business and t.agent_id = a.id
                            and t.year = extract(year from m.d)::int and t.month = extract(month from m.d)::int),
                         (select s.default_target from public.manager_person_stats(p_business, extract(year from m.d)::int, extract(month from m.d)::int) s where s.agent_id = a.id)) target,
                coalesce((select sum(l.amount) from public.manager_sales_lines(p_business, m.d, (m.d + interval '1 month - 1 day')::date) l where l.agent_id = a.id), 0) total
           from public.sales_agents a cross join m
          where a.kind <> 'store' and a.active and a.home_business_id = p_business)
  select 'missed:' || per.id || ':' || to_char(v_m0, 'YYYY-MM'), 'amber', 'team', per.name || ' missed the target ' || count(*) || ' months in a row',
         string_agg(to_char(per.d, 'FMMon') || ' ' || round(per.total / per.target * 100) || '%', ' · ' order by per.d),
         '/manager/team/person?a=' || per.id, null::timestamptz, per.id, per.phone
    from per group by per.id, per.name, per.phone
  having count(*) = (c->>'missed_months')::int and bool_and(coalesce(per.target, 0) > 0 and per.total < per.target);

  -- ---------- clients and money ----------
  return query
  select 'promise:' || p.id, case when p.promise_date < v_today then 'red' else 'amber' end, 'clients',
         case when p.promise_date < v_today then 'Payment promise broken' else 'Payment promised today' end,
         coalesce(cu.trade_name, cu.legal_name) || ' · ₱' || to_char(p.amount, 'FM999,999,990') || ' promised for ' || to_char(p.promise_date, 'FMMon DD')
           || case when paid > 0 then ' — ₱' || to_char(paid, 'FM999,999,990') || ' received since' else '' end,
         '/manager/clients/' || p.customer_id, p.created_at, null::uuid, cu.phone
    from public.collection_promises p
    join public.finance_customers cu on cu.id = p.customer_id
    cross join lateral (select coalesce(sum(r.amount), 0) paid from public.finance_customer_receipts r join public.finance_customer_invoices i on i.id = r.invoice_id
                         where i.customer_id = p.customer_id and r.status::text in ('approved', 'posted') and r.receipt_date >= p.created_at::date) x
   where p.business_id = p_business and p.promise_date between v_today - 7 and v_today and x.paid < p.amount;

  return query
  select 'check:' || k.id, 'amber', 'clients', 'Check to deposit · ' || to_char(k.check_date, 'FMMon DD'),
         coalesce(cu.trade_name, cu.legal_name, k.issuer_name, 'Client') || ' · ' || k.bank_name || ' #' || k.check_number || ' · ₱' || to_char(k.amount, 'FM999,999,990'),
         '/manager/collections', null::timestamptz, null::uuid, null::text
    from public.storefront_checks k left join public.finance_customers cu on cu.id = k.customer_id
   where k.business_id = p_business and k.status = 'on_hand' and k.check_date <= v_today + 7;

  return query
  with yr as (select customer_id, sum(amount) total from public.manager_sales_lines(p_business, make_date(v_y, 1, 1), v_today)
               where customer_id is not null group by customer_id order by sum(amount) desc limit (c->>'top_clients')::int),
       lst as (select yr.customer_id, yr.total, (select max(s.sale_date) from public.storefront_sales s where s.customer_id = yr.customer_id and s.business_id = p_business and s.status = 'completed') last from yr)
  select 'quiet:' || lst.customer_id || ':' || lst.last, 'amber', 'clients', 'Top client gone quiet · ' || coalesce(cu.trade_name, cu.legal_name),
         'No purchase since ' || to_char(lst.last, 'FMMon DD') || ' (' || (v_today - lst.last) || ' days) · ₱' || to_char(lst.total, 'FM999,999,990') || ' this year'
           || coalesce(' · agent ' || ag.name, ''),
         '/manager/clients/' || lst.customer_id, null::timestamptz, ag.id, cu.phone
    from lst join public.finance_customers cu on cu.id = lst.customer_id
    left join public.sales_agents ag on ag.id = cu.agent_id and ag.kind <> 'store'
   where lst.last < v_today - (c->>'quiet_days')::int;

  -- ---------- pipeline (info) ----------
  return query
  select 'followup:' || q.id, 'info', 'pipeline', 'Follow up quotation · ' || coalesce(cu.trade_name, cu.legal_name),
         q.quotation_number || ' · ₱' || to_char(q.total_amount, 'FM999,999,990') || ' — no answer for ' || (v_today - coalesce(q.approved_at, q.updated_at)::date) || ' days'
           || case when q.valid_until is not null then ', valid until ' || to_char(q.valid_until, 'FMMon DD') else '' end,
         '/manager/quotes/' || q.id, coalesce(q.approved_at, q.updated_at), q.agent_id, cu.phone
    from public.sales_quotations q join public.finance_customers cu on cu.id = q.customer_id
   where q.business_id = p_business and q.status::text in ('approved', 'sent')
     and coalesce(q.approved_at, q.updated_at) < v_now - make_interval(days => (c->>'quote_followup_days')::int)
     and not (q.valid_until is not null and q.valid_until between v_today and v_today + (c->>'quote_expiry_days')::int)
     and not exists (select 1 from public.sales_orders o where o.quotation_id = q.id and o.status::text <> 'cancelled');

  return query
  select 'expiry:' || q.id, 'info', 'pipeline', 'Quotation expires ' || case when q.valid_until = v_today then 'today' else to_char(q.valid_until, 'FMMon DD') end,
         coalesce(cu.trade_name, cu.legal_name) || ' · ' || q.quotation_number || ' · ₱' || to_char(q.total_amount, 'FM999,999,990'),
         '/manager/quotes/' || q.id, null::timestamptz, q.agent_id, cu.phone
    from public.sales_quotations q join public.finance_customers cu on cu.id = q.customer_id
   where q.business_id = p_business and q.status::text in ('approved', 'sent') and q.valid_until between v_today and v_today + (c->>'quote_expiry_days')::int
     and not exists (select 1 from public.sales_orders o where o.quotation_id = q.id and o.status::text <> 'cancelled');

  return query
  select 'undelivered:' || o.id, 'amber', 'pipeline', 'Order not delivered after ' || (v_today - o.approved_at::date) || ' days',
         coalesce(cu.trade_name, cu.legal_name) || ' · ' || o.order_number || ' · ₱' || to_char(o.total_amount, 'FM999,999,990'),
         '/manager/clients/' || o.customer_id, o.approved_at, o.agent_id, cu.phone
    from public.sales_orders o join public.finance_customers cu on cu.id = o.customer_id
   where o.business_id = p_business and o.status::text in ('approved', 'processing') and o.approved_at < v_now - make_interval(days => (c->>'undelivered_days')::int);
end $$;
revoke all on function public.attention_items(uuid) from public;

-- the list for the Sales Manager app (Done / snoozed items left out)
create or replace function public.manager_attention()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id();
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return jsonb_build_object('items', '[]'::jsonb, 'counts', '{}'::jsonb); end if;
  return (
    with it as materialized (
      select i.* from public.attention_items(v_b) i
       where not exists (select 1 from public.attention_states s where s.business_id = v_b and s.key = i.key
                           and (s.status = 'done' or (s.status = 'snoozed' and s.until > now()))))
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'level', level, 'group', grp, 'title', title, 'detail', detail, 'url', url, 'since', since, 'phone', phone)
                          order by case level when 'red' then 0 when 'amber' then 1 else 2 end, case grp when 'approvals' then 0 when 'team' then 1 when 'clients' then 2 else 3 end, since nulls last, title) from it), '[]'::jsonb),
      'counts', jsonb_build_object('red', (select count(*) from it where level = 'red'), 'amber', (select count(*) from it where level = 'amber'), 'info', (select count(*) from it where level = 'info')),
      'snoozed', (select count(*) from public.attention_states s where s.business_id = v_b and s.status = 'snoozed' and s.until > now()),
      'settings', public.attention_cfg(v_b)));
end $$;
revoke all on function public.manager_attention() from public;
grant execute on function public.manager_attention() to authenticated;

-- ----------------------------------------------------------- alerts / nudges --
create table if not exists public.attention_alerts_sent (
  business_id uuid not null references public.businesses(id),
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (business_id, key)
);
alter table public.attention_alerts_sent enable row level security;

-- who gets the store's alerts: its Business Admins and Sales approvers (active logins)
create or replace function public.attention_recipients(p_business uuid)
returns table(user_id uuid) language sql stable security definer set search_path = public as $$
  select u.id from public.users u
   where u.is_active and u.business_id = p_business
     and (u.role::text = 'business_admin'
          or exists (select 1 from public.user_access ua where ua.user_id = u.id and ua.workflow_role = 'approver'
                       and ua.section_id = (select id from public.sections where code = 'sales')));
$$;
revoke all on function public.attention_recipients(uuid) from public;

-- one store: new red items -> alert; morning summary once a day; agent nudges once a week. Returns notices sent.
create or replace function public.attention_scan(p_business uuid)
returns int language plpgsql security definer set search_path = public as $$
declare c jsonb := public.attention_cfg(p_business); r record; n int := 0; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_hour int := extract(hour from (now() at time zone 'Asia/Manila'))::int; v_store text; v_red int; v_amber int; v_info int; v_top text;
        v_week text := to_char((now() at time zone 'Asia/Manila'), 'IYYY-IW');
begin
  select coalesce(nullif(btrim(trade_name), ''), legal_name) into v_store from public.businesses where id = p_business;
  create temp table if not exists _att(key text, level text, grp text, title text, detail text, url text, since timestamptz, agent_id uuid, phone text) on commit drop;
  truncate _att;
  insert into _att select i.* from public.attention_items(p_business) i
   where not exists (select 1 from public.attention_states s where s.business_id = p_business and s.key = i.key
                       and (s.status = 'done' or (s.status = 'snoozed' and s.until > now())));

  -- red: alert once per item
  for r in select a.* from _att a where a.level = 'red'
             and not exists (select 1 from public.attention_alerts_sent x where x.business_id = p_business and x.key = 'red:' || a.key) loop
    insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
    select p_business, t.user_id, 'sales', 'attention', null, 'Urgent · ' || r.title, r.detail || ' (' || coalesce(v_store, '') || ')', r.url, null
      from public.attention_recipients(p_business) t;
    insert into public.attention_alerts_sent(business_id, key) values (p_business, 'red:' || r.key);
    n := n + 1;
  end loop;

  -- morning summary
  if v_hour >= (c->>'summary_hour')::int
     and not exists (select 1 from public.attention_alerts_sent x where x.business_id = p_business and x.key = 'summary:' || v_today) then
    select count(*) filter (where level = 'red'), count(*) filter (where level = 'amber'), count(*) filter (where level = 'info') into v_red, v_amber, v_info from _att;
    select string_agg('• ' || title, E'\n' order by case level when 'red' then 0 when 'amber' then 1 else 2 end, title)
      into v_top from (select * from _att order by case level when 'red' then 0 when 'amber' then 1 else 2 end, title limit 6) z;
    insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
    select p_business, t.user_id, 'sales', 'attention', null,
           'Good morning · ' || coalesce(v_store, '') || ': ' || case when v_red + v_amber + v_info = 0 then 'nothing needs attention' else v_red || ' urgent, ' || v_amber || ' to watch, ' || v_info || ' follow-ups' end,
           coalesce(v_top, 'All clear.'), '/manager', null
      from public.attention_recipients(p_business) t;
    insert into public.attention_alerts_sent(business_id, key) values (p_business, 'summary:' || v_today);
    n := n + 1;
  end if;

  -- agent behind pace: a nudge in the agent app, at most once a week
  if (c->>'agent_nudge')::int = 1 then
    for r in select a.*, ag.user_id, ag.name from _att a join public.sales_agents ag on ag.id = a.agent_id
              where a.key like 'behind:%' and ag.user_id is not null
                and not exists (select 1 from public.attention_alerts_sent x where x.business_id = p_business and x.key = 'nudge:' || a.agent_id || ':' || v_week) loop
      insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
      values (p_business, r.user_id, 'sales', 'attention', null, 'You are behind your target at ' || coalesce(v_store, 'the store'),
              'So far ' || r.detail || '. Open Home to see what is needed per day and which clients to call.', '/agent', null);
      insert into public.attention_alerts_sent(business_id, key) values (p_business, 'nudge:' || r.agent_id || ':' || v_week);
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.attention_scan(uuid) from public;

-- every store (the background job)
create or replace function public.attention_scan_all()
returns int language plpgsql security definer set search_path = public as $$
declare b record; n int := 0;
begin
  for b in select id from public.businesses where is_active loop
    begin
      n := n + public.attention_scan(b.id);
    exception when others then
      raise warning 'attention_scan %: %', b.id, sqlerrm;   -- one store's problem never stops the others
    end;
  end loop;
  return n;
end $$;
revoke all on function public.attention_scan_all() from public;

-- the Manager app also runs the check for its store when opened (covers a database without pg_cron)
create or replace function public.manager_attention_scan()
returns int language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id();
begin
  if not public.manager_access() or v_b is null then return 0; end if;
  return public.attention_scan(v_b);
end $$;
revoke all on function public.manager_attention_scan() from public;
grant execute on function public.manager_attention_scan() to authenticated;

-- background job: every 5 minutes (Supabase pg_cron). Skipped quietly where pg_cron is not available.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule(jobid) from cron.job where jobname = 'ibx-attention-scan';
      perform cron.schedule('ibx-attention-scan', '*/5 * * * *', 'select public.attention_scan_all()');
    exception when others then
      raise notice 'Background job not scheduled (%). Enable pg_cron in Supabase → Database → Extensions, then run: select cron.schedule(''ibx-attention-scan'', ''*/5 * * * *'', ''select public.attention_scan_all()'');', sqlerrm;
    end;
  else
    raise notice 'pg_cron is not available here; alerts are sent when the Sales Manager app is opened.';
  end if;
end $$;
