-- Build 98 — Back Office Commission per store, from the owner's rules (2026-10-10):
--  * new plan type "% of sales": basis = the store's total gross sales (paid and unpaid, less returns) or one agent's gross
--    sales; optional quota on the store's total gross; paid to employees and/or named payees (owners, people of another
--    store — personal income, no cross-store entries), split equally or the full rate to each person;
--  * store sales for the "sales staff" plan = the walk-in Store account only (as in ISHABELLA's workbook; undoes 97h's change);
--  * summary figures for the Summary screen (agent payable, store agents' commission, ratio targets);
--  * ISHABELLA and PILI set up from their sheets when they have no plans yet (missing employees created, first names only).

alter table public.bo_plans drop constraint if exists bo_plans_kind_check;
alter table public.bo_plans add constraint bo_plans_kind_check check (kind in ('manager', 'sales_staff', 'agent_share', 'department', 'sales_percent'));
alter table public.bo_plans add column if not exists basis text not null default 'total_gross';
alter table public.bo_plans drop constraint if exists bo_plans_basis_check;
alter table public.bo_plans add constraint bo_plans_basis_check check (basis in ('total_gross', 'agent_gross'));
alter table public.bo_plans add column if not exists per_person boolean not null default false;
alter table public.bo_plans add column if not exists payees text[] not null default '{}';

-- payouts can go to a named payee (not an employee)
alter table public.bo_commission_payouts add column if not exists payee text;
alter table public.bo_commission_payouts add column if not exists id uuid not null default gen_random_uuid();
alter table public.bo_commission_payouts drop constraint if exists bo_commission_payouts_pkey;
alter table public.bo_commission_payouts add constraint bo_commission_payouts_pkey primary key (id);
alter table public.bo_commission_payouts alter column employee_id drop not null;
create unique index if not exists bo_commission_payouts_one on public.bo_commission_payouts (period_id, coalesce(employee_id::text, 'payee:' || payee));

alter table public.bo_commission_settings add column if not exists ratio_targets jsonb not null
  default '{"expense":[10,20],"net_margin":[5,10],"commission":[2,5]}'::jsonb;

create or replace function public.bo_commission_calc(p_business uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
        v_from timestamptz; v_to timestamptz; bs public.bo_commission_settings; per record;
        v_gross numeric; v_net numeric; v_exp numeric; v_agent_comm numeric := 0; v_agent_pay numeric := 0; v_agent_exp numeric := 0; v_agent_sav numeric := 0;
        v_store_paid numeric; v_bottom numeric; v_cat_total numeric; v_store_agents jsonb := '[]'::jsonb; c jsonb; v_sa_total numeric := 0;
        v_cats jsonb; v_plans jsonb := '[]'::jsonb; v_people jsonb; v_total numeric := 0; p record; v_basis numeric; v_amt numeric; v_q boolean;
        v_members jsonb; v_n int; v_each numeric; v_plan_total numeric; v_detail jsonb; v_true numeric; v_tithes numeric; v_store_agent uuid; a record;
begin
  select * into per from public.bo_commission_periods where business_id = p_business and period = v_month;
  if found then return per.result || jsonb_build_object('closed', true, 'closed_at', per.closed_at,
      'payouts', coalesce((select jsonb_agg(jsonb_build_object('employee_id', o.employee_id,
                   'name', coalesce(o.payee, btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))),
                   'amount', o.amount, 'detail', o.detail, 'expense_status', (select status::text from public.expenses where id = o.expense_id)) order by o.amount desc)
                 from public.bo_commission_payouts o left join public.employees e on e.id = o.employee_id where o.period_id = per.id), '[]'::jsonb));
  end if;
  select * into bs from public.bo_commission_settings where business_id = p_business;
  if not found then bs.sales_staff_threshold := 1500000; bs.back_office_threshold := 300000; bs.tithes_rate := 10; bs.offering_multiplier := 100;
    bs.ratio_targets := '{"expense":[10,20],"net_margin":[5,10],"commission":[2,5]}'::jsonb; end if;
  v_from := (v_month::timestamp at time zone 'Asia/Manila'); v_to := least((v_next::timestamp at time zone 'Asia/Manila'), now());

  -- sales of the month (paid and unpaid), returns of the month taken off
  create temp table if not exists _bol(cat text, gross numeric, net numeric) on commit drop;
  delete from _bol where true;
  insert into _bol
  select coalesce(nullif(lower(btrim(pi.category)), ''), '(no category)'), i.line_total,
         i.line_total * case when s.vat_applied and s.total > 0 then 1 - coalesce(s.vat_amount, 0) / s.total else 1 end - i.quantity * coalesce(nullif(i.acquisition_cost, 0), i.unit_cost, 0)
    from public.storefront_sales s join public.storefront_sale_items i on i.sale_id = s.id left join public.finance_procurement_items pi on pi.id = i.item_id
   where s.business_id = p_business and s.status = 'completed' and s.sale_date >= v_month and s.sale_date < v_next;
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

  -- the agents' commission of the month (before expenses / savings) and what they are paid (after); store agents listed
  for a in select distinct x.agent_id, g.name, g.commission_basis from public.storefront_sales x join public.sales_agents g on g.id = x.agent_id
            where x.business_id = p_business and g.kind = 'freelance' loop
    c := public.agent_commission_month_calc(p_business, a.agent_id, v_month, false);
    -- the manager's pool uses the agents' commission; store agents (% of gross) are shown with the back office, as in the workbook
    if a.commission_basis is distinct from 'gross' then v_agent_comm := v_agent_comm + coalesce((c->>'earned')::numeric, 0); end if;
    v_agent_pay := v_agent_pay + greatest(coalesce((c->>'payable')::numeric, 0), 0);
    v_agent_exp := v_agent_exp + coalesce((c->>'expense_deduction')::numeric, (c->>'base_expenses')::numeric, 0);
    v_agent_sav := v_agent_sav + coalesce((c->>'savings')::numeric, 0);
    if a.commission_basis = 'gross' and coalesce((c->>'earned')::numeric, 0) <> 0 then
      v_store_agents := v_store_agents || jsonb_build_object('agent_id', a.agent_id, 'name', a.name, 'sales', (c->>'paid_sales')::numeric,
                          'expenses', coalesce((c->>'base_expenses')::numeric, 0), 'rate', (c->>'rate')::numeric, 'amount', (c->>'earned')::numeric);
      v_sa_total := v_sa_total + (c->>'earned')::numeric;
    end if;
  end loop;

  -- the store's own sales (walk-in Store account), as in ISHABELLA's workbook
  select id into v_store_agent from public.sales_agents where business_id = p_business and kind = 'store';
  v_store_paid := case when v_store_agent is null then 0 else public.bo_paid_gross(p_business, v_store_agent, v_from, v_to) end;
  v_bottom := round(v_net - v_exp, 2);
  select coalesce(sum(gross), 0) into v_cat_total from _bol;

  select coalesce(jsonb_agg(jsonb_build_object('category', c2.cat, 'gross', round(c2.g, 2), 'rate', coalesce(r.rate, 0),
           'allocated', round(case when v_cat_total > 0 then (v_exp + v_agent_comm) * c2.g / v_cat_total else 0 end, 2),
           'basis', round(greatest(c2.g - case when v_cat_total > 0 then (v_exp + v_agent_comm) * c2.g / v_cat_total else 0 end, 0), 2),
           'commission', round(greatest(c2.g - case when v_cat_total > 0 then (v_exp + v_agent_comm) * c2.g / v_cat_total else 0 end, 0) * coalesce(r.rate, 0) / 100, 2)) order by c2.g desc), '[]'::jsonb)
    into v_cats
    from (select cat, sum(gross) as g from _bol group by cat) c2 left join public.bo_category_rates r on r.business_id = p_business and r.category = c2.cat;

  for p in select * from public.bo_plans where business_id = p_business and active and kind <> 'agent_share' order by sort, created_at loop
    v_detail := '{}'::jsonb;
    if p.kind = 'manager' then
      v_amt := coalesce((select sum((x->>'commission')::numeric) from jsonb_array_elements(v_cats) x), 0);
      v_basis := coalesce((select sum((x->>'basis')::numeric) from jsonb_array_elements(v_cats) x), 0); v_q := true;
      v_detail := jsonb_build_object('pool', round(v_exp + v_agent_comm, 2));
    elsif p.kind = 'sales_staff' then
      v_q := v_store_paid > coalesce(p.threshold, bs.sales_staff_threshold) and v_gross > 0;
      v_basis := case when v_q then round(greatest(v_store_paid - v_exp * v_store_paid / v_gross, 0), 2) else 0 end;
      v_amt := round(v_basis * p.rate / 100, 2);
      v_detail := jsonb_build_object('store_paid', v_store_paid, 'threshold', coalesce(p.threshold, bs.sales_staff_threshold));
    elsif p.kind = 'sales_percent' then
      -- quota on the store's total gross; basis = total gross or one agent's gross (paid and unpaid, less returns)
      v_q := p.threshold is null or v_gross > p.threshold;
      if p.basis = 'agent_gross' then
        select coalesce(sum(s.total), 0) into v_basis from public.storefront_sales s
         where s.business_id = p_business and s.agent_id = p.agent_id and s.status = 'completed' and s.sale_date >= v_month and s.sale_date < v_next;
        v_basis := v_basis - coalesce((select sum(r.total) from public.storefront_returns r join public.storefront_sales s on s.id = r.sale_id
                                        where s.business_id = p_business and s.agent_id = p.agent_id and r.return_date >= v_month and r.return_date < v_next), 0);
        if p.agent_id is null then v_basis := 0; v_q := false; end if;
      else
        v_basis := v_gross;
      end if;
      v_basis := round(v_basis, 2);
      v_amt := case when v_q then round(greatest(v_basis, 0) * p.rate / 100, 2) else 0 end;
      v_detail := jsonb_build_object('quota', p.threshold, 'on', p.basis, 'per_person', p.per_person,
                                     'agent', (select name from public.sales_agents where id = p.agent_id));
    else
      v_q := v_bottom > coalesce(p.threshold, bs.back_office_threshold);
      v_basis := v_bottom; v_amt := case when v_q then round(v_bottom * p.rate / 100, 2) else 0 end;
      v_detail := jsonb_build_object('threshold', coalesce(p.threshold, bs.back_office_threshold));
    end if;
    -- recipients: employees on the plan + named payees; split equally, or the full amount to each ("per person")
    v_n := (select count(*) from public.bo_plan_members where plan_id = p.id) + coalesce(array_length(p.payees, 1), 0);
    v_each := case when v_n = 0 then 0 when p.per_person then v_amt else round(v_amt / v_n, 2) end;
    v_plan_total := case when v_n = 0 then 0 when p.per_person then v_amt * v_n else v_amt end;
    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_members from (
      select jsonb_build_object('employee_id', m.employee_id, 'name', btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), 'amount', v_each) as x
        from public.bo_plan_members m join public.employees e on e.id = m.employee_id where m.plan_id = p.id
      union all
      select jsonb_build_object('employee_id', null, 'payee', y, 'name', y, 'amount', v_each) from unnest(p.payees) y) z;
    v_plans := v_plans || jsonb_build_object('plan_id', p.id, 'kind', p.kind, 'label', p.label, 'rate', p.rate, 'basis', round(v_basis, 2), 'qualifies', v_q,
                                             'amount', v_amt, 'paid', v_plan_total, 'members', v_members, 'unassigned', v_n = 0) || v_detail;
    v_total := v_total + v_plan_total;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'payee', x.payee, 'name', x.name, 'amount', x.amount, 'detail', x.detail) order by x.amount desc), '[]'::jsonb) into v_people
    from (select (m->>'employee_id')::uuid as employee_id, max(m->>'payee') as payee, max(m->>'name') as name, sum((m->>'amount')::numeric) as amount,
                 string_agg((pl->>'label') || ' ₱' || (m->>'amount'), ', ') as detail
            from jsonb_array_elements(v_plans) pl, jsonb_array_elements(pl->'members') m
           group by coalesce(m->>'employee_id', 'payee:' || lower(btrim(m->>'payee'))), (m->>'employee_id')) x where x.amount <> 0;
  v_true := round(v_bottom - v_total - v_sa_total, 2);   -- store agents' commission is part of the back office cost (workbook)
  v_tithes := round(greatest(v_true, 0) * bs.tithes_rate / 100, 2);
  return jsonb_build_object('month', v_month, 'closed', false, 'as_of', v_to,
    'overall_gross', v_gross, 'net_sales', v_net, 'monthly_expenses', v_exp, 'operating_net_income', v_bottom, 'agent_commission', round(v_agent_comm, 2),
    'agent_payable', round(v_agent_pay, 2), 'agent_expenses', round(v_agent_exp, 2), 'agent_savings', round(v_agent_sav, 2), 'store_agents', v_store_agents, 'store_agents_total', round(v_sa_total, 2),
    'back_office_with_store_agents', round(v_total + v_sa_total, 2),
    'store_paid_gross', v_store_paid, 'bottomline_before', v_bottom, 'back_office_total', round(v_total, 2), 'true_bottomline', v_true,
    'tithes', v_tithes, 'offering', round(v_tithes * bs.offering_multiplier / 100, 2),
    'settings', to_jsonb(bs), 'categories', v_cats, 'plans', v_plans, 'payouts', v_people);
