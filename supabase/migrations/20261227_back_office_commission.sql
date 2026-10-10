-- Build 93 — ISHABELLA's commission workbook made general for every store (rates editable per store):
--   * agents: online agents (flat online rate, no tiers), agent expenses deducted from commission (store option),
--     savings held back from direct agents' commission ((commission − agent expenses) × savings %), released by the Business Admin.
--     ISHABELLA's 20% / 30% above ₱200,000 is set with the existing brackets (₱0 → 0, ₱200,000.01 → +10, default 20%, max 30%).
--   * Back Office Commission, per store and month, from the app's own figures:
--       overall gross sales (paid and unpaid) and gross sales per item category; net sales = gross profit;
--       monthly expenses = the month's expenses, payroll and accruals (as the budget reads them), without commission;
--       bottomline before back office commission = net sales − monthly expenses;
--       store gross (paid) = money collected that month on the store's own sales (Store agent).
--     Plans (each paid to the employees named on it, split equally):
--       manager       — per category: (category gross − (expenses + agent commission) × category share of gross) × category rate
--       sales_staff   — if store gross (paid) > threshold: (store gross − expenses × store gross ÷ overall gross) × rate
--       agent_share   — (the agent's paid gross sales − his approved expenses) × rate          (ISHABELLA: Raymart / Ikot)
--       department    — if bottomline before BO commission > threshold: bottomline × rate, split among the department's staff
--     true bottomline = bottomline − back office commission; tithes = true bottomline × tithes %; offering = tithes × multiplier.
--   * The Business Admin closes the month: amounts freeze and each person's total becomes an approved Commission expense.

alter table public.sales_agents add column if not exists online boolean not null default false;
alter table public.agent_commission_settings add column if not exists online_rate numeric(7,4) not null default 20 check (online_rate between 0 and 100);
alter table public.agent_commission_settings add column if not exists savings_rate numeric(7,4) not null default 0 check (savings_rate between 0 and 100);
alter table public.agent_commission_settings add column if not exists deduct_agent_expenses boolean not null default false;
alter table public.agent_commission_periods add column if not exists expense_deduction numeric(14,2) not null default 0;
alter table public.agent_commission_periods add column if not exists savings numeric(14,2) not null default 0;

-- ISHABELLA's agent rule (if the store exists): 20% up to ₱200,000 paid, 30% above; online 20%; 5% savings; expenses deducted
do $$
declare b uuid;
begin
  select id into b from public.businesses where upper(code) like 'ISH%' or upper(coalesce(trade_name, legal_name)) like 'ISHABELLA%' order by created_at limit 1;
  if b is null then return; end if;
  update public.agent_commission_settings set default_rate = 20, max_rate = 30, online_rate = 20, savings_rate = 5, deduct_agent_expenses = true where business_id = b;
  delete from public.agent_commission_brackets where business_id = b;
  insert into public.agent_commission_brackets(business_id, min_paid, points) values (b, 0, 0), (b, 200000.01, 10);
end $$;

create table if not exists public.agent_savings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  agent_id uuid not null references public.sales_agents(id),
  period_id uuid references public.agent_commission_periods(id) on delete cascade,
  entry_date date not null,
  amount numeric(14,2) not null,          -- + held back, − released
  note text,
  expense_id uuid references public.expenses(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.agent_savings enable row level security;

create or replace function public.sales_agent_set_online(p_agent uuid, p_online boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin changes agents.'; end if;
  update public.sales_agents set online = coalesce(p_online, false), updated_at = now() where id = p_agent and kind = 'freelance';
  if not found then raise exception 'Only a freelance agent can be an online agent.'; end if;
end $$;
revoke all on function public.sales_agent_set_online(uuid, boolean) from public;
grant execute on function public.sales_agent_set_online(uuid, boolean) to authenticated;

-- the agent settings save now also takes online_rate, savings_rate, deduct_agent_expenses
create or replace function public.agent_commission_options_save(p_business uuid, p_online_rate numeric, p_savings_rate numeric, p_deduct boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_super_admin() or (public.is_business_admin() and p_business = public.current_business_id())) then
    raise exception 'Only the store''s Business Admin sets the commission matrix.';
  end if;
  insert into public.agent_commission_settings(business_id) values (p_business) on conflict do nothing;
  update public.agent_commission_settings set online_rate = coalesce(p_online_rate, online_rate), savings_rate = coalesce(p_savings_rate, savings_rate),
         deduct_agent_expenses = coalesce(p_deduct, deduct_agent_expenses), updated_by = auth.uid(), updated_at = now()
   where business_id = p_business;
end $$;
revoke all on function public.agent_commission_options_save(uuid, numeric, numeric, boolean) from public;
grant execute on function public.agent_commission_options_save(uuid, numeric, numeric, boolean) to authenticated;

create or replace function public.agent_savings_balance(p_business uuid, p_agent uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.agent_savings where business_id = p_business and agent_id = p_agent;
$$;
revoke all on function public.agent_savings_balance(uuid, uuid) from public;

-- release (part of) an agent's savings: an approved Commission expense for Finance to pay
create or replace function public.agent_savings_release(p_agent uuid, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); a record; v_bal numeric; v_amt numeric := round(coalesce(p_amount, 0), 2); v_exp uuid; v_mid uuid;
        v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin releases agent savings.'; end if;
  select * into a from public.sales_agents where id = p_agent;
  v_bal := public.agent_savings_balance(b, p_agent);
  if v_amt <= 0 then raise exception 'Enter the amount to release.'; end if;
  if v_amt > v_bal then raise exception 'Only ₱% is saved for %.', v_bal, a.name; end if;
  select id into v_mid from public.months where business_id = b and year = extract(year from v_today) and month = extract(month from v_today);
  if v_mid is null then
    insert into public.months(business_id, year, month, label) values (b, extract(year from v_today), extract(month from v_today), to_char(v_today, 'FMMonth YYYY')) returning id into v_mid;
  end if;
  insert into public.expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id, vendor, payment_method, notes, approved_by, approved_at)
  values ((select id from public.sections where code = 'sales'), v_mid, b, 'Agent savings released — ' || a.name, v_amt, 'approved', v_today,
          (select id from public.admin_expense_categories where code = 'commission'), a.name, 'Payout to agent', nullif(btrim(p_note), ''), auth.uid(), now())
  returning id into v_exp;
  insert into public.agent_savings(business_id, agent_id, entry_date, amount, note, expense_id, created_by)
  values (b, p_agent, v_today, -v_amt, coalesce(nullif(btrim(p_note), ''), 'Savings released'), v_exp, auth.uid());
  return v_exp;
end $$;
revoke all on function public.agent_savings_release(uuid, numeric, text) from public;
grant execute on function public.agent_savings_release(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------- engine with online agents, expense deduction and savings
create or replace function public.agent_commission_month_calc(p_business uuid, p_agent uuid, p_month date, p_with_lines boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st public.agent_commission_settings := public.agent_commission_settings_of(p_business);
        v_month date := date_trunc('month', p_month)::date; v_end timestamptz; per record; last record; v_paid numeric; v_points numeric;
        v_earned numeric; v_adj numeric; v_carry numeric; v_lines jsonb; v_next record; v_open boolean;
        v_online boolean := coalesce((select online from public.sales_agents where id = p_agent), false); v_expd numeric := 0; v_sav numeric := 0;
begin
  select * into per from public.agent_commission_periods where business_id = p_business and agent_id = p_agent and period = v_month;
  if found then
    return jsonb_build_object('month', v_month, 'closed', true, 'paid_sales', per.paid_sales, 'points', per.points, 'earned', per.earned,
      'adjustments', per.adjustments, 'carried_in', per.carried_in, 'expense_deduction', per.expense_deduction, 'savings', per.savings, 'online', v_online,
      'payable', per.payable, 'period_id', per.id, 'closed_at', per.closed_at,
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
  delete from _acl where true;
  insert into _acl select * from public.agent_commission_lines(p_business, p_agent, v_end);
  -- paid sales this month = collected now − collected at the last close
  select coalesce(sum(x.col - coalesce(ps.cum_collected, 0)), 0) into v_paid
    from (select distinct sale_id, collected as col from _acl) x
    left join lateral (select s2.cum_collected from public.agent_commission_period_sales s2 join public.agent_commission_periods p2 on p2.id = s2.period_id
                        where s2.sale_id = x.sale_id and p2.business_id = p_business and p2.agent_id = p_agent order by p2.period desc limit 1) ps on true;
  v_points := case when v_online then 0 else public.agent_commission_points(p_business, v_paid) end;
  select coalesce(sum(round((a.cum_base - coalesce(pl.cum_base, 0)) * (case when v_online then st.online_rate else greatest(least(a.rate_base + v_points, st.max_rate), 0) end) / 100, 2)), 0),
         case when p_with_lines then coalesce(jsonb_agg(jsonb_build_object('sale_number', a.sale_number, 'sale_date', a.sale_date, 'dr', a.dr, 'customer', a.customer,
                   'item_code', a.item_code, 'description', a.description, 'category', a.category, 'markup', round(a.markup_net, 2), 'paid_share', round(a.paid_share, 4),
                   'base_delta', round(a.cum_base - coalesce(pl.cum_base, 0), 2), 'rate', (case when v_online then st.online_rate else greatest(least(a.rate_base + v_points, st.max_rate), 0) end),
                   'commission', round((a.cum_base - coalesce(pl.cum_base, 0)) * (case when v_online then st.online_rate else greatest(least(a.rate_base + v_points, st.max_rate), 0) end) / 100, 2))
                   order by a.sale_date, a.sale_number) filter (where abs(a.cum_base - coalesce(pl.cum_base, 0)) >= 0.005), '[]'::jsonb) else '[]'::jsonb end
    into v_earned, v_lines
    from _acl a
    left join lateral (select l2.cum_base from public.agent_commission_period_lines l2 join public.agent_commission_periods p2 on p2.id = l2.period_id
                        where l2.sale_item_id = a.sale_item_id and p2.business_id = p_business and p2.agent_id = p_agent order by p2.period desc limit 1) pl on true;
  select coalesce(sum(amount), 0) into v_adj from public.agent_commission_adjustments where business_id = p_business and agent_id = p_agent and period = v_month;
  v_carry := case when last.payable < 0 then last.payable else 0 end;
  -- Build 93: agent expenses deducted from the commission (store setting) and savings held back (direct agents)
  if st.deduct_agent_expenses then
    select coalesce(sum(amount), 0) into v_expd from public.agent_expenses
     where business_id = p_business and agent_id = p_agent and status = 'approved' and date_trunc('month', expense_date)::date = v_month;
  end if;
  if not v_online and st.savings_rate > 0 then v_sav := round(greatest(v_earned - v_expd, 0) * st.savings_rate / 100, 2); end if;
  select min_paid, points into v_next from public.agent_commission_brackets where business_id = p_business and min_paid > v_paid order by min_paid limit 1;
  return jsonb_build_object('month', v_month, 'closed', false, 'as_of', v_end, 'paid_sales', round(v_paid, 2), 'points', v_points,
    'next_bracket', v_next.min_paid, 'next_points', v_next.points, 'earned', v_earned, 'adjustments', v_adj, 'carried_in', coalesce(v_carry, 0),
    'expense_deduction', v_expd, 'savings', v_sav, 'online', v_online, 'online_rate', st.online_rate, 'savings_rate', st.savings_rate,
    'payable', v_earned + v_adj + coalesce(v_carry, 0) - v_expd - v_sav, 'default_rate', st.default_rate, 'max_rate', st.max_rate,
    'waiting', (select coalesce(round(sum(markup_net * (1 - paid_share) * (case when v_online then st.online_rate else least(rate_base, st.max_rate) end) / 100), 2), 0) from _acl where paid_share < 1),
    'adjustment_lines', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'note', a.note) order by a.created_at)
                                   from public.agent_commission_adjustments a where a.business_id = p_business and a.agent_id = p_agent and a.period = v_month), '[]'::jsonb),
    'lines', v_lines);
end $$;

create or replace function public.agent_commission_close(p_agent uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); st public.agent_commission_settings; v_month date := date_trunc('month', p_month)::date; r jsonb; v_end timestamptz;
        v_pid uuid; a record; v_exp uuid; v_section uuid; v_mid uuid; v_label text; v_points numeric; last record; v_online boolean; v_expd numeric; v_sav numeric;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin closes commission months.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  st := public.agent_commission_settings_of(b);
  if (v_month + interval '1 month')::date > (now() at time zone 'Asia/Manila')::date then raise exception 'The month is not over yet.'; end if;
  if v_month < date_trunc('month', st.start_date)::date then raise exception 'Commission starts on %; nothing to close before it.', st.start_date; end if;
  if exists (select 1 from public.agent_commission_periods where business_id = b and agent_id = p_agent and period >= v_month) then raise exception 'This month (or a later one) is already closed.'; end if;
  select * into a from public.sales_agents where id = p_agent;
  v_online := coalesce(a.online, false);
  r := public.agent_commission_month_calc(b, p_agent, v_month, false);
  v_points := (r->>'points')::numeric;
  v_end := ((v_month + interval '1 month')::timestamp at time zone 'Asia/Manila');
  insert into public.agent_commission_periods(business_id, agent_id, period, paid_sales, points, earned, adjustments, carried_in, expense_deduction, savings, payable, closed_by)
  values (b, p_agent, v_month, (r->>'paid_sales')::numeric, v_points, (r->>'earned')::numeric, (r->>'adjustments')::numeric, (r->>'carried_in')::numeric,
          coalesce((r->>'expense_deduction')::numeric, 0), 0, (r->>'payable')::numeric, auth.uid())
  returning id into v_pid;
  -- freeze the cumulative position of every line and sale (the next month counts from here)
  insert into public.agent_commission_period_lines(period_id, sale_id, sale_item_id, cum_base, base_delta, rate, commission)
  select v_pid, l.sale_id, l.sale_item_id, l.cum_base, l.cum_base - coalesce(pl.cum_base, 0), (case when v_online then st.online_rate else greatest(least(l.rate_base + v_points, st.max_rate), 0) end),
         round((l.cum_base - coalesce(pl.cum_base, 0)) * (case when v_online then st.online_rate else greatest(least(l.rate_base + v_points, st.max_rate), 0) end) / 100, 2)
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
  select earned into v_sav from public.agent_commission_periods where id = v_pid;
  v_expd := coalesce((r->>'expense_deduction')::numeric, 0);
  v_sav := case when not v_online and st.savings_rate > 0 then round(greatest(v_sav - v_expd, 0) * st.savings_rate / 100, 2) else 0 end;
  update public.agent_commission_periods set savings = v_sav, payable = earned + adjustments + carried_in - expense_deduction - v_sav where id = v_pid;
  if v_sav > 0 then
    insert into public.agent_savings(business_id, agent_id, period_id, entry_date, amount, note, created_by)
    values (b, p_agent, v_pid, (v_month + interval '1 month' - interval '1 day')::date, v_sav, 'Savings from ' || to_char(v_month, 'FMMonth YYYY') || ' commission', auth.uid());
  end if;
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
              || case when last.expense_deduction <> 0 then ', agent expenses −₱' || last.expense_deduction else '' end
              || case when last.savings <> 0 then ', savings held ₱' || last.savings else '' end
              || case when last.carried_in <> 0 then ', carried in ₱' || last.carried_in else '' end,
            a.user_id, now(), auth.uid(), now())
    returning id into v_exp;
    update public.agent_commission_periods set expense_id = v_exp where id = v_pid;
  end if;
  return jsonb_build_object('period_id', v_pid, 'payable', last.payable, 'expense_id', v_exp);
end $$;

create or replace function public.agent_commission_overview(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); a record; out jsonb := '[]'::jsonb;
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not public.can_view_agent_commission(b) then raise exception 'Commission figures are for the Business Admin, Finance and the Sales approver.'; end if;
  for a in select * from public.sales_agents where kind = 'freelance' and (active or exists (select 1 from public.storefront_sales s where s.agent_id = sales_agents.id and s.business_id = b)) order by name loop
    out := out || (public.agent_commission_month_calc(b, a.id, p_month, false) || jsonb_build_object('agent_id', a.id, 'agent', a.name, 'agent_code', a.agent_code, 'active', a.active, 'online', a.online, 'savings_balance', public.agent_savings_balance(b, a.id)));
  end loop;
  return jsonb_build_object('month', date_trunc('month', p_month)::date, 'settings', to_jsonb(public.agent_commission_settings_of(b)),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'rate', rate) order by category) from public.agent_commission_rates where business_id = b), '[]'::jsonb),
    'brackets', coalesce((select jsonb_agg(jsonb_build_object('min_paid', min_paid, 'points', points) order by min_paid) from public.agent_commission_brackets where business_id = b), '[]'::jsonb),
    'agents', out);
