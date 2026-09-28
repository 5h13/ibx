-- Consolidated release: supplier master lifecycle and contact/payment structure.
-- Additive migration; existing migrations are intentionally untouched.

alter table public.finance_suppliers
  alter column supplier_code drop not null;

alter table public.finance_suppliers
  add column if not exists preferred_payment_method text,
  add column if not exists payment_destination text,
  add column if not exists billing_address text,
  add column if not exists shipping_address text;

create sequence if not exists public.finance_supplier_code_seq;

create or replace function public.generate_supplier_code()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  loop
    n := nextval('public.finance_supplier_code_seq');
    exit when not exists (select 1 from public.finance_suppliers where supplier_code = 'SUP-' || lpad(n::text, 5, '0'));
  end loop;
  return 'SUP-' || lpad(n::text, 5, '0');
end;
$$;

create or replace function public.set_supplier_code()
returns trigger
language plpgsql
as $$
begin
  if nullif(trim(coalesce(new.supplier_code,'')), '') is null then
    new.supplier_code := public.generate_supplier_code();
  end if;
  return new;
end;
$$;

drop trigger if exists finance_suppliers_assign_code on public.finance_suppliers;
create trigger finance_suppliers_assign_code
before insert on public.finance_suppliers
for each row execute function public.set_supplier_code();

-- Existing supplier codes remain unchanged. Keep the sequence ahead of all existing SUP-numbers.
select setval(
  'public.finance_supplier_code_seq',
  greatest(
    coalesce((select max(nullif(regexp_replace(supplier_code, '^SUP-', ''), '')::bigint)
              from public.finance_suppliers
              where supplier_code ~ '^SUP-[0-9]+$'), 0),
    coalesce((select last_value from public.finance_supplier_code_seq), 0)
  ),
  true
);

alter table public.finance_suppliers
  alter column supplier_code set not null;

create table if not exists public.finance_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.finance_suppliers(id) on delete cascade,
  contact_name text not null,
  job_title text,
  email text,
  phone text,
  mobile text,
  is_primary boolean not null default false,
  active boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_contacts_supplier on public.finance_supplier_contacts(supplier_id, active, is_primary);

alter table public.finance_supplier_contacts enable row level security;

drop policy if exists "finance supplier contacts access" on public.finance_supplier_contacts;
create policy "finance supplier contacts access" on public.finance_supplier_contacts
for all using (
  public.is_super_admin()
  or (select role from public.users where id=auth.uid())='finance'
  or exists (
    select 1 from public.user_access ua
    join public.sections s on s.id=ua.section_id
    where ua.user_id=auth.uid() and s.code='finance'
  )
) with check (
  public.is_super_admin()
  or (select role from public.users where id=auth.uid())='finance'
  or exists (
    select 1 from public.user_access ua
    join public.sections s on s.id=ua.section_id
    where ua.user_id=auth.uid() and s.code='finance'
  )
);

-- Logistics needs supplier identity only; contacts/payment details remain Finance-controlled.
