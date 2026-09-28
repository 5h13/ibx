-- IBX Finance: Financial Summary / Accounting Posting Integration
create type public.finance_account_type as enum ('asset','liability','equity','revenue','expense');
create type public.finance_journal_status as enum ('draft','prepared','reviewed','approved','posted','voided');

create table public.finance_chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name text not null,
  account_type public.finance_account_type not null,
  parent_id uuid references public.finance_chart_of_accounts(id),
  is_control_account boolean not null default false,
  active boolean not null default true,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_accounting_periods (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  unique(year, month)
);

create table public.finance_journal_entries (
  id uuid primary key default gen_random_uuid(),
  journal_number text not null unique,
  entry_date date not null,
  description text not null,
  source_module text,
  source_record_id uuid,
  section_id uuid references public.sections(id),
  status public.finance_journal_status not null default 'draft',
  total_debit numeric(14,2) not null default 0,
  total_credit numeric(14,2) not null default 0,
  prepared_by uuid references auth.users(id), prepared_at timestamptz,
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  approved_by uuid references auth.users(id), approved_at timestamptz,
  posted_by uuid references auth.users(id), posted_at timestamptz,
  voided_by uuid references auth.users(id), voided_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.finance_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.finance_journal_entries(id) on delete cascade,
  account_id uuid not null references public.finance_chart_of_accounts(id),
  line_description text,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  department text,
  created_at timestamptz not null default now(),
  check ((debit = 0 and credit > 0) or (credit = 0 and debit > 0))
);

create index finance_journal_entries_date_idx on public.finance_journal_entries(entry_date);
create index finance_journal_entries_source_idx on public.finance_journal_entries(source_module, source_record_id);
create index finance_journal_lines_account_idx on public.finance_journal_lines(account_id);
create unique index finance_posted_source_unique_idx on public.finance_journal_entries(source_module, source_record_id) where status='posted' and source_module is not null and source_record_id is not null;

create or replace function public.recalculate_finance_journal_totals(p_journal_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.finance_journal_entries j
  set total_debit=coalesce((select sum(debit) from public.finance_journal_lines l where l.journal_entry_id=j.id),0),
      total_credit=coalesce((select sum(credit) from public.finance_journal_lines l where l.journal_entry_id=j.id),0),
      updated_at=now()
  where j.id=p_journal_id;
end; $$;

grant execute on function public.recalculate_finance_journal_totals(uuid) to authenticated;

create or replace function public.post_finance_journal(p_journal_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare j public.finance_journal_entries%rowtype; period_status text; d numeric(14,2); c numeric(14,2);
begin
  select * into j from public.finance_journal_entries where id=p_journal_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if j.status <> 'approved' then raise exception 'Only approved journal entries can be posted'; end if;
  select status into period_status from public.finance_accounting_periods where year=extract(year from j.entry_date)::int and month=extract(month from j.entry_date)::int;
  if period_status='closed' then raise exception 'Accounting period is closed'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d,c from public.finance_journal_lines where journal_entry_id=j.id;
  if d <= 0 or d <> c then raise exception 'Journal entry must be balanced and greater than zero'; end if;
  update public.finance_journal_entries set status='posted',posted_by=p_actor,posted_at=now(),total_debit=d,total_credit=c,updated_at=now() where id=j.id;
  perform public.refresh_financial_summary_from_ledger(j.entry_date);
end; $$;

create or replace function public.refresh_financial_summary_from_ledger(p_entry_date date)
returns void language plpgsql security definer set search_path=public as $$
declare mid uuid; y int:=extract(year from p_entry_date)::int; m int:=extract(month from p_entry_date)::int; sec record;
begin
  select id into mid from public.months where year=y and month=m limit 1;
  if mid is null then return; end if;
  insert into public.months(year,month,label) values(y,m,to_char(p_entry_date,'FMMonth YYYY')) on conflict(year,month) do nothing;
  select id into mid from public.months where year=y and month=m;
  insert into public.financial_summary(section_id,month_id,total_sales,total_expenses,bottomline,total_commission,computed_at)
  select null,mid,
    coalesce(sum(case when coa.account_type='revenue' then jl.credit-jl.debit else 0 end),0),
    coalesce(sum(case when coa.account_type='expense' then jl.debit-jl.credit else 0 end),0),
    coalesce(sum(case when coa.account_type='revenue' then jl.credit-jl.debit when coa.account_type='expense' then -(jl.debit-jl.credit) else 0 end),0),
    0,now()
  from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id=je.id join public.finance_chart_of_accounts coa on coa.id=jl.account_id
  where je.status='posted' and extract(year from je.entry_date)=y and extract(month from je.entry_date)=m;
  on conflict(section_id,month_id) do update set total_sales=excluded.total_sales,total_expenses=excluded.total_expenses,bottomline=excluded.bottomline,computed_at=now();
end; $$;

grant execute on function public.post_finance_journal(uuid,uuid) to authenticated;
grant execute on function public.refresh_financial_summary_from_ledger(date) to authenticated;

alter table public.finance_chart_of_accounts enable row level security;
alter table public.finance_accounting_periods enable row level security;
alter table public.finance_journal_entries enable row level security;
alter table public.finance_journal_lines enable row level security;

create policy finance_coa_all on public.finance_chart_of_accounts for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_periods_all on public.finance_accounting_periods for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_journal_all on public.finance_journal_entries for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());
create policy finance_journal_lines_all on public.finance_journal_lines for all to authenticated using (public.has_section_access('finance') or public.is_super_admin()) with check (public.has_section_access('finance') or public.is_super_admin());

insert into public.finance_chart_of_accounts(account_code,account_name,account_type,is_control_account) values
('1000','Cash on Hand','asset',true),('1010','Bank Accounts','asset',true),('1100','Accounts Receivable','asset',true),('1200','Inventory','asset',true),('1500','Property & Equipment','asset',false),
('2000','Accounts Payable','liability',true),('2100','Payroll Liabilities','liability',true),('2200','Taxes Payable','liability',true),
('3000','Owner Equity','equity',false),('4000','Sales Revenue','revenue',true),('4100','Other Revenue','revenue',false),
('5000','Cost of Sales','expense',true),('5100','Payroll Expense','expense',true),('5200','Operating Expenses','expense',true),('5300','Bank Charges','expense',false)
on conflict(account_code) do nothing;

insert into public.finance_accounting_periods(year,month,status)
select extract(year from now())::int, m, 'open' from generate_series(1,12) m
on conflict(year,month) do nothing;