end $$;
revoke all on function public.bo_commission_calc(uuid, date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.bo_commission_calc(uuid, date) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.bo_commission_calc(uuid, date) from authenticated; end if;
end $$;

create or replace function public.bo_commission_month(p_month date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not public.can_view_agent_commission(b) then raise exception 'Commission figures are for the Business Admin, Finance and the Sales approver.'; end if;
  return public.bo_commission_calc(b, p_month) || jsonb_build_object(
    'category_rates', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'rate', rate) order by category) from public.bo_category_rates where business_id = b), '[]'::jsonb),
    'plan_setup', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'label', p.label, 'rate', p.rate, 'threshold', p.threshold, 'agent_id', p.agent_id,
                                     'basis', p.basis, 'per_person', p.per_person, 'payees', to_jsonb(p.payees),
                                     'active', p.active, 'sort', p.sort, 'members', coalesce((select jsonb_agg(m.employee_id) from public.bo_plan_members m where m.plan_id = p.id), '[]'::jsonb)) order by p.sort, p.created_at)
                            from public.bo_plans p where p.business_id = b), '[]'::jsonb));
end $$;
revoke all on function public.bo_commission_month(date) from public;
grant execute on function public.bo_commission_month(date) to authenticated;

create or replace function public.bo_commission_setup_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); x jsonb; v_id uuid; m jsonb; v_payees text[];
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only the Business Admin sets up back office commission.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if p ? 'settings' then
    insert into public.bo_commission_settings(business_id) values (b) on conflict do nothing;
    update public.bo_commission_settings set sales_staff_threshold = coalesce((p->'settings'->>'sales_staff_threshold')::numeric, sales_staff_threshold),
           back_office_threshold = coalesce((p->'settings'->>'back_office_threshold')::numeric, back_office_threshold),
           tithes_rate = coalesce((p->'settings'->>'tithes_rate')::numeric, tithes_rate),
           offering_multiplier = coalesce((p->'settings'->>'offering_multiplier')::numeric, offering_multiplier),
           ratio_targets = coalesce(p->'settings'->'ratio_targets', ratio_targets), updated_by = auth.uid(), updated_at = now()
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
      if (x->>'kind') = 'agent_share' and coalesce((x->>'active')::boolean, true) then
        raise exception '%: the agent share plan was removed — store agents are paid on %% of gross (Sales → Agent Commissions → How paid).', x->>'label';
      end if;
      if (x->>'kind') = 'sales_percent' and coalesce(x->>'basis', 'total_gross') = 'agent_gross' and nullif(x->>'agent_id', '') is null then
        raise exception '%: choose the agent whose sales it is based on.', x->>'label';
      end if;
      select coalesce(array_agg(btrim(y)) filter (where btrim(y) <> ''), '{}') into v_payees from jsonb_array_elements_text(coalesce(x->'payees', '[]'::jsonb)) y;
      if v_id is null then
        insert into public.bo_plans(business_id, kind, label, rate, threshold, agent_id, active, sort, basis, per_person, payees)
        values (b, x->>'kind', btrim(x->>'label'), coalesce((x->>'rate')::numeric, 0), nullif(x->>'threshold', '')::numeric, nullif(x->>'agent_id', '')::uuid,
                coalesce((x->>'active')::boolean, true), coalesce((x->>'sort')::int, 0), coalesce(nullif(x->>'basis', ''), 'total_gross'),
                coalesce((x->>'per_person')::boolean, false), v_payees)
        returning id into v_id;
      else
        update public.bo_plans set kind = x->>'kind', label = btrim(x->>'label'), rate = coalesce((x->>'rate')::numeric, 0), threshold = nullif(x->>'threshold', '')::numeric,
               agent_id = nullif(x->>'agent_id', '')::uuid, active = coalesce((x->>'active')::boolean, true), sort = coalesce((x->>'sort')::int, sort),
               basis = coalesce(nullif(x->>'basis', ''), basis), per_person = coalesce((x->>'per_person')::boolean, per_person), payees = v_payees
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