end $$;

create or replace function public.agent_commission_mine(p_business uuid, p_month date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  perform public.agent_check_store(p_business);
  return public.agent_commission_month_calc(p_business, v, coalesce(p_month, (now() at time zone 'Asia/Manila')::date), true)
    || jsonb_build_object('savings_balance', public.agent_savings_balance(p_business, v), 'history', coalesce((select jsonb_agg(jsonb_build_object('month', p.period, 'paid_sales', p.paid_sales, 'points', p.points, 'earned', p.earned,
            'adjustments', p.adjustments, 'carried_in', p.carried_in, 'payable', p.payable, 'expense_status', (select status::text from public.expenses where id = p.expense_id)) order by p.period desc)
          from public.agent_commission_periods p where p.business_id = p_business and p.agent_id = v), '[]'::jsonb),
       'brackets', coalesce((select jsonb_agg(jsonb_build_object('min_paid', min_paid, 'points', points) order by min_paid) from public.agent_commission_brackets where business_id = p_business), '[]'::jsonb),
       'rates', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'rate', rate) order by category) from public.agent_commission_rates where business_id = p_business), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- Back Office Commission
create table if not exists public.bo_commission_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  sales_staff_threshold numeric(14,2) not null default 1500000,
  back_office_threshold numeric(14,2) not null default 300000,
  tithes_rate numeric(7,4) not null default 10,
  offering_multiplier numeric(7,4) not null default 100,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.bo_category_rates (
  business_id uuid not null references public.businesses(id) on delete cascade,
  category text not null,
  rate numeric(7,4) not null check (rate between 0 and 100),
  primary key (business_id, category)
);
create table if not exists public.bo_plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('manager', 'sales_staff', 'agent_share', 'department')),
  label text not null,
  rate numeric(7,4) not null default 0 check (rate between 0 and 100),
  threshold numeric(14,2),
  agent_id uuid references public.sales_agents(id),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.bo_plan_members (
  plan_id uuid not null references public.bo_plans(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  primary key (plan_id, employee_id)
);
create table if not exists public.bo_commission_periods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  period date not null check (extract(day from period) = 1),
  result jsonb not null,
  total numeric(14,2) not null,
  closed_by uuid references public.users(id),
  closed_at timestamptz not null default now(),
  unique (business_id, period)
);
create table if not exists public.bo_commission_payouts (
  period_id uuid not null references public.bo_commission_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  amount numeric(14,2) not null,
  detail text,
  expense_id uuid references public.expenses(id),
  primary key (period_id, employee_id)
);
alter table public.bo_commission_settings enable row level security;
alter table public.bo_category_rates enable row level security;
alter table public.bo_plans enable row level security;
alter table public.bo_plan_members enable row level security;
alter table public.bo_commission_periods enable row level security;
alter table public.bo_commission_payouts enable row level security;
insert into public.bo_commission_settings(business_id) select id from public.businesses on conflict do nothing;

