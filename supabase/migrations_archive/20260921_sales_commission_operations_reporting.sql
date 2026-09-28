-- IBX Sales / Commission Operations & Reporting

create table if not exists public.sales_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  payout_number text not null unique,
  employee_id uuid references public.employees(id),
  period_start date not null,
  period_end date not null,
  payout_date date,
  gross_commission numeric(14,2) not null default 0,
  adjustments numeric(14,2) not null default 0,
  net_commission numeric(14,2) generated always as (gross_commission + adjustments) stored,
  payment_reference text,
  status text not null default 'draft' check(status in ('draft','prepared','reviewed','approved','paid','cancelled')),
  notes text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end >= period_start)
);

create table if not exists public.sales_commission_monthly_summary (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id),
  employee_id uuid references public.employees(id),
  year integer not null check(year between 2000 and 2200),
  month integer not null check(month between 1 and 12),
  commission_count integer not null default 0,
  accrued numeric(14,2) not null default 0,
  prepared numeric(14,2) not null default 0,
  reviewed numeric(14,2) not null default 0,
  approved numeric(14,2) not null default 0,
  paid numeric(14,2) not null default 0,
  open_amount numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(section_id, employee_id, year, month)
);

alter table public.sales_commission_payouts enable row level security;
alter table public.sales_commission_monthly_summary enable row level security;

drop policy if exists sales_commission_payouts_access on public.sales_commission_payouts;
create policy sales_commission_payouts_access on public.sales_commission_payouts for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
);
drop policy if exists sales_commission_monthly_summary_access on public.sales_commission_monthly_summary;
create policy sales_commission_monthly_summary_access on public.sales_commission_monthly_summary for select using (
  public.is_super_admin() or public.in_section(section_id)
);
drop policy if exists sales_commission_monthly_summary_admin on public.sales_commission_monthly_summary;
create policy sales_commission_monthly_summary_admin on public.sales_commission_monthly_summary for all using (public.is_super_admin()) with check (public.is_super_admin());

create index if not exists idx_sales_commission_payouts_period on public.sales_commission_payouts(period_start, period_end);
create index if not exists idx_sales_commission_payouts_employee on public.sales_commission_payouts(employee_id, status);
create index if not exists idx_sales_commission_summary_period on public.sales_commission_monthly_summary(year, month);

create or replace function public.refresh_sales_commission_monthly_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_section uuid;
  v_start date;
  v_end date;
begin
  select id into v_section from public.sections where code='sales' limit 1;
  if v_section is null then return; end if;
  v_start := make_date(p_year,p_month,1);
  v_end := (v_start + interval '1 month')::date;
  delete from public.sales_commission_monthly_summary where section_id=v_section and year=p_year and month=p_month;
  insert into public.sales_commission_monthly_summary(section_id,employee_id,year,month,commission_count,accrued,prepared,reviewed,approved,paid,open_amount,updated_at)
  select
    v_section, sc.employee_id, p_year, p_month, count(*),
    coalesce(sum(sc.commission_amount),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status in ('prepared','reviewed','approved','paid')),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status in ('reviewed','approved','paid')),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status in ('approved','paid')),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status='paid'),0),
    coalesce(sum(sc.commission_amount) filter(where sc.status not in ('paid','cancelled')),0), now()
  from public.sales_commissions sc
  join public.sales_orders so on so.id=sc.sales_order_id
  where so.order_date >= v_start and so.order_date < v_end
  group by sc.employee_id;
end; $$;
grant execute on function public.refresh_sales_commission_monthly_summary(integer,integer) to authenticated;

create or replace function public.refresh_sales_commission_for_order(p_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare y integer; m integer;
begin
  select extract(year from order_date)::integer, extract(month from order_date)::integer into y,m from public.sales_orders where id=p_order_id;
  if y is not null then perform public.refresh_sales_commission_monthly_summary(y,m); end if;
end; $$;
grant execute on function public.refresh_sales_commission_for_order(uuid) to authenticated;
