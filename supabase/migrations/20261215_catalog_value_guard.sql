-- ============================================================================
-- Build 83e — catalog import (owner, 2026-10-03): "Catalog category is not a
-- controlled active catalog category." The guard on finance_procurement_items
-- checked the category and unit on EVERY update, so an item whose category
-- had since been retired or renamed could not be changed at all — not even
-- deactivated. The full-catalog upload deactivates the items missing from the
-- file, and stopped there.
-- Now the category / unit must be active only when an item is added, or when
-- its category / unit is changed, or when an item is reactivated — the cases
-- where a new value is being chosen. Deactivating, repricing or editing other
-- fields of an item keeps working whatever its old category.
-- ============================================================================
create or replace function public.validate_procurement_catalog_values()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.category is not distinct from old.category
     and new.unit is not distinct from old.unit
     and not (new.active and not coalesce(old.active, false)) then
    return new;
  end if;
  if tg_op = 'UPDATE' and not new.active then
    return new;   -- retiring an item never needs an active category
  end if;
  if not exists (
    select 1 from public.finance_catalog_categories c
    where c.active and lower(trim(c.name)) = lower(trim(new.category))
  ) then
    raise exception 'Catalog category "%" is not an active catalog category (item %).', new.category, coalesce(new.item_code, new.item_name);
  end if;
  if not exists (
    select 1 from public.finance_catalog_units u
    where u.active and lower(trim(u.name)) = lower(trim(new.unit))
  ) then
    raise exception 'Catalog unit "%" is not an active catalog unit (item %).', new.unit, coalesce(new.item_code, new.item_name);
  end if;
  return new;
end;
$$;