-- ISHABELLA's manager category rates (as in the workbook's %Comm)
do $$
declare b uuid;
begin
  select id into b from public.businesses where upper(code) like 'ISH%' or upper(coalesce(trade_name, legal_name)) like 'ISHABELLA%' order by created_at limit 1;
  if b is null then return; end if;
  insert into public.bo_category_rates(business_id, category, rate) values
    (b, 'battery', 0.5), (b, 'car aircon', 1), (b, 'installation materials', 1), (b, 'refrigerants', 1), (b, 'pv panels', 0.5), (b, 'general', 1),
    (b, 'aircon unit', 0.5), (b, 'tools', 1), (b, 'electrical', 1), (b, 'aircon parts', 1), (b, 'inverter', 0.5), (b, 'construction', 1)
  on conflict do nothing;
end $$;

-- money collected in a period on a set of sales (payments at the sale − refunds + AR receipts), via agent_sale_collected
create or replace function public.bo_paid_gross(p_business uuid, p_agent uuid, p_from timestamptz, p_to timestamptz)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric := 0; s record;
begin
  for s in
    select x.id from public.storefront_sales x
     where x.business_id = p_business and x.agent_id = p_agent and x.status = 'completed'
       and ((x.sale_date >= (p_from at time zone 'Asia/Manila')::date and x.sale_date < (p_to at time zone 'Asia/Manila')::date)
            or exists (select 1 from public.storefront_payments p where p.sale_id = x.id and p.received_at >= p_from and p.received_at < p_to)
            or exists (select 1 from public.storefront_returns r join public.storefront_payments p on p.return_id = r.id where r.sale_id = x.id and p.received_at >= p_from and p.received_at < p_to)
            or (x.ar_invoice_id is not null and exists (select 1 from public.finance_customer_receipts c where c.invoice_id = x.ar_invoice_id and c.status::text = 'posted'
                                                          and c.receipt_date >= (p_from at time zone 'Asia/Manila')::date and c.receipt_date < (p_to at time zone 'Asia/Manila')::date)))
  loop
    v := v + public.agent_sale_collected(s.id, p_to - interval '1 microsecond') - public.agent_sale_collected(s.id, p_from - interval '1 microsecond');
  end loop;
  return round(v, 2);
