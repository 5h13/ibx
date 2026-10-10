-- Build 92 — AGT-01 Part B: agent commission engine, agent quotations.
--
-- Commission (owner decisions 2026-10-03 / 2026-10-10):
--   * base = the markup actually earned on each line: line amount (net of VAT) − acquisition cost × quantity,
--     net of returns. Tier / lower prices already make the base smaller; there is no extra discount penalty.
--   * earned as the customer pays: each line's base × the share of the sale paid so far.
--   * rate = the item category's rate (default 20% of markup) + the month's tier points, capped (30%).
--   * month tier from the agent's paid sales that month: below ₱200,000 −5; ₱200,000 0; ₱300,000 +1;
--     ₱400,000 +2; ₱500,000 +5; then +1 per ₱100,000 (editable brackets per store).
--   * returns take commission back (the base falls); a negative month is carried to the next one.
--   * the Business Admin closes each agent's month: the amounts are frozen (snapshot per line) and an approved
--     Sales expense (Commission) is raised for Finance to post and pay.
--   * sales before the store's commission start date and loaded history sales never earn commission.

-- ---------------------------------------------------------------- settings
create table if not exists public.agent_commission_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  default_rate numeric(7,4) not null default 20 check (default_rate between 0 and 100),
  max_rate numeric(7,4) not null default 30 check (max_rate between 0 and 100),
  start_date date not null default ((now() at time zone 'Asia/Manila')::date),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.agent_commission_rates (
  business_id uuid not null references public.businesses(id) on delete cascade,
  category text not null,
  rate numeric(7,4) not null check (rate between 0 and 100),
  primary key (business_id, category)
);
create table if not exists public.agent_commission_brackets (
  business_id uuid not null references public.businesses(id) on delete cascade,
  min_paid numeric(14,2) not null check (min_paid >= 0),
  points numeric(7,4) not null,
  primary key (business_id, min_paid)
);
alter table public.agent_commission_settings enable row level security;
alter table public.agent_commission_rates enable row level security;
alter table public.agent_commission_brackets enable row level security;
do $$ declare t text; begin
  foreach t in array array['agent_commission_settings', 'agent_commission_rates', 'agent_commission_brackets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_super_admin() or business_id = public.current_business_id())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- every store starts today: earlier sales (and the loaded history) never earn commission
insert into public.agent_commission_settings(business_id) select id from public.businesses on conflict do nothing;
insert into public.agent_commission_brackets(business_id, min_paid, points)
select b.id, x.m, x.p from public.businesses b
cross join (values (0::numeric, -5::numeric), (200000, 0), (300000, 1), (400000, 2), (500000, 5), (600000, 6), (700000, 7), (800000, 8), (900000, 9), (1000000, 10)) x(m, p)
on conflict do nothing;

create or replace function public.agent_commission_settings_of(p_business uuid)
returns public.agent_commission_settings language plpgsql stable security definer set search_path = public as $$
declare s public.agent_commission_settings;
begin
  select * into s from public.agent_commission_settings where business_id = p_business;
  if not found then s.business_id := p_business; s.default_rate := 20; s.max_rate := 30; s.start_date := (now() at time zone 'Asia/Manila')::date; end if;
  return s;
end $$;
revoke all on function public.agent_commission_settings_of(uuid) from public;

create or replace function public.agent_commission_points(p_business uuid, p_paid numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select points from public.agent_commission_brackets where business_id = p_business and min_paid <= coalesce(p_paid, 0) order by min_paid desc limit 1), 0);
$$;
revoke all on function public.agent_commission_points(uuid, numeric) from public;

