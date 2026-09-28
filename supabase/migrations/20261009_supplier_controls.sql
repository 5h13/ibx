-- Build 28: supplier document lifecycle and credit exposure controls.
-- Additive only; prior migrations remain untouched.

alter table public.finance_suppliers
  add column if not exists credit_limit numeric(14,2),
  add column if not exists credit_currency text not null default 'PHP',
  add column if not exists credit_warning_enabled boolean not null default true;

alter table public.finance_suppliers
  drop constraint if exists finance_suppliers_credit_limit_nonnegative;
alter table public.finance_suppliers
  add constraint finance_suppliers_credit_limit_nonnegative
  check (credit_limit is null or credit_limit >= 0);

create index if not exists idx_finance_suppliers_credit
  on public.finance_suppliers(active, credit_limit);

-- Supplier exposure is derived from posted/approved AP invoices and excludes voided records.
create or replace view public.finance_supplier_credit_exposure as
select
  s.id as supplier_id,
  s.supplier_code,
  s.legal_name,
  s.payment_terms,
  s.credit_limit,
  s.credit_currency,
  s.credit_warning_enabled,
  coalesce(sum(case
    when i.status not in ('voided','paid') then greatest(coalesce(i.balance_due,0), 0)
    else 0
  end), 0)::numeric(14,2) as outstanding_exposure,
  greatest(coalesce(s.credit_limit,0) - coalesce(sum(case
    when i.status not in ('voided','paid') then greatest(coalesce(i.balance_due,0), 0)
    else 0
  end),0), 0)::numeric(14,2) as available_credit,
  case
    when s.credit_limit is null then false
    when coalesce(sum(case
      when i.status not in ('voided','paid') then greatest(coalesce(i.balance_due,0), 0)
      else 0
    end),0) > s.credit_limit then true
    else false
  end as credit_limit_exceeded
from public.finance_suppliers s
left join public.finance_supplier_invoices i on i.supplier_id=s.id
group by s.id, s.supplier_code, s.legal_name, s.payment_terms,
         s.credit_limit, s.credit_currency, s.credit_warning_enabled;

-- Document lifecycle remains controlled by Finance/Admin. Status is not used to delete history.
create or replace function public.refresh_supplier_document_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'active' and new.expiry_date is not null and new.expiry_date < current_date then
    new.status := 'expired';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_supplier_document_status_guard on public.finance_supplier_documents;
create trigger finance_supplier_document_status_guard
before insert or update on public.finance_supplier_documents
for each row execute function public.refresh_supplier_document_status();

create index if not exists idx_supplier_documents_expiry_status
  on public.finance_supplier_documents(expiry_date, status);