end $$;
revoke all on function public.bo_paid_gross(uuid, uuid, timestamptz, timestamptz) from public;

create or replace function public.bo_commission_calc(p_business uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
        v_from timestamptz; v_to timestamptz; bs public.bo_commission_settings; per record;
        v_gross numeric; v_net numeric; v_exp numeric; v_agent_comm numeric := 0; v_store_paid numeric; v_bottom numeric; v_cat_total numeric;
        v_cats jsonb; v_plans jsonb := '[]'::jsonb; v_people jsonb; v_total numeric := 0; p record; v_basis numeric; v_amt numeric; v_q boolean;
        v_members jsonb; v_n int; v_detail jsonb; v_true numeric; v_tithes numeric; v_store_agent uuid; a record;
begin
  select * into per from public.bo_commission_periods where business_id = p_business and period = v_month;
  if found then return per.result || jsonb_build_object('closed', true, 'closed_at', per.closed_at,
      'payouts', coalesce((select jsonb_agg(jsonb_build_object('employee_id', o.employee_id, 'name', btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
                   'amount', o.amount, 'detail', o.detail, 'expense_status', (select status::text from public.expenses where id = o.expense_id)) order by o.amount desc)
                 from public.bo_commission_payouts o join public.employees e on e.id = o.employee_id where o.period_id = per.id), '[]'::jsonb));
  end if;
  select * into bs from public.bo_commission_settings where business_id = p_business;
  if not found then bs.sales_staff_threshold := 1500000; bs.back_office_threshold := 300000; bs.tithes_rate := 10; bs.offering_multiplier := 100; end if;
  v_from := (v_month::timestamp at time zone 'Asia/Manila'); v_to := least((v_next::timestamp at time zone 'Asia/Manila'), now());

  -- sales of the month (paid and unpaid), returns of the month taken off
  create temp table if not exists _bol(cat text, gross numeric, net numeric) on commit drop;
  delete from _bol where true;
  insert into _bol
  select coalesce(nullif(lower(btrim(pi.category)), ''), '(no category)'), i.line_total,
         i.line_total * case when s.vat_applied and s.total > 0 then 1 - coalesce(s.vat_amount, 0) / s.total else 1 end - i.quantity * coalesce(nullif(i.acquisition_cost, 0), i.unit_cost, 0)
    from public.storefront_sales s join public.storefront_sale_items i on i.sale_id = s.id left join public.finance_procurement_items pi on pi.id = i.item_id
   where s.business_id = p_business and s.status = 'completed' and s.sale_date >= v_month and s.sale_date < v_next;
  -- loaded history sales have no item lines: their total and cost count as "(no category)"
  insert into _bol
  select '(no category)', s.total, s.total * case when s.vat_applied and s.total > 0 then 1 - coalesce(s.vat_amount, 0) / s.total else 1 end - coalesce(s.cost_total, 0)
    from public.storefront_sales s
   where s.business_id = p_business and s.status = 'completed' and s.sale_date >= v_month and s.sale_date < v_next
     and not exists (select 1 from public.storefront_sale_items i where i.sale_id = s.id);
  insert into _bol
  select coalesce(nullif(lower(btrim(pi.category)), ''), '(no category)'), -ri.line_total,
         -(ri.line_total * case when s.vat_applied and s.total > 0 then 1 - coalesce(s.vat_amount, 0) / s.total else 1 end - ri.quantity * coalesce(nullif(i.acquisition_cost, 0), i.unit_cost, 0))
    from public.storefront_returns r join public.storefront_return_items ri on ri.return_id = r.id join public.storefront_sale_items i on i.id = ri.sale_item_id
    join public.storefront_sales s on s.id = r.sale_id left join public.finance_procurement_items pi on pi.id = i.item_id
   where r.business_id = p_business and r.return_date >= v_month and r.return_date < v_next;
  select coalesce(sum(gross), 0), coalesce(sum(net), 0) into v_gross, v_net from _bol;
  v_net := round(v_net, 2); v_gross := round(v_gross, 2);

  -- monthly expenses: expenses, payroll and accruals of the month as the budget reads them, without commission
  select coalesce(sum(x.amount), 0) into v_exp from public.budget_actuals(p_business, extract(year from v_month)::int) x
   where x.line_type = 'expense' and x.month = extract(month from v_month)::int
     and (x.category_id is null or x.category_id not in (select id from public.admin_expense_categories where code = 'commission'));
  v_exp := round(v_exp, 2);

  -- total agent commission of the month (before expenses / savings), freelance agents of this store
  for a in select distinct x.agent_id from public.storefront_sales x join public.sales_agents g on g.id = x.agent_id
            where x.business_id = p_business and g.kind = 'freelance' loop
    v_agent_comm := v_agent_comm + coalesce((public.agent_commission_month_calc(p_business, a.agent_id, v_month, false)->>'earned')::numeric, 0);
  end loop;

  select id into v_store_agent from public.sales_agents where business_id = p_business and kind = 'store';
  v_store_paid := case when v_store_agent is null then 0 else public.bo_paid_gross(p_business, v_store_agent, v_from, v_to) end;
  v_bottom := round(v_net - v_exp, 2);
  select coalesce(sum(gross), 0) into v_cat_total from _bol;

  select coalesce(jsonb_agg(jsonb_build_object('category', c.cat, 'gross', round(c.g, 2), 'rate', coalesce(r.rate, 0),
           'allocated', round(case when v_cat_total > 0 then (v_exp + v_agent_comm) * c.g / v_cat_total else 0 end, 2),
           'basis', round(greatest(c.g - case when v_cat_total > 0 then (v_exp + v_agent_comm) * c.g / v_cat_total else 0 end, 0), 2),
           'commission', round(greatest(c.g - case when v_cat_total > 0 then (v_exp + v_agent_comm) * c.g / v_cat_total else 0 end, 0) * coalesce(r.rate, 0) / 100, 2)) order by c.g desc), '[]'::jsonb)
    into v_cats
    from (select cat, sum(gross) as g from _bol group by cat) c left join public.bo_category_rates r on r.business_id = p_business and r.category = c.cat;

  for p in select * from public.bo_plans where business_id = p_business and active order by sort, created_at loop
    v_detail := '{}'::jsonb;
    if p.kind = 'manager' then
      -- categories use their own rates (Commission matrix → manager category rates); the plan rate is not used
      v_amt := coalesce((select sum((x->>'commission')::numeric) from jsonb_array_elements(v_cats) x), 0);
      v_basis := coalesce((select sum((x->>'basis')::numeric) from jsonb_array_elements(v_cats) x), 0); v_q := true;
      v_detail := jsonb_build_object('pool', round(v_exp + v_agent_comm, 2));
    elsif p.kind = 'sales_staff' then
      v_q := v_store_paid > coalesce(p.threshold, bs.sales_staff_threshold) and v_gross > 0;
      v_basis := case when v_q then round(greatest(v_store_paid - v_exp * v_store_paid / v_gross, 0), 2) else 0 end;
      v_amt := round(v_basis * p.rate / 100, 2);
      v_detail := jsonb_build_object('store_paid', v_store_paid, 'threshold', coalesce(p.threshold, bs.sales_staff_threshold));
    elsif p.kind = 'agent_share' then
      v_basis := case when p.agent_id is null then 0 else public.bo_paid_gross(p_business, p.agent_id, v_from, v_to)
                   - coalesce((select sum(amount) from public.agent_expenses where business_id = p_business and agent_id = p.agent_id and status = 'approved'
                                and expense_date >= v_month and expense_date < v_next), 0) end;
      v_q := v_basis > 0; v_amt := round(greatest(v_basis, 0) * p.rate / 100, 2);
      v_detail := jsonb_build_object('agent', (select name from public.sales_agents where id = p.agent_id));
    else
      v_q := v_bottom > coalesce(p.threshold, bs.back_office_threshold);
      v_basis := v_bottom; v_amt := case when v_q then round(v_bottom * p.rate / 100, 2) else 0 end;
      v_detail := jsonb_build_object('threshold', coalesce(p.threshold, bs.back_office_threshold));
    end if;
    select count(*) into v_n from public.bo_plan_members where plan_id = p.id;
    select coalesce(jsonb_agg(jsonb_build_object('employee_id', m.employee_id, 'name', btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
             'amount', case when v_n > 0 then round(v_amt / v_n, 2) else 0 end) order by e.first_name), '[]'::jsonb)
      into v_members from public.bo_plan_members m join public.employees e on e.id = m.employee_id where m.plan_id = p.id;
    v_plans := v_plans || jsonb_build_object('plan_id', p.id, 'kind', p.kind, 'label', p.label, 'rate', p.rate, 'basis', round(v_basis, 2), 'qualifies', v_q,
                                             'amount', v_amt, 'members', v_members, 'unassigned', v_n = 0) || v_detail;
    v_total := v_total + case when v_n > 0 then v_amt else 0 end;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'name', x.name, 'amount', x.amount, 'detail', x.detail) order by x.amount desc), '[]'::jsonb) into v_people
    from (select (m->>'employee_id')::uuid as employee_id, max(m->>'name') as name, sum((m->>'amount')::numeric) as amount,
                 string_agg((pl->>'label') || ' ₱' || (m->>'amount'), ', ') as detail
            from jsonb_array_elements(v_plans) pl, jsonb_array_elements(pl->'members') m group by 1) x where x.amount <> 0;
  v_true := round(v_bottom - v_total, 2);
  v_tithes := round(greatest(v_true, 0) * bs.tithes_rate / 100, 2);
  return jsonb_build_object('month', v_month, 'closed', false, 'as_of', v_to,
    'overall_gross', v_gross, 'net_sales', v_net, 'monthly_expenses', v_exp, 'operating_net_income', v_bottom, 'agent_commission', round(v_agent_comm, 2),
    'store_paid_gross', v_store_paid, 'bottomline_before', v_bottom, 'back_office_total', round(v_total, 2), 'true_bottomline', v_true,
    'tithes', v_tithes, 'offering', round(v_tithes * bs.offering_multiplier / 100, 2),
    'settings', to_jsonb(bs), 'categories', v_cats, 'plans', v_plans, 'payouts', v_people);