create or replace function public.agent_commission_settings_save(p_business uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x jsonb;
begin
  if not (public.is_super_admin() or (public.is_business_admin() and p_business = public.current_business_id())) then
    raise exception 'Only the store''s Business Admin sets the commission matrix.';
  end if;
  insert into public.agent_commission_settings(business_id, default_rate, max_rate, start_date, updated_by)
  values (p_business, coalesce((p->>'default_rate')::numeric, 20), coalesce((p->>'max_rate')::numeric, 30),
          coalesce(nullif(p->>'start_date', '')::date, (now() at time zone 'Asia/Manila')::date), auth.uid())
  on conflict (business_id) do update set default_rate = excluded.default_rate, max_rate = excluded.max_rate, start_date = excluded.start_date,
                                          updated_by = excluded.updated_by, updated_at = now();
  if exists (select 1 from public.agent_commission_periods where business_id = p_business)
     and (p->>'start_date') is not null
     and (p->>'start_date')::date > (select min(period) from public.agent_commission_periods where business_id = p_business) then
    raise exception 'The start date cannot move past a month that is already closed.';
  end if;
  if p ? 'rates' then
    delete from public.agent_commission_rates where business_id = p_business;
    for x in select * from jsonb_array_elements(p->'rates') loop
      if coalesce(btrim(x->>'category'), '') = '' or (x->>'rate') is null then continue; end if;
      insert into public.agent_commission_rates(business_id, category, rate) values (p_business, lower(btrim(x->>'category')), (x->>'rate')::numeric)
      on conflict (business_id, category) do update set rate = excluded.rate;
    end loop;
  end if;
  if p ? 'brackets' then
    if jsonb_array_length(p->'brackets') = 0 then raise exception 'Keep at least one tier bracket (from ₱0).'; end if;
    delete from public.agent_commission_brackets where business_id = p_business;
    for x in select * from jsonb_array_elements(p->'brackets') loop
      insert into public.agent_commission_brackets(business_id, min_paid, points) values (p_business, (x->>'min_paid')::numeric, (x->>'points')::numeric)
      on conflict (business_id, min_paid) do update set points = excluded.points;
    end loop;
    if not exists (select 1 from public.agent_commission_brackets where business_id = p_business and min_paid = 0) then
      raise exception 'The first tier bracket must start at ₱0.';
    end if;
  end if;
end $$;
revoke all on function public.agent_commission_settings_save(uuid, jsonb) from public;
grant execute on function public.agent_commission_settings_save(uuid, jsonb) to authenticated;

-- a commission expense account
insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
select b.id, '5400', 'Sales Commission', 'expense', 'Agent / staff commissions'
  from public.businesses b
 where not exists (select 1 from public.finance_chart_of_accounts c where c.business_id = b.id and c.account_code = '5400');
insert into public.admin_expense_categories(code, name, description, gl_account_code)
select 'commission', 'Commission', 'Sales agent / staff commissions', '5400'
where not exists (select 1 from public.admin_expense_categories where code = 'commission');
update public.admin_expense_categories set gl_account_code = '5400' where code = 'commission';

-- ---------------------------------------------------------------- closed months (frozen)
create table if not exists public.agent_commission_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  agent_id uuid not null references public.sales_agents(id),
  period date not null check (extract(day from period) = 1),
  paid_sales numeric(14,2) not null default 0,
  points numeric(7,4) not null default 0,
  earned numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  carried_in numeric(14,2) not null default 0,
  payable numeric(14,2) not null default 0,
  expense_id uuid references public.expenses(id),
  closed_by uuid references public.users(id),
  closed_at timestamptz not null default now(),
  unique (business_id, agent_id, period)
);
create table if not exists public.agent_commission_period_lines (
  period_id uuid not null references public.agent_commission_periods(id) on delete cascade,
  sale_id uuid not null,
  sale_item_id uuid not null,
  cum_base numeric(14,4) not null,
  base_delta numeric(14,4) not null,
  rate numeric(7,4) not null,
  commission numeric(14,2) not null,
  primary key (period_id, sale_item_id)
);
create table if not exists public.agent_commission_period_sales (
  period_id uuid not null references public.agent_commission_periods(id) on delete cascade,
  sale_id uuid not null,
  cum_collected numeric(14,2) not null,
  paid_delta numeric(14,2) not null,
  primary key (period_id, sale_id)
);
create table if not exists public.agent_commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  agent_id uuid not null references public.sales_agents(id),
  period date not null,
  amount numeric(14,2) not null,
  note text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.agent_commission_periods enable row level security;
alter table public.agent_commission_period_lines enable row level security;
alter table public.agent_commission_period_sales enable row level security;
alter table public.agent_commission_adjustments enable row level security;

