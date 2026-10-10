-- Build 94 — store agents on % of gross sales (owner 2026-10-10): "store own agents like Raymart get 1% of gross
-- sales, while freelance agents get the commission from the markup". Per agent:
--   commission_basis = 'markup' (freelance: the engine of Build 92) or 'gross' (store agent: % of the month's sales)
--   commission_rate  = the % of gross (store agents), or a tier table by the month's gross sales (agent_commission_agent_tiers)
--   gross_less_expenses = take the agent's approved expenses off the sales first (ISHABELLA: Raymart's Ikot sales − Ikot expenses)
-- Gross = the month's completed sales of the agent (sale date in the month), less returns made that month; counted when
-- the sale is made (not when paid), as in ISHABELLA's workbook. Loaded history never counts.

alter table public.sales_agents add column if not exists commission_basis text not null default 'markup' check (commission_basis in ('markup', 'gross'));
alter table public.sales_agents add column if not exists commission_rate numeric(7,4) not null default 1 check (commission_rate between 0 and 100);
alter table public.sales_agents add column if not exists gross_less_expenses boolean not null default false;

create table if not exists public.agent_commission_agent_tiers (
  agent_id uuid not null references public.sales_agents(id) on delete cascade,
  min_sales numeric(14,2) not null check (min_sales >= 0),
  rate numeric(7,4) not null check (rate between 0 and 100),
  primary key (agent_id, min_sales)
);
alter table public.agent_commission_agent_tiers enable row level security;
drop policy if exists agent_commission_agent_tiers_read on public.agent_commission_agent_tiers;
create policy agent_commission_agent_tiers_read on public.agent_commission_agent_tiers for select using (auth.uid() is not null);
grant select on public.agent_commission_agent_tiers to authenticated;