-- closing: payouts to employees and to named payees
do $$
declare src text := pg_get_functiondef('public.bo_commission_close(date)'::regprocedure);
  o1 text := $o$x->>'name', 'Payout to employee',$o$;
  n1 text := $n$x->>'name', case when nullif(x->>'employee_id', '') is null then 'Payout' else 'Payout to employee' end,$n$;
  o2 text := $o$insert into public.bo_commission_payouts(period_id, employee_id, amount, detail, expense_id) values (v_pid, (x->>'employee_id')::uuid, (x->>'amount')::numeric, x->>'detail', v_exp);$o$;
  n2 text := $n$insert into public.bo_commission_payouts(period_id, employee_id, payee, amount, detail, expense_id)
    values (v_pid, nullif(x->>'employee_id', '')::uuid, case when nullif(x->>'employee_id', '') is null then x->>'name' end, (x->>'amount')::numeric, x->>'detail', v_exp);$n$;
begin
  if position('bo_commission_payouts(period_id, employee_id, payee' in src) > 0 then return; end if;   -- already done
  if position(o1 in src) = 0 or position(o2 in src) = 0 then raise exception 'Unexpected bo_commission_close'; end if;
  execute replace(replace(src, o1, n1), o2, n2);
end $$;

-- ---------------------------------------------------------------- the stores' set-ups (only when a store has no plans yet)
create or replace function public.bo_setup_employee(p_business uuid, p_first text, p_dept text default null, p_position text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.employees where business_id = p_business and lower(btrim(coalesce(preferred_name, first_name))) = lower(p_first)
   order by (employment_status::text = 'active') desc, created_at limit 1;
  if v is null then
    insert into public.employees(business_id, first_name, last_name, department, position_title, notes)
    values (p_business, p_first, '(to complete)', p_dept, p_position, 'Created for Back Office Commission (Build 98) — complete the details.')
    returning id into v;
  end if;
  return v;
end $$;
revoke all on function public.bo_setup_employee(uuid, text, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.bo_setup_employee(uuid, text, text, text) from authenticated; end if;
end $$;

create or replace function public.bo_seed_store_plans()
returns void language plpgsql security definer set search_path = public as $$
declare b uuid; pl uuid; v_rod uuid;
begin
  -- ISHABELLA (workbook "Back Office Commission", August 2026)
  select id into b from public.businesses where upper(code) like 'ISH%' or upper(coalesce(trade_name, legal_name)) like 'ISHABELLA%' order by created_at limit 1;
  if b is not null and not exists (select 1 from public.bo_plans where business_id = b and kind <> 'agent_share') then
    insert into public.bo_commission_settings(business_id) values (b) on conflict do nothing;
    insert into public.bo_plans(business_id, kind, label, rate, sort) values (b, 'manager', 'Manager (Bert)', 0, 1) returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Bert', 'Management', 'Sales Manager'));
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort) values (b, 'sales_staff', 'Sales Staff (Riza)', 0.5, 1500000, 2) returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Riza', 'Sales'));
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort) values (b, 'department', 'Purchasing', 1, 300000, 3) returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Shiena', 'Purchasing'));
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort) values (b, 'department', 'Admin', 1, 300000, 4) returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Glydal', 'Admin')), (pl, public.bo_setup_employee(b, 'Riza', 'Sales'));
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort) values (b, 'department', 'Logistics', 1, 300000, 5) returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Vincent', 'Logistics')), (pl, public.bo_setup_employee(b, 'Jojo', 'Logistics')),
                                              (pl, public.bo_setup_employee(b, 'Mark', 'Logistics'));
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort) values (b, 'department', 'Marketing', 1, 300000, 6) returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Rod', 'Marketing'));
    -- Raymart (Ikot): store agent, 1% of (Ikot sales − Ikot expenses)
    update public.sales_agents set commission_basis = 'gross', commission_rate = 1, gross_less_expenses = true
     where kind = 'freelance' and lower(name) like 'raymart%' and commission_basis <> 'gross';
  end if;

  -- PILI (owner, 2026-10-10)
  select id into b from public.businesses where upper(code) = 'PILI' order by created_at limit 1;
  if b is not null and not exists (select 1 from public.bo_plans where business_id = b and kind <> 'agent_share') then
    insert into public.bo_commission_settings(business_id) values (b) on conflict do nothing;
    insert into public.bo_plans(business_id, kind, label, rate, sort, basis, payees) values (b, 'sales_percent', 'Sales Manager Incentive', 1, 1, 'total_gross', array['Fred']);
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort, basis) values (b, 'sales_percent', 'Store Manager Incentive', 0.5, 1000000, 2, 'total_gross') returning id into pl;
    insert into public.bo_plan_members values (pl, public.bo_setup_employee(b, 'Rochelle', 'Management', 'Store Manager'));
    select id into v_rod from public.sales_agents where kind = 'freelance' and (lower(name) like '%ptr%rod%' or lower(name) like 'rod%' or lower(name) like '%pastor rod%')
     order by (home_business_id = b) desc, (lower(name) like '%ptr%') desc, created_at limit 1;
    insert into public.bo_plans(business_id, kind, label, rate, sort, basis, agent_id, payees, active)
    values (b, 'sales_percent', 'Ishabella Sales (Bert)', 1, 3, 'agent_gross', v_rod, array['Bert'], v_rod is not null);
    insert into public.bo_plans(business_id, kind, label, rate, threshold, sort, basis, per_person, payees)
    values (b, 'sales_percent', 'Owner''s Allowance', 0.5, 1000000, 4, 'total_gross', true, array['Rod', 'Vin', 'Fred']);
  end if;
end $$;
revoke all on function public.bo_seed_store_plans() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.bo_seed_store_plans() from authenticated; end if;
end $$;
do $$ begin perform public.bo_seed_store_plans(); end $$;