-- ---------------------------------------------------------------- the engine
-- money collected on a sale up to a moment: payments at the sale − refunds + its share of AR receipts on its invoice
create or replace function public.agent_sale_collected(p_sale uuid, p_upto timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare s record; v_pay numeric; v_ref numeric; v_inv numeric := 0; v_w numeric; v_wsum numeric;
begin
  select * into s from public.storefront_sales where id = p_sale;
  if not found then return 0; end if;
  select coalesce(sum(amount), 0) into v_pay from public.storefront_payments where sale_id = s.id and kind = 'sale' and received_at <= p_upto;
  select coalesce(sum(p.amount), 0) into v_ref from public.storefront_payments p join public.storefront_returns r on r.id = p.return_id
   where r.sale_id = s.id and p.kind = 'refund' and p.received_at <= p_upto;
  if s.ar_invoice_id is not null then
    -- a combined SI can carry several sales: split its receipts by what each sale left unpaid at the counter
    select coalesce(sum(greatest(x.total - coalesce((select sum(amount) from public.storefront_payments where sale_id = x.id and kind = 'sale'), 0), 0)), 0)
      into v_wsum from public.storefront_sales x where x.ar_invoice_id = s.ar_invoice_id and x.status = 'completed';
    v_w := greatest(s.total - coalesce((select sum(amount) from public.storefront_payments where sale_id = s.id and kind = 'sale'), 0), 0);
    if v_wsum > 0 then
      select coalesce(sum(amount), 0) * v_w / v_wsum into v_inv from public.finance_customer_receipts
       where invoice_id = s.ar_invoice_id and status::text = 'posted' and receipt_date <= (p_upto at time zone 'Asia/Manila')::date;
    end if;
  end if;
  return round(v_pay - v_ref + v_inv, 2);
end $$;
revoke all on function public.agent_sale_collected(uuid, timestamptz) from public;

-- every line of the agent's sales, with its markup net of returns and the share paid, up to a moment
create or replace function public.agent_commission_lines(p_business uuid, p_agent uuid, p_upto timestamptz)
returns table(sale_id uuid, sale_item_id uuid, sale_number text, sale_date date, customer text, dr text, item_code text, description text, category text,
              qty_net numeric, markup_net numeric, sale_total_net numeric, collected numeric, paid_share numeric, cum_base numeric, rate_base numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare st public.agent_commission_settings := public.agent_commission_settings_of(p_business); v_day date := (p_upto at time zone 'Asia/Manila')::date;
begin
  return query
  with sales as (
    select s.* from public.storefront_sales s
     where s.business_id = p_business and s.agent_id = p_agent and s.sale_date >= st.start_date and s.sale_date <= v_day
       and coalesce(s.notes, '') not like 'Loaded from%'
       and (s.status = 'completed'
            or exists (select 1 from public.agent_commission_period_lines pl join public.agent_commission_periods pp on pp.id = pl.period_id where pl.sale_id = s.id))
  ), ret as (
    select ri.sale_item_id, sum(ri.quantity) as q from public.storefront_return_items ri join public.storefront_returns r on r.id = ri.return_id
     where r.sale_id in (select id from sales) and r.return_date <= v_day group by 1
  ), rtot as (
    select r.sale_id, sum(r.total) as t from public.storefront_returns r where r.sale_id in (select id from sales) and r.return_date <= v_day group by 1
  ), base as (
    select s.id as sid, i.id as iid, s.sale_number, s.sale_date, c.legal_name, coalesce(s.hardcopy_dr_no, s.dr_number) as dr, i.item_code, i.description,
           coalesce(nullif(btrim(pi.category), ''), '—') as cat,
           case when s.status = 'completed' then i.quantity - coalesce(ret.q, 0) else 0 end as qn,
           i.quantity as q0, i.line_total, coalesce(nullif(i.acquisition_cost, 0), i.unit_cost, 0) as cost,
           case when s.vat_applied and s.total > 0 then 1 - coalesce(s.vat_amount, 0) / s.total else 1 end as net_factor,
           case when s.status = 'completed' then s.total - coalesce(rt.t, 0) else 0 end as tnet,
           s.status
      from sales s join public.storefront_sale_items i on i.sale_id = s.id
      left join public.finance_procurement_items pi on pi.id = i.item_id
      left join public.finance_customers c on c.id = s.customer_id
      left join ret on ret.sale_item_id = i.id
      left join rtot rt on rt.sale_id = s.id
  ), coll as (
    select sid, public.agent_sale_collected(sid, p_upto) as col from (select distinct sid from base) z
  )
  select b.sid, b.iid, b.sale_number, b.sale_date, b.legal_name, b.dr, b.item_code, b.description, b.cat, b.qn,
         round(case when b.q0 > 0 then b.qn * (b.line_total / b.q0 * b.net_factor - b.cost) else 0 end, 4),
         b.tnet, coll.col,
         case when b.tnet > 0 then least(greatest(coll.col / b.tnet, 0), 1) else 0 end,
         round(case when b.q0 > 0 then b.qn * (b.line_total / b.q0 * b.net_factor - b.cost) else 0 end
               * case when b.tnet > 0 then least(greatest(coll.col / b.tnet, 0), 1) else 0 end, 4),
         coalesce((select r.rate from public.agent_commission_rates r where r.business_id = p_business and r.category = lower(b.cat)), st.default_rate)
    from base b join coll on coll.sid = b.sid;
end $$;
revoke all on function public.agent_commission_lines(uuid, uuid, timestamptz) from public;

-- one agent's month: frozen when closed, else computed now (late payments of closed months land in the open month)
create or replace function public.agent_commission_month_calc(p_business uuid, p_agent uuid, p_month date, p_with_lines boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st public.agent_commission_settings := public.agent_commission_settings_of(p_business);
        v_month date := date_trunc('month', p_month)::date; v_end timestamptz; per record; last record; v_paid numeric; v_points numeric;
        v_earned numeric; v_adj numeric; v_carry numeric; v_lines jsonb; v_next record; v_open boolean;
begin
  select * into per from public.agent_commission_periods where business_id = p_business and agent_id = p_agent and period = v_month;
  if found then
    return jsonb_build_object('month', v_month, 'closed', true, 'paid_sales', per.paid_sales, 'points', per.points, 'earned', per.earned,
      'adjustments', per.adjustments, 'carried_in', per.carried_in, 'payable', per.payable, 'period_id', per.id, 'closed_at', per.closed_at,
      'expense_status', (select status::text from public.expenses where id = per.expense_id),
      'adjustment_lines', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'note', a.note) order by a.created_at)
                                     from public.agent_commission_adjustments a where a.business_id = p_business and a.agent_id = p_agent and a.period = v_month), '[]'::jsonb),
      'lines', case when p_with_lines then coalesce((select jsonb_agg(jsonb_build_object('sale_number', s.sale_number, 'sale_date', s.sale_date,
                  'dr', coalesce(s.hardcopy_dr_no, s.dr_number), 'customer', c.legal_name, 'item_code', i.item_code, 'description', i.description,
                  'base_delta', round(l.base_delta, 2), 'cum_base', round(l.cum_base, 2), 'rate', l.rate, 'commission', l.commission) order by s.sale_date, s.sale_number)
                  from public.agent_commission_period_lines l join public.storefront_sales s on s.id = l.sale_id join public.storefront_sale_items i on i.id = l.sale_item_id
                  left join public.finance_customers c on c.id = s.customer_id
                 where l.period_id = per.id and (l.commission <> 0 or l.base_delta <> 0)), '[]'::jsonb) else '[]'::jsonb end);
  end if;
  v_open := v_month >= coalesce((select max(period) from public.agent_commission_periods where business_id = p_business and agent_id = p_agent), '1900-01-01'::date);
  if not v_open then
    return jsonb_build_object('month', v_month, 'closed', false, 'skipped', true, 'paid_sales', 0, 'points', 0, 'earned', 0, 'adjustments', 0, 'carried_in', 0, 'payable', 0, 'lines', '[]'::jsonb,
                              'note', 'A later month is already closed; this month''s amounts are counted there.');
  end if;
  v_end := least(((v_month + interval '1 month')::timestamp at time zone 'Asia/Manila'), now());
  select * into last from public.agent_commission_periods where business_id = p_business and agent_id = p_agent and period < v_month order by period desc limit 1;
  create temp table if not exists _acl(sale_id uuid, sale_item_id uuid, sale_number text, sale_date date, customer text, dr text, item_code text, description text,
                                       category text, qty_net numeric, markup_net numeric, sale_total_net numeric, collected numeric, paid_share numeric, cum_base numeric, rate_base numeric) on commit drop;
  delete from _acl;
  insert into _acl select * from public.agent_commission_lines(p_business, p_agent, v_end);
  -- paid sales this month = collected now − collected at the last close
  select coalesce(sum(x.col - coalesce(ps.cum_collected, 0)), 0) into v_paid
    from (select distinct sale_id, collected as col from _acl) x
    left join lateral (select s2.cum_collected from public.agent_commission_period_sales s2 join public.agent_commission_periods p2 on p2.id = s2.period_id
                        where s2.sale_id = x.sale_id and p2.business_id = p_business and p2.agent_id = p_agent order by p2.period desc limit 1) ps on true;
  v_points := public.agent_commission_points(p_business, v_paid);
  select coalesce(sum(round((a.cum_base - coalesce(pl.cum_base, 0)) * greatest(least(a.rate_base + v_points, st.max_rate), 0) / 100, 2)), 0),
         case when p_with_lines then coalesce(jsonb_agg(jsonb_build_object('sale_number', a.sale_number, 'sale_date', a.sale_date, 'dr', a.dr, 'customer', a.customer,
                   'item_code', a.item_code, 'description', a.description, 'category', a.category, 'markup', round(a.markup_net, 2), 'paid_share', round(a.paid_share, 4),
                   'base_delta', round(a.cum_base - coalesce(pl.cum_base, 0), 2), 'rate', greatest(least(a.rate_base + v_points, st.max_rate), 0),
                   'commission', round((a.cum_base - coalesce(pl.cum_base, 0)) * greatest(least(a.rate_base + v_points, st.max_rate), 0) / 100, 2))
                   order by a.sale_date, a.sale_number) filter (where abs(a.cum_base - coalesce(pl.cum_base, 0)) >= 0.005), '[]'::jsonb) else '[]'::jsonb end
    into v_earned, v_lines
    from _acl a
    left join lateral (select l2.cum_base from public.agent_commission_period_lines l2 join public.agent_commission_periods p2 on p2.id = l2.period_id
                        where l2.sale_item_id = a.sale_item_id and p2.business_id = p_business and p2.agent_id = p_agent order by p2.period desc limit 1) pl on true;
  select coalesce(sum(amount), 0) into v_adj from public.agent_commission_adjustments where business_id = p_business and agent_id = p_agent and period = v_month;
  v_carry := case when last.payable < 0 then last.payable else 0 end;
  select min_paid, points into v_next from public.agent_commission_brackets where business_id = p_business and min_paid > v_paid order by min_paid limit 1;
  return jsonb_build_object('month', v_month, 'closed', false, 'as_of', v_end, 'paid_sales', round(v_paid, 2), 'points', v_points,
    'next_bracket', v_next.min_paid, 'next_points', v_next.points, 'earned', v_earned, 'adjustments', v_adj, 'carried_in', coalesce(v_carry, 0),
    'payable', v_earned + v_adj + coalesce(v_carry, 0), 'default_rate', st.default_rate, 'max_rate', st.max_rate,
    'waiting', (select coalesce(round(sum(markup_net * (1 - paid_share) * least(rate_base, st.max_rate) / 100), 2), 0) from _acl where paid_share < 1),
    'adjustment_lines', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'note', a.note) order by a.created_at)
                                   from public.agent_commission_adjustments a where a.business_id = p_business and a.agent_id = p_agent and a.period = v_month), '[]'::jsonb),
    'lines', v_lines);