create or replace function public.sales_agent_commission_setup(p_agent uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x jsonb;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin sets how an agent is paid.'; end if;
  if (p->>'commission_basis') not in ('markup', 'gross') then raise exception 'Choose markup (freelance) or gross sales (store agent).'; end if;
  update public.sales_agents set commission_basis = p->>'commission_basis', commission_rate = coalesce((p->>'commission_rate')::numeric, commission_rate),
         gross_less_expenses = coalesce((p->>'gross_less_expenses')::boolean, gross_less_expenses), updated_at = now()
   where id = p_agent and kind = 'freelance';
  if not found then raise exception 'Agent not found (the Store agent itself has no commission).'; end if;
  if p ? 'tiers' then
    delete from public.agent_commission_agent_tiers where agent_id = p_agent;
    for x in select * from jsonb_array_elements(p->'tiers') loop
      if (x->>'min_sales') is null or (x->>'rate') is null then continue; end if;
      insert into public.agent_commission_agent_tiers(agent_id, min_sales, rate) values (p_agent, (x->>'min_sales')::numeric, (x->>'rate')::numeric)
      on conflict (agent_id, min_sales) do update set rate = excluded.rate;
    end loop;
  end if;
end $$;
revoke all on function public.sales_agent_commission_setup(uuid, jsonb) from public;
grant execute on function public.sales_agent_commission_setup(uuid, jsonb) to authenticated;

-- a store agent's open month: % of gross sales
create or replace function public.agent_commission_gross_calc(p_business uuid, p_agent uuid, p_month date, p_with_lines boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st public.agent_commission_settings := public.agent_commission_settings_of(p_business); a record; last record;
        v_month date := date_trunc('month', p_month)::date; v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
        v_sales numeric; v_ret numeric; v_gross numeric; v_exp numeric := 0; v_base numeric; v_rate numeric; v_earned numeric; v_adj numeric; v_carry numeric; v_lines jsonb; v_next_tier record;
begin
  select * into a from public.sales_agents where id = p_agent;
  select coalesce(sum(s.total), 0) into v_sales from public.storefront_sales s
   where s.business_id = p_business and s.agent_id = p_agent and s.status = 'completed' and s.sale_date >= greatest(v_month, st.start_date) and s.sale_date < v_next
     and coalesce(s.notes, '') not like 'Loaded from%';
  select coalesce(sum(r.total), 0) into v_ret from public.storefront_returns r join public.storefront_sales s on s.id = r.sale_id
   where s.business_id = p_business and s.agent_id = p_agent and r.return_date >= greatest(v_month, st.start_date) and r.return_date < v_next
     and coalesce(s.notes, '') not like 'Loaded from%' and s.sale_date >= st.start_date;
  v_gross := round(v_sales - v_ret, 2);
  if a.gross_less_expenses then
    select coalesce(sum(amount), 0) into v_exp from public.agent_expenses
     where business_id = p_business and agent_id = p_agent and status = 'approved' and expense_date >= v_month and expense_date < v_next;
  end if;
  v_base := v_gross - v_exp;
  v_rate := coalesce((select t.rate from public.agent_commission_agent_tiers t where t.agent_id = p_agent and t.min_sales <= v_gross order by t.min_sales desc limit 1), a.commission_rate);
  v_earned := round(greatest(v_base, 0) * v_rate / 100, 2);
  select coalesce(sum(amount), 0) into v_adj from public.agent_commission_adjustments where business_id = p_business and agent_id = p_agent and period = v_month;
  select * into last from public.agent_commission_periods where business_id = p_business and agent_id = p_agent and period < v_month order by period desc limit 1;
  v_carry := case when last.payable < 0 then last.payable else 0 end;
  select min_sales, rate into v_next_tier from public.agent_commission_agent_tiers where agent_id = p_agent and min_sales > v_gross order by min_sales limit 1;
  if p_with_lines then
    select coalesce(jsonb_agg(x order by x->>'sale_date', x->>'sale_number'), '[]'::jsonb) into v_lines from (
      select jsonb_build_object('sale_number', s.sale_number, 'sale_date', s.sale_date, 'dr', coalesce(s.hardcopy_dr_no, s.dr_number), 'customer', c.legal_name,
                                'description', 'Sale total', 'base_delta', s.total, 'rate', v_rate, 'commission', round(s.total * v_rate / 100, 2)) as x
        from public.storefront_sales s left join public.finance_customers c on c.id = s.customer_id
       where s.business_id = p_business and s.agent_id = p_agent and s.status = 'completed' and s.sale_date >= greatest(v_month, st.start_date) and s.sale_date < v_next
         and coalesce(s.notes, '') not like 'Loaded from%'
      union all
      select jsonb_build_object('sale_number', r.return_number, 'sale_date', r.return_date, 'dr', s.sale_number, 'customer', c.legal_name,
                                'description', 'Return', 'base_delta', -r.total, 'rate', v_rate, 'commission', -round(r.total * v_rate / 100, 2))
        from public.storefront_returns r join public.storefront_sales s on s.id = r.sale_id left join public.finance_customers c on c.id = s.customer_id
       where s.business_id = p_business and s.agent_id = p_agent and r.return_date >= greatest(v_month, st.start_date) and r.return_date < v_next
         and coalesce(s.notes, '') not like 'Loaded from%' and s.sale_date >= st.start_date
      union all
      select jsonb_build_object('sale_number', '—', 'sale_date', v_next - 1, 'dr', '', 'customer', '', 'description', 'Agent expenses taken off the sales',
                                'base_delta', -v_exp, 'rate', v_rate, 'commission', -round(v_exp * v_rate / 100, 2))
       where v_exp > 0) z;
  end if;
  return jsonb_build_object('month', v_month, 'closed', false, 'basis', 'gross', 'paid_sales', v_gross, 'points', 0, 'rate', v_rate,
    'next_bracket', v_next_tier.min_sales, 'next_rate', v_next_tier.rate, 'base_expenses', v_exp, 'earned', v_earned, 'adjustments', v_adj,
    'carried_in', coalesce(v_carry, 0), 'expense_deduction', 0, 'savings', 0, 'payable', v_earned + v_adj + coalesce(v_carry, 0),
    'adjustment_lines', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'amount', j.amount, 'note', j.note) order by j.created_at)
                                   from public.agent_commission_adjustments j where j.business_id = p_business and j.agent_id = p_agent and j.period = v_month), '[]'::jsonb),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('min_sales', t.min_sales, 'rate', t.rate) order by t.min_sales) from public.agent_commission_agent_tiers t where t.agent_id = p_agent), '[]'::jsonb),
    'lines', coalesce(v_lines, '[]'::jsonb));
end $$;
revoke all on function public.agent_commission_gross_calc(uuid, uuid, date, boolean) from public;

