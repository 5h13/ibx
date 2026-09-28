-- Build 26: catalog pricing rules and traceable calculation foundation.
create table if not exists public.finance_catalog_category_pricing (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.finance_catalog_categories(id) on delete restrict,
  addon_percent numeric(7,4) not null default 0 check (addon_percent >= 0 and addon_percent <= 1000),
  active boolean not null default true,
  effective_from date not null default current_date,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(category_id)
);

create table if not exists public.finance_catalog_item_pricing (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.finance_procurement_items(id) on delete restrict,
  markup_percent numeric(7,4) not null default 0 check (markup_percent >= 0 and markup_percent <= 1000),
  active boolean not null default true,
  effective_from date not null default current_date,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id)
);

create table if not exists public.finance_catalog_customer_discounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.finance_customers(id) on delete restrict,
  item_id uuid not null references public.finance_procurement_items(id) on delete restrict,
  discount_percent numeric(7,4) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  active boolean not null default true,
  effective_from date not null default current_date,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,item_id)
);

create index if not exists idx_catalog_category_pricing_category on public.finance_catalog_category_pricing(category_id,active);
create index if not exists idx_catalog_item_pricing_item on public.finance_catalog_item_pricing(item_id,active);
create index if not exists idx_catalog_customer_discounts_customer on public.finance_catalog_customer_discounts(customer_id,active);

create or replace function public.calculate_catalog_pricing(
  p_item_id uuid,
  p_supplier_cost numeric default null,
  p_customer_id uuid default null
)
returns table(
  supplier_cost numeric,
  category_addon_percent numeric,
  acquisition_cost numeric,
  item_markup_percent numeric,
  srp numeric,
  customer_discount_percent numeric,
  customer_price numeric
)
language sql
stable
as $$
  with base as (
    select i.id, coalesce(p_supplier_cost, i.standard_cost, 0)::numeric as cost,
           coalesce(cp.addon_percent,0)::numeric as addon,
           coalesce(ip.markup_percent,0)::numeric as markup
    from public.finance_procurement_items i
    left join public.finance_catalog_categories c on lower(trim(c.name))=lower(trim(i.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id=c.id and cp.active
    left join public.finance_catalog_item_pricing ip on ip.item_id=i.id and ip.active
    where i.id=p_item_id
  ), priced as (
    select cost, addon, (cost*(1+addon/100))::numeric as acq, markup
    from base
  ), final as (
    select p.*, (p.acq*(1+p.markup/100))::numeric as sell,
           coalesce((select d.discount_percent from public.finance_catalog_customer_discounts d where d.customer_id=p_customer_id and d.item_id=p_item_id and d.active limit 1),0)::numeric as discount
    from priced p
  )
  select cost, addon, acq, markup, sell, discount, (sell*(1-discount/100))::numeric
  from final;
$$;

-- Seed zero-value rules so every existing category/item has an explicit rule record.
insert into public.finance_catalog_category_pricing(category_id,addon_percent)
select c.id,0 from public.finance_catalog_categories c
where not exists(select 1 from public.finance_catalog_category_pricing p where p.category_id=c.id);

insert into public.finance_catalog_item_pricing(item_id,markup_percent)
select i.id,0 from public.finance_procurement_items i
where not exists(select 1 from public.finance_catalog_item_pricing p where p.item_id=i.id);

alter table public.finance_catalog_category_pricing enable row level security;
alter table public.finance_catalog_item_pricing enable row level security;
alter table public.finance_catalog_customer_discounts enable row level security;

drop policy if exists "catalog pricing finance access" on public.finance_catalog_category_pricing;
create policy "catalog pricing finance access" on public.finance_catalog_category_pricing for all using (public.is_super_admin() or public.has_section_access('finance')) with check (public.is_super_admin() or public.has_section_access('finance'));
drop policy if exists "catalog item pricing finance access" on public.finance_catalog_item_pricing;
create policy "catalog item pricing finance access" on public.finance_catalog_item_pricing for all using (public.is_super_admin() or public.has_section_access('finance')) with check (public.is_super_admin() or public.has_section_access('finance'));
drop policy if exists "catalog customer discounts finance access" on public.finance_catalog_customer_discounts;
create policy "catalog customer discounts finance access" on public.finance_catalog_customer_discounts for all using (public.is_super_admin() or public.has_section_access('finance') or public.has_section_access('sales')) with check (public.is_super_admin() or public.has_section_access('finance') or public.has_section_access('sales'));