end $$;
revoke all on function public.agent_commission_month_calc(uuid, uuid, date, boolean) from public;

-- who may see a store's commission figures: Business Admin, Finance, the Sales approver
create or replace function public.can_view_agent_commission(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or (p_business = public.current_business_id() and (public.is_business_admin() or public.has_section_access('finance')
          or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                      where ua.user_id = auth.uid() and s.code = 'sales' and ua.workflow_role = 'approver')));
$$;
revoke all on function public.can_view_agent_commission(uuid) from public;
grant execute on function public.can_view_agent_commission(uuid) to authenticated;

-- staff: all freelance agents of the store for a month
create or replace function public.agent_commission_overview(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); a record; out jsonb := '[]'::jsonb;
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not public.can_view_agent_commission(b) then raise exception 'Commission figures are for the Business Admin, Finance and the Sales approver.'; end if;
  for a in select * from public.sales_agents where kind = 'freelance' and (active or exists (select 1 from public.storefront_sales s where s.agent_id = sales_agents.id and s.business_id = b)) order by name loop
    out := out || (public.agent_commission_month_calc(b, a.id, p_month, false) || jsonb_build_object('agent_id', a.id, 'agent', a.name, 'agent_code', a.agent_code, 'active', a.active));
  end loop;
  return jsonb_build_object('month', date_trunc('month', p_month)::date, 'settings', to_jsonb(public.agent_commission_settings_of(b)),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'rate', rate) order by category) from public.agent_commission_rates where business_id = b), '[]'::jsonb),
    'brackets', coalesce((select jsonb_agg(jsonb_build_object('min_paid', min_paid, 'points', points) order by min_paid) from public.agent_commission_brackets where business_id = b), '[]'::jsonb),
    'agents', out);