-- closing a store agent's month
create or replace function public.agent_commission_gross_close(p_business uuid, p_agent uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := public.agent_commission_gross_calc(p_business, p_agent, p_month, false); a record; v_pid uuid; v_exp uuid; v_mid uuid; v_month date := date_trunc('month', p_month)::date;
        v_label text := to_char(date_trunc('month', p_month), 'FMMonth YYYY'); v_pay numeric := (r->>'payable')::numeric;
begin
  select * into a from public.sales_agents where id = p_agent;
  insert into public.agent_commission_periods(business_id, agent_id, period, paid_sales, points, earned, adjustments, carried_in, expense_deduction, savings, payable, closed_by)
  values (p_business, p_agent, v_month, (r->>'paid_sales')::numeric, 0, (r->>'earned')::numeric, (r->>'adjustments')::numeric, (r->>'carried_in')::numeric, 0, 0, v_pay, auth.uid())
  returning id into v_pid;
  if v_pay > 0 then
    select id into v_mid from public.months where business_id = p_business and year = extract(year from v_month) and month = extract(month from v_month);
    if v_mid is null then
      insert into public.months(business_id, year, month, label) values (p_business, extract(year from v_month), extract(month from v_month), v_label) returning id into v_mid;
    end if;
    insert into public.expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id, vendor, payment_method,
                                document_reference, notes, prepared_by, prepared_at, approved_by, approved_at)
    values ((select id from public.sections where code = 'sales'), v_mid, p_business, 'Agent commission — ' || a.name || ' — ' || v_label, v_pay, 'approved',
            (v_month + interval '1 month' - interval '1 day')::date, (select id from public.admin_expense_categories where code = 'commission'), a.name, 'Payout to agent',
            'COM-' || a.agent_code || '-' || to_char(v_month, 'YYYY-MM'),
            'Gross sales ₱' || (r->>'paid_sales') || case when (r->>'base_expenses')::numeric > 0 then ' less expenses ₱' || (r->>'base_expenses') else '' end || ' × ' || (r->>'rate') || '%'
              || case when (r->>'adjustments')::numeric <> 0 then ', adjustments ₱' || (r->>'adjustments') else '' end
              || case when (r->>'carried_in')::numeric <> 0 then ', carried in ₱' || (r->>'carried_in') else '' end,
            a.user_id, now(), auth.uid(), now())
    returning id into v_exp;
    update public.agent_commission_periods set expense_id = v_exp where id = v_pid;
  end if;
  return jsonb_build_object('period_id', v_pid, 'payable', v_pay, 'expense_id', v_exp);
end $$;
revoke all on function public.agent_commission_gross_close(uuid, uuid, date) from public;

-- route store agents to the gross engine inside the existing month calculation and month close
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.agent_commission_month_calc(uuid, uuid, date, boolean)'::regprocedure) into d;
  n := replace(d, '  v_end := least(((v_month + interval ''1 month'')::timestamp at time zone ''Asia/Manila''), now());',
               '  if coalesce((select commission_basis from public.sales_agents where id = p_agent), ''markup'') = ''gross'' then
    return public.agent_commission_gross_calc(p_business, p_agent, v_month, p_with_lines);
  end if;
  v_end := least(((v_month + interval ''1 month'')::timestamp at time zone ''Asia/Manila''), now());');
  if n = d then raise exception 'Build 94: could not route agent_commission_month_calc'; end if;
  -- closed months of store agents keep their basis in the result
  n := replace(n, '''expense_deduction'', per.expense_deduction,', '''expense_deduction'', per.expense_deduction, ''basis'', coalesce((select commission_basis from public.sales_agents where id = p_agent), ''markup''),');
  execute n;

  select pg_get_functiondef('public.agent_commission_close(uuid, date)'::regprocedure) into d;
  n := replace(d, '  r := public.agent_commission_month_calc(b, p_agent, v_month, false);',
               '  if coalesce(a.commission_basis, ''markup'') = ''gross'' then return public.agent_commission_gross_close(b, p_agent, v_month); end if;
  r := public.agent_commission_month_calc(b, p_agent, v_month, false);');
  if n = d then raise exception 'Build 94: could not route agent_commission_close'; end if;
  execute n;

  -- the overview shows each agent's basis and rate
  select pg_get_functiondef('public.agent_commission_overview(date)'::regprocedure) into d;
  n := replace(d, '''online'', a.online,', '''online'', a.online, ''basis'', a.commission_basis, ''commission_rate'', a.commission_rate, ''gross_less_expenses'', a.gross_less_expenses,
      ''tiers'', coalesce((select jsonb_agg(jsonb_build_object(''min_sales'', t.min_sales, ''rate'', t.rate) order by t.min_sales) from public.agent_commission_agent_tiers t where t.agent_id = a.id), ''[]''::jsonb),');
  if n = d then raise exception 'Build 94: could not extend agent_commission_overview'; end if;
  execute n;
end $$;

do $$
declare f text; r text;
begin
  foreach f in array array['public.agent_commission_gross_calc(uuid, uuid, date, boolean)', 'public.agent_commission_gross_close(uuid, uuid, date)'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
  end loop;
end $$;

-- ISHABELLA: Raymart (Ikot), if loaded, is a store agent on 1% of gross sales less his Ikot expenses
update public.sales_agents set commission_basis = 'gross', commission_rate = 1, gross_less_expenses = true where kind = 'freelance' and lower(name) = 'raymart (ikot)';
