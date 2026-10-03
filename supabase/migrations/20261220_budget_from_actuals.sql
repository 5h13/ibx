-- ============================================================================
-- Build 89 — BUD-01 budgeting rework (owner, 2026-10-03)
--   * A new budget starts from this year's ACTUALS: one line per expense
--     category spent this year, plus Sales, Cost of sales and Payroll; each
--     month pre-filled with the same month's actual (months not yet closed:
--     the line's monthly average). Full profit budget (sales − cost − expenses).
--   * Each line has a timing: monthly / yearly (accrued 1/12 a month, paid in
--     one month) / one-time; approved yearly lines can create accrual
--     schedules (Build 80).
--   * Scenarios are lists of actions (line or all sales / all expenses, % or ₱
--     per month, from–to month, owner, status) on top of the base; approving
--     a scenario approves the budget with it. Budget vs actual reads the same
--     actuals automatically (no typing).
--   Finance prepares; a Business Admin approves (existing workflow steps).
-- ============================================================================

alter table public.finance_budgets add column if not exists base_year int;
alter table public.finance_budgets add column if not exists baseline text;
alter table public.finance_budgets add column if not exists approved_scenario_id uuid;

alter table public.finance_budget_lines add column if not exists line_key text;
alter table public.finance_budget_lines add column if not exists line_type text not null default 'expense';
alter table public.finance_budget_lines add column if not exists category_id uuid references public.admin_expense_categories(id) on delete set null;
alter table public.finance_budget_lines add column if not exists gl_account_code text;
alter table public.finance_budget_lines add column if not exists timing text not null default 'monthly';
alter table public.finance_budget_lines add column if not exists annual_amount numeric(14,2);
alter table public.finance_budget_lines add column if not exists pay_month int;
alter table public.finance_budget_lines add column if not exists base_months numeric[];
alter table public.finance_budget_lines add column if not exists accrual_schedule_id uuid references public.finance_expense_schedules(id) on delete set null;
alter table public.finance_budget_lines add column if not exists sort_order int not null default 0;
do $$ begin
  alter table public.finance_budget_lines add constraint finance_budget_lines_type_chk check (line_type in ('revenue','cogs','expense'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.finance_budget_lines add constraint finance_budget_lines_timing_chk check (timing in ('monthly','yearly','one_time') and (pay_month is null or pay_month between 1 and 12));
exception when duplicate_object then null; end $$;

create table if not exists public.finance_budget_scenarios (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  budget_id uuid not null references public.finance_budgets(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text,
  is_base boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.finance_budget_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  scenario_id uuid not null references public.finance_budget_scenarios(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  target text not null default 'line' check (target in ('line','all_revenue','all_expense')),
  budget_line_id uuid references public.finance_budget_lines(id) on delete cascade,
  change_kind text not null check (change_kind in ('percent','amount')),
  value numeric(14,2) not null,
  start_month int not null default 1 check (start_month between 1 and 12),
  end_month int not null default 12 check (end_month between 1 and 12),
  cogs_follows boolean not null default true,     -- a sales % change moves cost of sales by the same %
  owner text,
  status text not null default 'planned' check (status in ('planned','in_progress','done','dropped')),
  notes text,
  sort_order int not null default 0,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_month >= start_month),
  check ((target = 'line') = (budget_line_id is not null))
);
alter table public.finance_budgets drop constraint if exists finance_budgets_approved_scenario_fk;
alter table public.finance_budgets add constraint finance_budgets_approved_scenario_fk foreign key (approved_scenario_id) references public.finance_budget_scenarios(id) on delete set null;

-- same access as budget lines: Finance and admins, own business only
do $$ declare t text; begin
  foreach t in array array['finance_budget_scenarios','finance_budget_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_finance', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_section_access(''finance'') or public.is_super_admin() or public.is_business_admin()) with check (public.has_section_access(''finance'') or public.is_super_admin() or public.is_business_admin())', t || '_finance', t);
    execute format('drop policy if exists %I on public.%I', t || '_isolation', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (public.business_row_visible(business_id)) with check (public.business_row_visible(business_id))', t || '_isolation', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ actuals --
-- Actual amounts of one store for a year, by budget line key and month:
--   SALES   revenue accounts in posted journals (sales less returns)
--   COGS    5000 Cost of sales in posted journals
--   PAYROLL approved / posted payroll runs (gross pay, by period end month)
--   EXP:<category id>  posted / paid expenses by category (a yearly expense
--           spread over its months is counted month by month)
create or replace function public.budget_actuals(p_business uuid, p_year int)
returns table(line_key text, line_type text, category_id uuid, name text, gl text, month int, amount numeric)
language sql stable security definer set search_path = public as $$
  with fin as (select (public.has_section_access('finance') or public.is_super_admin() or public.is_business_admin())
                      and public.business_row_visible(p_business) as ok)
  select * from (
    select 'SALES', 'revenue', null::uuid, 'Sales', '4000', extract(month from je.entry_date)::int, sum(jl.credit - jl.debit)
      from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id = je.id
      join public.finance_chart_of_accounts coa on coa.id = jl.account_id
     where je.business_id = p_business and je.status = 'posted' and coa.account_type = 'revenue' and extract(year from je.entry_date) = p_year
     group by 6
    union all
    select 'COGS', 'cogs', null, 'Cost of sales', '5000', extract(month from je.entry_date)::int, sum(jl.debit - jl.credit)
      from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id = je.id
      join public.finance_chart_of_accounts coa on coa.id = jl.account_id
     where je.business_id = p_business and je.status = 'posted' and coa.account_code = '5000' and extract(year from je.entry_date) = p_year
     group by 6
    union all
    select 'PAYROLL', 'expense', null, 'Payroll (payroll runs)', '5100', extract(month from p.end_date)::int, sum(r.gross_pay)
      from public.payroll_runs r join public.payroll_periods p on p.id = r.period_id
     where r.business_id = p_business and r.status::text in ('approved','posted') and extract(year from p.end_date) = p_year
     group by 6
    union all
    select 'EXP:' || c.id, 'expense', c.id, c.name, coalesce(nullif(c.gl_account_code, ''), '5200'), m.mon, sum(m.amt)
      from (select e.category_id,
                   extract(month from (date_trunc('month', e.expense_date) + make_interval(months => g.i)))::int as mon,
                   extract(year from (date_trunc('month', e.expense_date) + make_interval(months => g.i)))::int as yr,
                   e.amount / greatest(case when coalesce(e.is_yearly, false) then coalesce(e.spread_months, 1) else 1 end, 1) as amt
              from public.expenses e
              cross join lateral generate_series(0, greatest(case when coalesce(e.is_yearly, false) then coalesce(e.spread_months, 1) else 1 end, 1) - 1) g(i)
             where e.business_id = p_business and e.status::text in ('posted','paid') and e.category_id is not null and e.expense_date is not null) m
      join public.admin_expense_categories c on c.id = m.category_id
     where m.yr = p_year
     group by c.id, c.name, c.gl_account_code, m.mon
  ) x(line_key, line_type, category_id, name, gl, month, amount)
  where (select ok from fin)
$$;
grant execute on function public.budget_actuals(uuid, int) to authenticated;

-- --------------------------------------------------- new budget from actuals --
create or replace function public.budget_create_from_actuals(p_year int, p_base_year int, p_name text default null, p_baseline text default 'same_month')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.pricing_business_id(); v_budget uuid; v_last int; r record; v_base numeric[]; v_budgetm numeric[]; v_total numeric; i int; v_n int;
  v_code text; v_timing text; v_pay int; v_avg numeric; v_sort int := 0; months text[] := array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
begin
  if not (public.has_section_access('finance') or public.is_super_admin() or public.is_business_admin()) then raise exception 'Finance prepares budgets.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if p_year is null or p_base_year is null or p_year <= p_base_year then raise exception 'The budget year must be after the base year.'; end if;
  if p_baseline not in ('same_month','average') then raise exception 'Unknown baseline.'; end if;
  drop table if exists _act;
  create temp table _act on commit drop as select * from public.budget_actuals(b, p_base_year);
  -- months that are over: the whole base year if it is past, else up to last month (the current month is not finished)
  v_last := case when p_base_year < extract(year from (now() at time zone 'Asia/Manila'))::int then 12
                 else extract(month from (now() at time zone 'Asia/Manila'))::int - 1 end;
  if v_last < 1 or not exists (select 1 from _act where amount <> 0 and month <= v_last) then
    raise exception 'There are no actuals for % in this store yet (posted sales, expenses or payroll in finished months).', p_base_year;
  end if;

  select count(*) + 1 into v_n from public.finance_budgets where business_id = b and fiscal_year = p_year;
  v_code := 'BUD-' || p_year || '-' || lpad(v_n::text, 2, '0');
  insert into public.finance_budgets(business_id, budget_code, name, fiscal_year, scenario, version, status, notes, base_year, baseline, created_by)
  values (b, v_code, coalesce(nullif(btrim(p_name), ''), p_year || ' Operating Budget'), p_year, 'budget', v_n, 'draft',
          'Started from ' || p_base_year || ' actuals (Jan–' || to_char(make_date(2000, v_last, 1), 'Mon') || '; later months = monthly average)', p_base_year, p_baseline, auth.uid())
  returning id into v_budget;

  for r in select a.line_key, max(a.line_type) line_type, (array_agg(a.category_id))[1] category_id, max(a.name) name, max(a.gl) gl,
                  array_agg(a.month) ms, array_agg(a.amount) amts
             from _act a group by a.line_key
            order by case max(a.line_type) when 'revenue' then 1 when 'cogs' then 2 else 3 end, sum(a.amount) desc loop
    v_base := array_fill(0::numeric, array[12]);
    for i in 1..array_length(r.ms, 1) loop v_base[r.ms[i]] := v_base[r.ms[i]] + round(r.amts[i], 2); end loop;
    v_avg := 0; for i in 1..v_last loop v_avg := v_avg + v_base[i]; end loop; v_avg := round(v_avg / v_last, 2);
    for i in v_last + 1 .. 12 loop v_base[i] := v_avg; end loop;
    v_total := 0; for i in 1..12 loop v_total := v_total + v_base[i]; end loop;
    continue when v_total = 0;
    -- yearly (accrued) items: 13th month, permits, insurance
    v_timing := case when r.gl = '5110' or r.name ~* '(permit|insurance|13th|annual)' then 'yearly' else 'monthly' end;
    v_pay := null;
    if v_timing = 'yearly' then
      v_pay := case when r.gl = '5110' or r.name ~* '13th' then 12 else 1 end;
      v_budgetm := array_fill(round(v_total / 12, 2), array[12]);
    elsif p_baseline = 'average' then
      v_budgetm := array_fill(round(v_total / 12, 2), array[12]);
    else
      v_budgetm := v_base;
    end if;
    v_sort := v_sort + 1;
    execute format('insert into public.finance_budget_lines(business_id, budget_id, line_code, account_name, category, line_key, line_type, category_id, gl_account_code,
                      timing, annual_amount, pay_month, base_months, sort_order, %s)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, %s)',
                   (select string_agg(m || '_budget', ',') from unnest(months) m),
                   (select string_agg('$15[' || k || ']', ',') from generate_series(1, 12) k))
      using b, v_budget, case r.line_type when 'revenue' then 'REV-' when 'cogs' then 'COGS-' else 'EXP-' end || lpad(v_sort::text, 3, '0'),
            r.name, case r.line_type when 'revenue' then 'Sales' when 'cogs' then 'Cost of sales' else 'Expenses' end, r.line_key, r.line_type, r.category_id, r.gl,
            v_timing, case when v_timing = 'yearly' then v_total end, v_pay, v_base, v_sort, v_budgetm;
  end loop;
  insert into public.finance_budget_scenarios(business_id, budget_id, name, description, is_base, created_by)
  values (b, v_budget, 'Base', 'This year''s actuals carried forward, with your line edits; no actions.', true, auth.uid());
  perform public.recalculate_finance_budget_totals(v_budget);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_budgets', v_budget, 'budget_created_from_actuals', jsonb_build_object('year', p_year, 'base_year', p_base_year, 'baseline', p_baseline, 'last_actual_month', v_last));
  return v_budget;
end $$;
grant execute on function public.budget_create_from_actuals(int, int, text, text) to authenticated;

-- an approved / closed budget is fixed: lines and scenario actions can no longer change
create or replace function public.budget_locked_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_budget uuid; v_status text;
begin
  if tg_table_name = 'finance_budget_lines' then v_budget := coalesce(new.budget_id, old.budget_id);
  elsif tg_table_name = 'finance_budget_scenarios' then v_budget := coalesce(new.budget_id, old.budget_id);
  else select s.budget_id into v_budget from public.finance_budget_scenarios s where s.id = coalesce(new.scenario_id, old.scenario_id);
  end if;
  select status::text into v_status from public.finance_budgets where id = v_budget;
  if v_status in ('approved','closed') then
    -- allowed after approval: the action's status (done / dropped) and the accrual link
    if tg_table_name = 'finance_budget_actions' and tg_op = 'UPDATE'
       and (to_jsonb(new) - 'status' - 'notes' - 'updated_at') = (to_jsonb(old) - 'status' - 'notes' - 'updated_at') then return new; end if;
    if tg_table_name = 'finance_budget_lines' and tg_op = 'UPDATE'
       and (to_jsonb(new) - 'accrual_schedule_id' - 'updated_at') = (to_jsonb(old) - 'accrual_schedule_id' - 'updated_at') then return new; end if;
    raise exception 'This budget is approved; make a new version to change it.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists budget_lines_locked on public.finance_budget_lines;
create trigger budget_lines_locked before insert or update or delete on public.finance_budget_lines for each row execute function public.budget_locked_guard();
drop trigger if exists budget_scenarios_locked on public.finance_budget_scenarios;
create trigger budget_scenarios_locked before insert or update or delete on public.finance_budget_scenarios for each row execute function public.budget_locked_guard();
drop trigger if exists budget_actions_locked on public.finance_budget_actions;
create trigger budget_actions_locked before insert or update or delete on public.finance_budget_actions for each row execute function public.budget_locked_guard();