end $$;
revoke all on function public.agent_commission_overview(date) from public;
grant execute on function public.agent_commission_overview(date) to authenticated;

create or replace function public.agent_commission_statement(p_agent uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not public.can_view_agent_commission(b) then raise exception 'Commission figures are for the Business Admin, Finance and the Sales approver.'; end if;
  return public.agent_commission_month_calc(b, p_agent, p_month, true);
end $$;
revoke all on function public.agent_commission_statement(uuid, date) from public;
grant execute on function public.agent_commission_statement(uuid, date) to authenticated;

create or replace function public.agent_commission_adjust(p_agent uuid, p_month date, p_amount numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_month date := date_trunc('month', p_month)::date;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin adds commission adjustments.'; end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Enter the amount (negative for a deduction).'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Say what the adjustment is for.'; end if;
  if exists (select 1 from public.agent_commission_periods where business_id = b and agent_id = p_agent and period >= v_month) then
    raise exception 'That month (or a later one) is already closed; add it to the open month.';
  end if;
  insert into public.agent_commission_adjustments(business_id, agent_id, period, amount, note, created_by) values (b, p_agent, v_month, round(p_amount, 2), btrim(p_note), auth.uid());
end $$;
revoke all on function public.agent_commission_adjust(uuid, date, numeric, text) from public;
grant execute on function public.agent_commission_adjust(uuid, date, numeric, text) to authenticated;

create or replace function public.agent_commission_adjust_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); a record;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin changes commission adjustments.'; end if;
  select * into a from public.agent_commission_adjustments where id = p_id and business_id = b;
  if not found then raise exception 'Adjustment not found.'; end if;
  if exists (select 1 from public.agent_commission_periods where business_id = b and agent_id = a.agent_id and period >= a.period) then raise exception 'That month is closed.'; end if;
  delete from public.agent_commission_adjustments where id = p_id;
end $$;
revoke all on function public.agent_commission_adjust_delete(uuid) from public;
grant execute on function public.agent_commission_adjust_delete(uuid) to authenticated;

-- close an agent's month: freeze per line / per sale, raise the Commission expense for Finance to pay
create or replace function public.agent_commission_close(p_agent uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); st public.agent_commission_settings; v_month date := date_trunc('month', p_month)::date; r jsonb; v_end timestamptz;
        v_pid uuid; a record; v_exp uuid; v_section uuid; v_mid uuid; v_label text; v_points numeric; last record;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin closes commission months.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  st := public.agent_commission_settings_of(b);
  if (v_month + interval '1 month')::date > (now() at time zone 'Asia/Manila')::date then raise exception 'The month is not over yet.'; end if;
  if v_month < date_trunc('month', st.start_date)::date then raise exception 'Commission starts on %; nothing to close before it.', st.start_date; end if;
  if exists (select 1 from public.agent_commission_periods where business_id = b and agent_id = p_agent and period >= v_month) then raise exception 'This month (or a later one) is already closed.'; end if;
  select * into a from public.sales_agents where id = p_agent;
  r := public.agent_commission_month_calc(b, p_agent, v_month, false);
  v_points := (r->>'points')::numeric;
  v_end := ((v_month + interval '1 month')::timestamp at time zone 'Asia/Manila');
  insert into public.agent_commission_periods(business_id, agent_id, period, paid_sales, points, earned, adjustments, carried_in, payable, closed_by)
  values (b, p_agent, v_month, (r->>'paid_sales')::numeric, v_points, (r->>'earned')::numeric, (r->>'adjustments')::numeric, (r->>'carried_in')::numeric, (r->>'payable')::numeric, auth.uid())
  returning id into v_pid;
  -- freeze the cumulative position of every line and sale (the next month counts from here)
  insert into public.agent_commission_period_lines(period_id, sale_id, sale_item_id, cum_base, base_delta, rate, commission)
  select v_pid, l.sale_id, l.sale_item_id, l.cum_base, l.cum_base - coalesce(pl.cum_base, 0), greatest(least(l.rate_base + v_points, st.max_rate), 0),
         round((l.cum_base - coalesce(pl.cum_base, 0)) * greatest(least(l.rate_base + v_points, st.max_rate), 0) / 100, 2)
    from public.agent_commission_lines(b, p_agent, v_end) l
    left join lateral (select l2.cum_base from public.agent_commission_period_lines l2 join public.agent_commission_periods p2 on p2.id = l2.period_id
                        where l2.sale_item_id = l.sale_item_id and p2.business_id = b and p2.agent_id = p_agent and p2.id <> v_pid order by p2.period desc limit 1) pl on true;
  insert into public.agent_commission_period_sales(period_id, sale_id, cum_collected, paid_delta)
  select v_pid, x.sale_id, x.collected, x.collected - coalesce(ps.cum_collected, 0)
    from (select distinct sale_id, collected from public.agent_commission_lines(b, p_agent, v_end)) x
    left join lateral (select s2.cum_collected from public.agent_commission_period_sales s2 join public.agent_commission_periods p2 on p2.id = s2.period_id
                        where s2.sale_id = x.sale_id and p2.business_id = b and p2.agent_id = p_agent and p2.id <> v_pid order by p2.period desc limit 1) ps on true;
  -- the frozen lines are the truth for this month
  update public.agent_commission_periods set earned = coalesce((select sum(commission) from public.agent_commission_period_lines where period_id = v_pid), 0) where id = v_pid;
  update public.agent_commission_periods set payable = earned + adjustments + carried_in where id = v_pid;
  select * into last from public.agent_commission_periods where id = v_pid;
  if last.payable > 0 then
    select id into v_section from public.sections where code = 'sales';
    v_label := to_char(v_month, 'FMMonth YYYY');
    select id into v_mid from public.months where business_id = b and year = extract(year from v_month) and month = extract(month from v_month);
    if v_mid is null then
      insert into public.months(business_id, year, month, label) values (b, extract(year from v_month), extract(month from v_month), v_label) returning id into v_mid;
    end if;
    insert into public.expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id, vendor, payment_method,
                                document_reference, notes, prepared_by, prepared_at, approved_by, approved_at)
    values (v_section, v_mid, b, 'Agent commission — ' || a.name || ' — ' || v_label, last.payable, 'approved', (v_month + interval '1 month' - interval '1 day')::date,
            (select id from public.admin_expense_categories where code = 'commission'), a.name, 'Payout to agent', 'COM-' || a.agent_code || '-' || to_char(v_month, 'YYYY-MM'),
            'Paid sales ₱' || last.paid_sales || ', tier ' || last.points || ' pts' || case when last.adjustments <> 0 then ', adjustments ₱' || last.adjustments else '' end
              || case when last.carried_in <> 0 then ', carried in ₱' || last.carried_in else '' end,
            a.user_id, now(), auth.uid(), now())
    returning id into v_exp;
    update public.agent_commission_periods set expense_id = v_exp where id = v_pid;
  end if;
  return jsonb_build_object('period_id', v_pid, 'payable', last.payable, 'expense_id', v_exp);
