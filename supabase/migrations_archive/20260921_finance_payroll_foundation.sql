-- IBX Finance Payroll Foundation

do $$ begin
  create type public.payroll_period_status as enum ('open','processing','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_run_status as enum ('draft','prepared','reviewed','approved','posted','voided');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_frequency as enum ('monthly','semi_monthly','weekly','daily');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payroll_compensation_type as enum ('monthly','daily','hourly');
exception when duplicate_object then null; end $$;

create table if not exists public.payroll_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  compensation_type public.payroll_compensation_type not null default 'monthly',
  pay_frequency public.payroll_frequency not null default 'monthly',
  base_rate numeric(14,2) not null default 0 check (base_rate >= 0),
  housing_allowance numeric(14,2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  meal_allowance numeric(14,2) not null default 0 check (meal_allowance >= 0),
  other_allowance numeric(14,2) not null default 0 check (other_allowance >= 0),
  overtime_multiplier numeric(6,3) not null default 1.25 check (overtime_multiplier >= 0),
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_profile_dates check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_name text not null,
  start_date date not null,
  end_date date not null,
  pay_date date,
  frequency public.payroll_frequency not null default 'monthly',
  status public.payroll_period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references public.users(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(start_date,end_date),
  constraint payroll_period_dates check (end_date >= start_date)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  run_number text not null unique,
  period_id uuid not null references public.payroll_periods(id) on delete restrict,
  status public.payroll_run_status not null default 'draft',
  employee_count int not null default 0,
  gross_pay numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  notes text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_by uuid references public.users(id),
  posted_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id)
);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  base_pay numeric(14,2) not null default 0,
  overtime_pay numeric(14,2) not null default 0,
  paid_leave_pay numeric(14,2) not null default 0,
  housing_allowance numeric(14,2) not null default 0,
  transport_allowance numeric(14,2) not null default 0,
  meal_allowance numeric(14,2) not null default 0,
  other_allowance numeric(14,2) not null default 0,
  gross_pay numeric(14,2) not null default 0,
  tax_withheld numeric(14,2) not null default 0,
  social_security numeric(14,2) not null default 0,
  health_contribution numeric(14,2) not null default 0,
  housing_fund numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  regular_hours numeric(10,2) not null default 0,
  overtime_hours numeric(10,2) not null default 0,
  paid_leave_days numeric(10,2) not null default 0,
  unpaid_leave_days numeric(10,2) not null default 0,
  attendance_days numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_run_id, employee_id)
);

create table if not exists public.payroll_entry_adjustments (
  id uuid primary key default gen_random_uuid(),
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('earning','deduction')),
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists payroll_period_status_idx on public.payroll_periods(status,start_date desc);
create index if not exists payroll_run_status_idx on public.payroll_runs(status,created_at desc);
create index if not exists payroll_entries_employee_idx on public.payroll_entries(employee_id,payroll_run_id);

create or replace function public.set_payroll_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists payroll_profile_updated_at on public.payroll_employee_profiles;
create trigger payroll_profile_updated_at before update on public.payroll_employee_profiles for each row execute function public.set_payroll_updated_at();
drop trigger if exists payroll_period_updated_at on public.payroll_periods;
create trigger payroll_period_updated_at before update on public.payroll_periods for each row execute function public.set_payroll_updated_at();
drop trigger if exists payroll_run_updated_at on public.payroll_runs;
create trigger payroll_run_updated_at before update on public.payroll_runs for each row execute function public.set_payroll_updated_at();
drop trigger if exists payroll_entry_updated_at on public.payroll_entries;
create trigger payroll_entry_updated_at before update on public.payroll_entries for each row execute function public.set_payroll_updated_at();

alter table public.payroll_employee_profiles enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entry_adjustments enable row level security;

create policy payroll_profiles_finance_all on public.payroll_employee_profiles for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy payroll_periods_finance_all on public.payroll_periods for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy payroll_runs_finance_all on public.payroll_runs for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy payroll_entries_finance_all on public.payroll_entries for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy payroll_adjustments_finance_all on public.payroll_entry_adjustments for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
