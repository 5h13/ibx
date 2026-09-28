-- Consolidated release: supplier code immutability and controlled supplier documents.
-- Additive only; prior migrations are not modified.

create or replace function public.guard_supplier_code()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.supplier_code is distinct from old.supplier_code then
    raise exception 'Supplier code is system-controlled and immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_suppliers_guard_code on public.finance_suppliers;
create trigger finance_suppliers_guard_code
before update on public.finance_suppliers
for each row execute function public.guard_supplier_code();

create table if not exists public.finance_supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.finance_suppliers(id) on delete cascade,
  document_type text not null,
  document_name text not null,
  storage_path text not null unique,
  issue_date date,
  expiry_date date,
  status text not null default 'active' check (status in ('active','expired','superseded','archived')),
  notes text,
  uploaded_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_documents_supplier on public.finance_supplier_documents(supplier_id, status, expiry_date);

alter table public.finance_supplier_documents enable row level security;
drop policy if exists "finance supplier documents access" on public.finance_supplier_documents;
create policy "finance supplier documents access" on public.finance_supplier_documents
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

insert into storage.buckets (id, name, public)
values ('supplier-documents', 'supplier-documents', false)
on conflict (id) do nothing;