end $$;
revoke all on function public.agent_commission_close(uuid, date) from public;
grant execute on function public.agent_commission_close(uuid, date) to authenticated;

-- agent: his own month (this month by default) and his closed months, per store
create or replace function public.agent_commission_mine(p_business uuid, p_month date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  perform public.agent_check_store(p_business);
  return public.agent_commission_month_calc(p_business, v, coalesce(p_month, (now() at time zone 'Asia/Manila')::date), true)
    || jsonb_build_object('history', coalesce((select jsonb_agg(jsonb_build_object('month', p.period, 'paid_sales', p.paid_sales, 'points', p.points, 'earned', p.earned,
            'adjustments', p.adjustments, 'carried_in', p.carried_in, 'payable', p.payable, 'expense_status', (select status::text from public.expenses where id = p.expense_id)) order by p.period desc)
          from public.agent_commission_periods p where p.business_id = p_business and p.agent_id = v), '[]'::jsonb),
       'brackets', coalesce((select jsonb_agg(jsonb_build_object('min_paid', min_paid, 'points', points) order by min_paid) from public.agent_commission_brackets where business_id = p_business), '[]'::jsonb),
       'rates', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'rate', rate) order by category) from public.agent_commission_rates where business_id = p_business), '[]'::jsonb));
end $$;
revoke all on function public.agent_commission_mine(uuid, date) from public;
grant execute on function public.agent_commission_mine(uuid, date) to authenticated;

