-- Build 24: supplier contact integrity and lifecycle controls.
create or replace function public.enforce_supplier_primary_contact()
returns trigger
language plpgsql
as $$
begin
  if new.is_primary and new.active then
    update public.finance_supplier_contacts
      set is_primary = false, updated_at = now()
      where supplier_id = new.supplier_id
        and id <> new.id
        and is_primary = true
        and active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_supplier_primary_contact on public.finance_supplier_contacts;
create trigger trg_supplier_primary_contact
before insert or update of supplier_id, is_primary, active
on public.finance_supplier_contacts
for each row execute function public.enforce_supplier_primary_contact();

create index if not exists idx_supplier_contacts_lookup
  on public.finance_supplier_contacts(supplier_id, active, contact_name);