end $$;
revoke all on function public.bo_commission_calc(uuid, date) from public;

create or replace function public.bo_commission_month(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not public.can_view_agent_commission(b) then raise exception 'Commission figures are for the Business Admin, Finance and the Sales approver.'; end if;
  return public.bo_commission_calc(b, p_month) || jsonb_build_object(
    'category_rates', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'rate', rate) order by category) from public.bo_category_rates where business_id = b), '[]'::jsonb),
    'plan_setup', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'label', p.label, 'rate', p.rate, 'threshold', p.threshold, 'agent_id', p.agent_id,
                                     'active', p.active, 'sort', p.sort, 'members', coalesce((select jsonb_agg(m.employee_id) from public.bo_plan_members m where m.plan_id = p.id), '[]'::jsonb)) order by p.sort, p.created_at)
                            from public.bo_plans p where p.business_id = b), '[]'::jsonb));
end $$;
revoke all on function public.bo_commission_month(date) from public;
grant execute on function public.bo_commission_month(date) to authenticated;

create or replace function public.bo_commission_setup_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); x jsonb; v_id uuid; m jsonb;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin sets up back office commission.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if p ? 'settings' then
    insert into public.bo_commission_settings(business_id) values (b) on conflict do nothing;
    update public.bo_commission_settings set sales_staff_threshold = coalesce((p->'settings'->>'sales_staff_threshold')::numeric, sales_staff_threshold),
           back_office_threshold = coalesce((p->'settings'->>'back_office_threshold')::numeric, back_office_threshold),
           tithes_rate = coalesce((p->'settings'->>'tithes_rate')::numeric, tithes_rate),
           offering_multiplier = coalesce((p->'settings'->>'offering_multiplier')::numeric, offering_multiplier), updated_by = auth.uid(), updated_at = now()
     where business_id = b;
  end if;
  if p ? 'category_rates' then
    delete from public.bo_category_rates where business_id = b;
    for x in select * from jsonb_array_elements(p->'category_rates') loop
      if coalesce(btrim(x->>'category'), '') = '' or (x->>'rate') is null then continue; end if;
      insert into public.bo_category_rates(business_id, category, rate) values (b, lower(btrim(x->>'category')), (x->>'rate')::numeric)
      on conflict (business_id, category) do update set rate = excluded.rate;
    end loop;
  end if;
  if p ? 'plans' then
    for x in select * from jsonb_array_elements(p->'plans') loop
      v_id := nullif(x->>'id', '')::uuid;
      if coalesce((x->>'delete')::boolean, false) then
        if v_id is not null then delete from public.bo_plans where id = v_id and business_id = b; end if;
        continue;
      end if;
      if coalesce(btrim(x->>'label'), '') = '' then raise exception 'Every plan needs a name.'; end if;
      if (x->>'kind') = 'agent_share' and nullif(x->>'agent_id', '') is null then raise exception '%: choose the agent.', x->>'label'; end if;
      if v_id is null then
        insert into public.bo_plans(business_id, kind, label, rate, threshold, agent_id, active, sort)
        values (b, x->>'kind', btrim(x->>'label'), coalesce((x->>'rate')::numeric, 0), nullif(x->>'threshold', '')::numeric, nullif(x->>'agent_id', '')::uuid,
                coalesce((x->>'active')::boolean, true), coalesce((x->>'sort')::int, 0))
        returning id into v_id;
      else
        update public.bo_plans set kind = x->>'kind', label = btrim(x->>'label'), rate = coalesce((x->>'rate')::numeric, 0), threshold = nullif(x->>'threshold', '')::numeric,
               agent_id = nullif(x->>'agent_id', '')::uuid, active = coalesce((x->>'active')::boolean, true), sort = coalesce((x->>'sort')::int, sort)
         where id = v_id and business_id = b;
        if not found then raise exception 'Plan not found.'; end if;
      end if;
      delete from public.bo_plan_members where plan_id = v_id;
      for m in select * from jsonb_array_elements(coalesce(x->'members', '[]'::jsonb)) loop
        if not exists (select 1 from public.employees where id = (m #>> '{}')::uuid and business_id = b) then raise exception 'An employee is not in this store.'; end if;
        insert into public.bo_plan_members(plan_id, employee_id) values (v_id, (m #>> '{}')::uuid) on conflict do nothing;
      end loop;
    end loop;
  end if;
end $$;
revoke all on function public.bo_commission_setup_save(jsonb) from public;
grant execute on function public.bo_commission_setup_save(jsonb) to authenticated;

create or replace function public.bo_commission_close(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_month date := date_trunc('month', p_month)::date; r jsonb; v_pid uuid; x jsonb; v_exp uuid; v_mid uuid;
        v_label text := to_char(date_trunc('month', p_month), 'FMMonth YYYY'); v_open text;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin closes back office commission.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if (v_month + interval '1 month')::date > (now() at time zone 'Asia/Manila')::date then raise exception 'The month is not over yet.'; end if;
  if exists (select 1 from public.bo_commission_periods where business_id = b and period = v_month) then raise exception 'This month is already closed.'; end if;
  -- the manager pool uses the agents' commission: close the agents first
  select string_agg(distinct g.name, ', ') into v_open
    from public.storefront_sales s join public.sales_agents g on g.id = s.agent_id
   where s.business_id = b and g.kind = 'freelance' and s.sale_date < (v_month + interval '1 month')::date
     and not exists (select 1 from public.agent_commission_periods p where p.business_id = b and p.agent_id = g.id and p.period >= v_month)
     and coalesce((public.agent_commission_month_calc(b, g.id, v_month, false)->>'earned')::numeric, 0) <> 0;
  if v_open is not null then raise exception 'Close the agents'' commission for % first: %.', v_label, v_open; end if;
  r := public.bo_commission_calc(b, v_month);
  insert into public.bo_commission_periods(business_id, period, result, total, closed_by) values (b, v_month, r - 'payouts', (r->>'back_office_total')::numeric, auth.uid())
  returning id into v_pid;
  select id into v_mid from public.months where business_id = b and year = extract(year from v_month) and month = extract(month from v_month);
  if v_mid is null then insert into public.months(business_id, year, month, label) values (b, extract(year from v_month), extract(month from v_month), v_label) returning id into v_mid; end if;
  for x in select * from jsonb_array_elements(r->'payouts') loop
    v_exp := null;
    if (x->>'amount')::numeric > 0 then
      insert into public.expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id, vendor, payment_method, notes, approved_by, approved_at)
      values ((select id from public.sections where code = 'admin'), v_mid, b, 'Back office commission — ' || (x->>'name') || ' — ' || v_label, (x->>'amount')::numeric, 'approved',
              (v_month + interval '1 month' - interval '1 day')::date, (select id from public.admin_expense_categories where code = 'commission'), x->>'name', 'Payout to employee',
              x->>'detail', auth.uid(), now())
      returning id into v_exp;
    end if;
    insert into public.bo_commission_payouts(period_id, employee_id, amount, detail, expense_id) values (v_pid, (x->>'employee_id')::uuid, (x->>'amount')::numeric, x->>'detail', v_exp);
  end loop;
  return jsonb_build_object('period_id', v_pid, 'total', r->>'back_office_total', 'people', jsonb_array_length(r->'payouts'));
end $$;
revoke all on function public.bo_commission_close(date) from public;
grant execute on function public.bo_commission_close(date) to authenticated;


-- internal helpers: not callable from the API
do $$
declare f text; r text;
begin
  foreach f in array array['public.agent_savings_balance(uuid, uuid)', 'public.bo_paid_gross(uuid, uuid, timestamptz, timestamptz)', 'public.bo_commission_calc(uuid, date)',
                           'public.agent_commission_month_calc(uuid, uuid, date, boolean)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
  end loop;
end $$;