-- ---------------------------------------------------------------- agent quotations
-- the price of one line for the agent's client: tier / own price checked like orders (Tier 4 .. store price)
create or replace function public.agent_line_price(p_business uuid, p_customer uuid, p_item uuid, p_tier int, p_price numeric)
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, acquisition_cost numeric, floor_price numeric, unit_price numeric)
language plpgsql stable security definer set search_path = public as $$
declare c public.finance_customers := public.agent_client(p_customer, p_business); pr record; v_client numeric; v_bottom numeric; v_price numeric;
begin
  select * into pr from public.storefront_item_price(p_item, p_business);
  if pr.item_id is null or pr.list_price is null then raise exception 'An item has no store price in this store.'; end if;
  v_client := public.agent_client_price(p_business, c.id, pr.item_id, c.price_tier, pr.list_price, pr.acquisition_cost, pr.floor_price);
  v_bottom := least(public.tier_price(p_business, 4, pr.list_price, pr.acquisition_cost, pr.floor_price), v_client);
  if p_price is not null then
    v_price := round(p_price, 2);
    if v_price < v_bottom then raise exception '%: the lowest price you can give is ₱% (Tier 4).', pr.item_name, v_bottom; end if;
    if v_price > pr.list_price then raise exception '%: the price cannot be above the store price ₱%.', pr.item_name, pr.list_price; end if;
  elsif p_tier is not null then
    if p_tier not between 1 and 4 then raise exception 'The tier is 1 to 4.'; end if;
    v_price := public.tier_price(p_business, p_tier, pr.list_price, pr.acquisition_cost, pr.floor_price);
  else
    v_price := v_client;
  end if;
  return query select pr.item_id, pr.item_code, pr.item_name, pr.unit, pr.item_type, pr.list_price, pr.acquisition_cost, pr.floor_price, v_price;
