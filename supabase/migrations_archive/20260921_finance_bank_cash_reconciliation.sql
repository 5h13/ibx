-- IBX Finance Bank / Cash & Reconciliation Foundation

do $$ begin
  create type public.bank_account_status as enum ('active','inactive','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cash_transaction_status as enum ('draft','prepared','reviewed','approved','posted','voided');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cash_transaction_type as enum ('deposit','withdrawal','transfer_in','transfer_out','bank_charge','interest','adjustment');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reconciliation_status as enum ('draft','in_progress','completed','locked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.reconciliation_item_status as enum ('unmatched','matched','excluded');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name text not null,
  bank_name text,
  account_number_masked text,
  account_type text not null default 'checking',
  currency text not null default 'PHP',
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  status public.bank_account_status not null default 'active',
  is_cash_on_hand boolean not null default false,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number text not null unique,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transaction_date date not null,
  transaction_type public.cash_transaction_type not null,
  amount numeric(14,2) not null check (amount > 0),
  direction text not null check (direction in ('in','out')),
  description text not null,
  reference_number text,
  counterparty text,
  source_module text,
  source_record_id uuid,
  status public.cash_transaction_status not null default 'draft',
  posted_at timestamptz,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  posted_by uuid references public.users(id),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  statement_date date not null,
  statement_opening_balance numeric(14,2) not null default 0,
  statement_closing_balance numeric(14,2) not null default 0,
  book_balance numeric(14,2) not null default 0,
  reconciled_balance numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  status public.reconciliation_status not null default 'draft',
  notes text,
  completed_by uuid references public.users(id),
  completed_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bank_account_id, statement_date)
);

create table if not exists public.finance_bank_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references public.finance_bank_reconciliations(id) on delete cascade,
  transaction_id uuid references public.finance_cash_transactions(id) on delete set null,
  statement_date date,
  statement_reference text,
  description text,
  statement_amount numeric(14,2) not null default 0,
  status public.reconciliation_item_status not null default 'unmatched',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists finance_bank_accounts_status_idx on public.finance_bank_accounts(status);
create index if not exists finance_cash_transactions_account_date_idx on public.finance_cash_transactions(bank_account_id,transaction_date desc);
create index if not exists finance_cash_transactions_status_idx on public.finance_cash_transactions(status,created_at desc);
create index if not exists finance_bank_reconciliations_account_date_idx on public.finance_bank_reconciliations(bank_account_id,statement_date desc);
create index if not exists finance_bank_reconciliation_items_rec_idx on public.finance_bank_reconciliation_items(reconciliation_id,status);

create or replace function public.set_finance_bank_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists finance_bank_accounts_updated_at on public.finance_bank_accounts;
create trigger finance_bank_accounts_updated_at before update on public.finance_bank_accounts for each row execute function public.set_finance_bank_updated_at();
drop trigger if exists finance_cash_transactions_updated_at on public.finance_cash_transactions;
create trigger finance_cash_transactions_updated_at before update on public.finance_cash_transactions for each row execute function public.set_finance_bank_updated_at();
drop trigger if exists finance_bank_reconciliations_updated_at on public.finance_bank_reconciliations;
create trigger finance_bank_reconciliations_updated_at before update on public.finance_bank_reconciliations for each row execute function public.set_finance_bank_updated_at();

create or replace function public.recalculate_finance_bank_balance(p_bank_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.finance_bank_accounts a
  set current_balance = a.opening_balance + coalesce((select sum(case when t.direction='in' then t.amount else -t.amount end) from public.finance_cash_transactions t where t.bank_account_id=a.id and t.status='posted'),0), updated_at=now()
  where a.id=p_bank_account_id;
end; $$;

create or replace function public.recalculate_finance_reconciliation(p_reconciliation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.finance_bank_reconciliations where id=p_reconciliation_id;
  if not found then return; end if;
  update public.finance_bank_reconciliations x
  set book_balance = coalesce((select current_balance from public.finance_bank_accounts where id=r.bank_account_id),0),
      reconciled_balance = r.statement_closing_balance,
      difference = coalesce((select current_balance from public.finance_bank_accounts where id=r.bank_account_id),0) - r.statement_closing_balance,
      updated_at=now()
  where id=p_reconciliation_id;
end; $$;

alter table public.finance_bank_accounts enable row level security;
alter table public.finance_cash_transactions enable row level security;
alter table public.finance_bank_reconciliations enable row level security;
alter table public.finance_bank_reconciliation_items enable row level security;

create policy finance_bank_accounts_all on public.finance_bank_accounts for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy finance_cash_transactions_all on public.finance_cash_transactions for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy finance_bank_reconciliations_all on public.finance_bank_reconciliations for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
create policy finance_bank_reconciliation_items_all on public.finance_bank_reconciliation_items for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='finance'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='finance')));
