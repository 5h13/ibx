-- Build 29: service items and mixed product/service pricing.
alter table public.finance_procurement_items
  add column if not exists item_type text not null default 'product' check (item_type in ('product','service')),
  add column if not exists service_cost_basis numeric(14,2) not null default 0 check (service_cost_basis >= 0);

create index if not exists idx_procurement_items_type_active on public.finance_procurement_items(item_type,active);

alter table public.sales_quotation_items add column if not exists pricing_service_cost_basis numeric(14,2), add column if not exists pricing_item_type text check (pricing_item_type in ('product','service')) DEFAULT 'product';

-- Services use Service Cost Basis terminology. Product acquisition cost remains product-only.
-- (The 2026-10-08 migration defined this function with a 7-column return
-- table; CREATE OR REPLACE FUNCTION cannot change an OUT-parameter/return
-- table's column list, so the old signature must be dropped first.)
drop function if exists public.get_catalog_sales_price(uuid,uuid,numeric);
create or replace function public.get_catalog_sales_price(
  p_item_id uuid,
  p_customer_id uuid default null,
  p_supplier_cost numeric default null
)
returns table(
  item_type text,
  supplier_cost numeric,
  service_cost_basis numeric,
  category_addon_percent numeric,
  acquisition_cost numeric,
  item_markup_percent numeric,
  srp numeric,
  customer_discount_percent numeric,
  customer_price numeric
)
language sql stable security definer set search_path=public as $$
  with base as (
    select i.item_type,
           case when i.item_type='service' then 0::numeric else coalesce(p_supplier_cost,i.standard_cost,0)::numeric end as product_cost,
           case when i.item_type='service' then coalesce(i.service_cost_basis,0)::numeric else 0::numeric end as service_basis,
           coalesce(cp.addon_percent,0)::numeric as addon,
           coalesce(ip.markup_percent,0)::numeric as markup
    from public.finance_procurement_items i
    left join public.finance_catalog_categories c on lower(trim(c.name))=lower(trim(i.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id=c.id and cp.active
    left join public.finance_catalog_item_pricing ip on ip.item_id=i.id and ip.active
    where i.id=p_item_id
  ), priced as (
    select *,
      case when item_type='service' then null::numeric else product_cost*(1+addon/100) end as acq,
      case when item_type='service' then service_basis*(1+addon/100) else product_cost*(1+addon/100) end as pricing_base
    from base
  ), final as (
    select p.*, p.pricing_base*(1+p.markup/100) as sell,
      coalesce((select d.discount_percent from public.finance_catalog_customer_discounts d where d.customer_id=p_customer_id and d.item_id=p_item_id and d.active limit 1),0)::numeric as discount
    from priced p
  )
  select item_type, product_cost, service_basis, addon, acq, markup, sell, discount, sell*(1-discount/100)
  from final;
$$;

grant execute on function public.get_catalog_sales_price(uuid,uuid,numeric) to authenticated;

-- Keep the generic pricing function compatible while exposing service pricing correctly.
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
language sql stable security definer set search_path=public as $$
  select x.supplier_cost,x.category_addon_percent,x.acquisition_cost,x.item_markup_percent,x.srp,x.customer_discount_percent,x.customer_price
  from public.get_catalog_sales_price(p_item_id,p_customer_id,p_supplier_cost) x;
$$;

grant execute on function public.calculate_catalog_pricing(uuid,numeric,uuid) to authenticated;

-- Service recovery is reported separately from product acquisition recovery.
-- (The 2026-10-08 migration defined this view with a different column list;
-- CREATE OR REPLACE VIEW cannot rename/reorder existing columns, so drop and
-- recreate as with the inventory status view above.)
drop view if exists public.finance_catalog_pricing_recovery;
create view public.finance_catalog_pricing_recovery as
select
  date_trunc('month',q.quotation_date)::date as period_start,
  coalesce(i.category,'Uncategorized') as category,
  coalesce(i.item_type,'product') as item_type,
  sum(qi.quantity * case when i.item_type='service' then coalesce(i.service_cost_basis,0) else coalesce(qi.pricing_acquisition_cost,0) end) as cost_basis_value,
  sum(qi.quantity * greatest(coalesce(qi.pricing_srp,qi.unit_price,0)-case when i.item_type='service' then coalesce(i.service_cost_basis,0) * (1+coalesce(qi.pricing_category_addon_percent,0)/100) else coalesce(qi.pricing_acquisition_cost,0) end,0)) as gross_pricing_recovery,
  sum(qi.quantity * coalesce(qi.unit_price,0)) as quoted_value
from public.sales_quotations q
join public.sales_quotation_items qi on qi.quotation_id=q.id
left join public.finance_procurement_items i on i.id=qi.catalog_item_id
where q.status in ('approved','sent','accepted')
  and qi.catalog_item_id is not null
  and qi.pricing_snapshot_at is not null
group by 1,2,3;
