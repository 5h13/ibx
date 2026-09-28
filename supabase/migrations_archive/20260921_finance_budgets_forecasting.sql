-- IBX Finance: Budgets & Forecasting foundation
create type public.finance_budget_status as enum ('draft','prepared','reviewed','approved','closed');
create type public.finance_budget_scenario as enum ('budget','forecast','best_case','conservative');

create table public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  budget_code text not null unique,
  name text not null,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200),
  scenario public.finance_budget_scenario not null default 'budget',
  version integer not null default 1 check (version > 0),
  status public.finance_budget_status not null default 'draft',
  notes text,
  total_budget numeric(14,2) not null default 0,
  total_forecast numeric(14,2) not null default 0,
  created_by uuid references auth.users(id),
  prepared_by uuid references auth.users(id), prepared_at timestamptz,
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  closed_by uuid references auth.users(id), closed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index finance_budgets_year_version_idx on public.finance_budgets(fiscal_year, scenario, version);

create table public.finance_budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.finance_budgets(id) on delete cascade,
  line_code text not null,
  account_name text not null,
  department text,
  category text,
  notes text,
  jan_budget numeric(14,2) not null default 0, feb_budget numeric(14,2) not null default 0, mar_budget numeric(14,2) not null default 0,
  apr_budget numeric(14,2) not null default 0, may_budget numeric(14,2) not null default 0, jun_budget numeric(14,2) not null default 0,
  jul_budget numeric(14,2) not null default 0, aug_budget numeric(14,2) not null default 0, sep_budget numeric(14,2) not null default 0,
  oct_budget numeric(14,2) not null default 0, nov_budget numeric(14,2) not null default 0, dec_budget numeric(14,2) not null default 0,
  jan_forecast numeric(14,2) not null default 0, feb_forecast numeric(14,2) not null default 0, mar_forecast numeric(14,2) not null default 0,
  apr_forecast numeric(14,2) not null default 0, may_forecast numeric(14,2) not null default 0, jun_forecast numeric(14,2) not null default 0,
  jul_forecast numeric(14,2) not null default 0, aug_forecast numeric(14,2) not null default 0, sep_forecast numeric(14,2) not null default 0,
  oct_forecast numeric(14,2) not null default 0, nov_forecast numeric(14,2) not null default 0, dec_forecast numeric(14,2) not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(budget_id, line_code)
);

create table public.finance_budget_actuals (
  id uuid primary key default gen_random_uuid(),
  budget_line_id uuid not null references public.finance_budget_lines(id) on delete cascade,
  fiscal_year integer not null,
  month integer not null check (month between 1 and 12),
  actual_amount numeric(14,2) not null default 0,
  source_module text,
  source_record_id uuid,
  notes text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(budget_line_id, month)
);

create index finance_budget_lines_budget_idx on public.finance_budget_lines(budget_id);
create index finance_budget_actuals_year_month_idx on public.finance_budget_actuals(fiscal_year, month);

create or replace function public.recalculate_finance_budget_totals(p_budget_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.finance_budgets b
  set total_budget = coalesce((select sum(jan_budget+feb_budget+mar_budget+apr_budget+may_budget+jun_budget+jul_budget+aug_budget+sep_budget+oct_budget+nov_budget+dec_budget) from public.finance_budget_lines l where l.budget_id=b.id),0),
      total_forecast = coalesce((select sum(jan_forecast+feb_forecast+mar_forecast+apr_forecast+may_forecast+jun_forecast+jul_forecast+aug_forecast+sep_forecast+oct_forecast+nov_forecast+dec_forecast) from public.finance_budget_lines l where l.budget_id=b.id),0),
      updated_at=now()
  where b.id=p_budget_id;
end; $$;

grant execute on function public.recalculate_finance_budget_totals(uuid) to authenticated;

alter table public.finance_budgets enable row level security;
alter table public.finance_budget_lines enable row level security;
alter table public.finance_budget_actuals enable row level security;

create policy finance_budgets_select on public.finance_budgets for select to authenticated using (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budgets_insert on public.finance_budgets for insert to authenticated with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budgets_update on public.finance_budgets for update to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_lines_select on public.finance_budget_lines for select to authenticated using (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_lines_insert on public.finance_budget_lines for insert to authenticated with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_lines_update on public.finance_budget_lines for update to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_lines_delete on public.finance_budget_lines for delete to authenticated using (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_actuals_select on public.finance_budget_actuals for select to authenticated using (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_actuals_insert on public.finance_budget_actuals for insert to authenticated with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_budget_actuals_update on public.finance_budget_actuals for update to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());

insert into public.finance_budgets (budget_code,name,fiscal_year,scenario,version,status,notes)
values ('BUD-2026-01','FY2026 Operating Budget',2026,'budget',1,'draft','Initial Finance budget foundation')
on conflict (budget_code) do nothing;
