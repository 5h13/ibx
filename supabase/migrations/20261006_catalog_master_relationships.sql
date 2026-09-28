-- Build 22: controlled catalog category/unit masters, supplier relationships,
-- duplicate protection, and immutable supplier codes.

create table if not exists public.finance_catalog_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(name)
);

create unique index if not exists finance_catalog_categories_name_ci
  on public.finance_catalog_categories(lower(trim(name)));

create table if not exists public.finance_catalog_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(name)
);

create unique index if not exists finance_catalog_units_name_ci
  on public.finance_catalog_units(lower(trim(name)));

-- Seed the existing values before enforcing controlled references.
insert into public.finance_catalog_categories(name)
select distinct trim(category)
from public.finance_procurement_items
where nullif(trim(category),'') is not null
  and not exists (
    select 1 from public.finance_catalog_categories c
    where lower(trim(c.name)) = lower(trim(finance_procurement_items.category))
  );

insert into public.finance_catalog_categories(name)
select 'Uncategorized'
where not exists (
  select 1 from public.finance_catalog_categories where lower(trim(name))='uncategorized'
);

update public.finance_procurement_items
set category='Uncategorized'
where nullif(trim(category),'') is null;

insert into public.finance_catalog_units(name)
select distinct trim(unit)
from public.finance_procurement_items
where nullif(trim(unit),'') is not null
  and not exists (
    select 1 from public.finance_catalog_units u
    where lower(trim(u.name)) = lower(trim(finance_procurement_items.unit))
  );

insert into public.finance_catalog_units(name)
select 'unit'
where not exists (
  select 1 from public.finance_catalog_units where lower(trim(name))='unit'
);

alter table public.finance_procurement_items
  alter column category set not null;

create or replace function public.validate_procurement_catalog_values()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.finance_catalog_categories c
    where c.active and lower(trim(c.name)) = lower(trim(new.category))
  ) then
    raise exception 'Catalog category is not a controlled active catalog category.';
  end if;
  if not exists (
    select 1 from public.finance_catalog_units u
    where u.active and lower(trim(u.name)) = lower(trim(new.unit))
  ) then
    raise exception 'Catalog unit is not a controlled active catalog unit.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_procurement_catalog_values on public.finance_procurement_items;
create trigger validate_procurement_catalog_values
before insert or update on public.finance_procurement_items
for each row execute function public.validate_procurement_catalog_values();

create or replace function public.prevent_supplier_code_change()
returns trigger
language plpgsql
as $$
begin
  if new.supplier_code is distinct from old.supplier_code then
    raise exception 'Supplier code is system-controlled and immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_suppliers_immutable_code on public.finance_suppliers;
create trigger finance_suppliers_immutable_code
before update on public.finance_suppliers
for each row execute function public.prevent_supplier_code_change();

create table if not exists public.finance_procurement_item_suppliers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.finance_procurement_items(id) on delete cascade,
  supplier_id uuid not null references public.finance_suppliers(id) on delete restrict,
  supplier_item_code text,
  supplier_description text,
  last_purchase_cost numeric(14,2) check (last_purchase_cost is null or last_purchase_cost >= 0),
  preferred boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id, supplier_id)
);

create index if not exists finance_procurement_item_suppliers_item_idx
  on public.finance_procurement_item_suppliers(item_id, active, preferred);
create index if not exists finance_procurement_item_suppliers_supplier_idx
  on public.finance_procurement_item_suppliers(supplier_id, active);

create or replace function public.enforce_single_preferred_catalog_supplier()
returns trigger
language plpgsql
as $$
begin
  if new.preferred then
    update public.finance_procurement_item_suppliers
    set preferred=false, updated_at=now()
    where item_id=new.item_id and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid) and preferred;
    update public.finance_procurement_items
    set default_supplier_id=new.supplier_id, updated_at=now()
    where id=new.item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_single_preferred_catalog_supplier on public.finance_procurement_item_suppliers;
create trigger enforce_single_preferred_catalog_supplier
before insert or update on public.finance_procurement_item_suppliers
for each row execute function public.enforce_single_preferred_catalog_supplier();

alter table public.finance_catalog_categories enable row level security;
alter table public.finance_catalog_units enable row level security;
alter table public.finance_procurement_item_suppliers enable row level security;

drop policy if exists "finance catalog categories access" on public.finance_catalog_categories;
create policy "finance catalog categories access" on public.finance_catalog_categories for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance'
  or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance'
  or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);

drop policy if exists "finance catalog units access" on public.finance_catalog_units;
create policy "finance catalog units access" on public.finance_catalog_units for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance'
  or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance'
  or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);

drop policy if exists "finance catalog supplier relationships access" on public.finance_procurement_item_suppliers;
create policy "finance catalog supplier relationships access" on public.finance_procurement_item_suppliers for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance'
  or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance'
  or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