end $$;
revoke all on function public.agent_line_price(uuid, uuid, uuid, int, numeric) from public;

create or replace function public.agent_quote_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); b uuid := (p->>'business_id')::uuid; c public.finance_customers; l jsonb; lp record; v_q uuid; v_sub numeric := 0; v_qty numeric;
        v_today date := (now() at time zone 'Asia/Manila')::date; v_user uuid := auth.uid();
begin
  perform public.agent_check_store(b);
  c := public.agent_client((p->>'customer_id')::uuid, b);
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  insert into public.sales_quotations(business_id, customer_id, quotation_date, valid_until, subtotal, discount_amount, tax_amount, other_charges,
                                      status, notes, payment_terms, delivery_lead_time, prepared_by, prepared_at, created_by)
  values (b, c.id, v_today, coalesce(nullif(p->>'valid_until', '')::date, v_today + 15), 0, 0, 0, 0, 'prepared',
          nullif(btrim(p->>'notes'), ''), nullif(btrim(p->>'payment_terms'), ''), nullif(btrim(p->>'delivery_lead_time'), ''), v_user, now(), v_user)
  returning id into v_q;
  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := round(coalesce((l->>'quantity')::numeric, 0), 3);
    if v_qty <= 0 then raise exception 'Every line needs a quantity.'; end if;
    select * into lp from public.agent_line_price(b, c.id, (l->>'item_id')::uuid, nullif(l->>'tier', '')::int, nullif(l->>'unit_price', '')::numeric);
    insert into public.sales_quotation_items(business_id, quotation_id, catalog_item_id, description, quantity, unit, unit_price,
                                             pricing_acquisition_cost, pricing_srp, pricing_item_type, pricing_snapshot_at, notes)
    values (b, v_q, lp.item_id, lp.item_name, v_qty, coalesce(lp.unit, 'unit'), lp.unit_price, lp.acquisition_cost, lp.list_price,
            coalesce(lp.item_type, 'product'), now(), case when nullif(l->>'tier', '') is not null then 'Tier ' || (l->>'tier') end);
    v_sub := v_sub + round(v_qty * lp.unit_price, 2);
  end loop;
  update public.sales_quotations set subtotal = v_sub where id = v_q;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (v_user, 'sales_quotations', v_q, 'agent_quotation_prepared', jsonb_build_object('agent_id', v, 'subtotal', v_sub));
  return v_q;
end $$;
revoke all on function public.agent_quote_save(jsonb) from public;
grant execute on function public.agent_quote_save(jsonb) to authenticated;

create or replace function public.agent_quotes_list(p_business uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'quotation_number', q.quotation_number, 'business_id', q.business_id, 'status', q.status::text,
            'quotation_date', q.quotation_date, 'valid_until', q.valid_until, 'total_amount', q.total_amount, 'customer', c.legal_name, 'notes', q.notes,
            'order_number', (select o.order_number from public.sales_orders o where o.quotation_id = q.id limit 1),
            'items', (select count(*) from public.sales_quotation_items i where i.quotation_id = q.id)) order by q.created_at desc)
          from public.sales_quotations q join public.finance_customers c on c.id = q.customer_id
         where q.agent_id = v and (p_business is null or q.business_id = p_business)), '[]'::jsonb);
end $$;
revoke all on function public.agent_quotes_list(uuid) from public;
grant execute on function public.agent_quotes_list(uuid) to authenticated;

-- internal helpers: not callable from the API
do $$
declare f text; r text;
begin
  foreach f in array array[
    'public.agent_commission_settings_of(uuid)', 'public.agent_commission_points(uuid, numeric)', 'public.agent_sale_collected(uuid, timestamptz)',
    'public.agent_commission_lines(uuid, uuid, timestamptz)', 'public.agent_commission_month_calc(uuid, uuid, date, boolean)',
    'public.agent_line_price(uuid, uuid, uuid, int, numeric)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
  end loop;
end $$;
