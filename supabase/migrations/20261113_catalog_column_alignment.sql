-- ============================================================================
-- Build 60 — catalog aligned to the user's column layout (2026-09-27):
--   STANDARD ITEM NAME | CATEGORY | ITEM | BRAND | DESCRIPTION | Product Photo |
--   SUPPLIER | SUPPLIER ITEM CODE | Supplier Cost | Add on | Acquisition Cost |
--   STORE PRICE | %Mark up
--
-- Mapping:
--   STANDARD ITEM NAME  finance_procurement_items.item_name (full name,
--                       e.g. "AC FILTER DRIER, GENESSO 1/2 FLARE TYPE 164FT")
--   ITEM                NEW generic_item (e.g. "AC FILTER DRIER")
--   BRAND               NEW brand
--   Product Photo       NEW photo_path (private storage bucket catalog-photos)
--   SUPPLIER            default_supplier_id
--   SUPPLIER ITEM CODE  finance_procurement_item_suppliers.supplier_item_code
--                       for the item's default supplier
--   Supplier Cost       standard_cost (services: service_cost_basis) — shared
--   Add on              category add-on % for the viewer's business, shown
--                       as the peso amount it adds (rule unchanged)
--   Acquisition Cost    Supplier Cost + Add on (products only)
--   STORE PRICE         Acquisition Cost x (1 + %Mark up)
--   %Mark up            item markup % for the viewer's business (entered)
--
-- Also fixes per-business pricing keys: category add-on and item markup were
-- UNIQUE on category_id / item_id alone (and business_id defaulted to
-- Ishabella), so only ONE business could ever hold a markup or add-on and
-- another business's save failed or landed under Ishabella. Now unique per
-- (business_id, item_id) / (business_id, category_id).
-- ============================================================================

alter table public.finance_procurement_items
  add column if not exists generic_item text,
  add column if not exists brand text,
  add column if not exists photo_path text;

create index if not exists finance_procurement_items_generic_item_idx
  on public.finance_procurement_items (lower(generic_item));
create index if not exists finance_procurement_items_brand_idx
  on public.finance_procurement_items (lower(brand));

-- per-business pricing keys
alter table public.finance_catalog_item_pricing drop constraint if exists finance_catalog_item_pricing_item_id_key;
alter table public.finance_catalog_category_pricing drop constraint if exists finance_catalog_category_pricing_category_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'finance_catalog_item_pricing_business_item_key') then
    alter table public.finance_catalog_item_pricing
      add constraint finance_catalog_item_pricing_business_item_key unique (business_id, item_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'finance_catalog_category_pricing_business_category_key') then
    alter table public.finance_catalog_category_pricing
      add constraint finance_catalog_category_pricing_business_category_key unique (business_id, category_id);
  end if;
end $$;

-- product photos (private; the app serves short-lived signed links)
insert into storage.buckets (id, name, public)
values ('catalog-photos', 'catalog-photos', false)
on conflict (id) do nothing;

-- The business whose add-on / markup apply to the viewer: own business, or
-- the Super Admin's "Acting as" business (null = all businesses -> no price).
create or replace function public.pricing_business_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(public.current_business_id(), public.super_admin_view_business());
$$;
grant execute on function public.pricing_business_id() to authenticated;

-- One row per catalog item in the user's column layout. security_invoker:
-- the caller's RLS applies to every table read.
drop view if exists public.finance_catalog_price_list;

-- Build 60a: a markup derived from a hand-set STORE PRICE (import, or typing
-- the price in the form) needs more than 4 decimals to reproduce that price
-- to the centavo; numeric(7,4) also capped markups below 1000%.
alter table public.finance_catalog_item_pricing alter column markup_percent type numeric(14,8);
create view public.finance_catalog_price_list with (security_invoker = true) as
with b as (select public.pricing_business_id() as id)
select
  i.*,
  s.supplier_code                                   as supplier_code,
  s.legal_name                                      as supplier_name,
  isup.supplier_item_code                           as supplier_item_code,
  case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end as supplier_cost,
  (select id from b)                                as pricing_business_id,
  cp.addon_percent                                  as addon_percent,
  round(case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end
        * coalesce(cp.addon_percent, 0) / 100, 2)   as addon_amount,
  case when i.item_type = 'service' then null
       else round(i.standard_cost * (1 + coalesce(cp.addon_percent, 0) / 100), 2) end as acquisition_cost,
  ip.markup_percent                                 as markup_percent,
  case when (select id from b) is null then null
       else round(case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end
                  * (1 + coalesce(cp.addon_percent, 0) / 100)
                  * (1 + coalesce(ip.markup_percent, 0) / 100), 2) end as store_price
from public.finance_procurement_items i
left join public.finance_suppliers s on s.id = i.default_supplier_id
left join public.finance_procurement_item_suppliers isup
       on isup.item_id = i.id and isup.supplier_id = i.default_supplier_id
left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
left join public.finance_catalog_category_pricing cp
       on cp.category_id = cat.id and cp.active and cp.business_id = (select id from b)
left join public.finance_catalog_item_pricing ip
       on ip.item_id = i.id and ip.active and ip.business_id = (select id from b);

grant select on public.finance_catalog_price_list to authenticated;

-- Sales price lookup uses the same pricing business (own business, or the
-- Super Admin's "Acting as" business), falling back to the customer's business.
create or replace function public.get_catalog_sales_price(p_item_id uuid, p_customer_id uuid default null, p_supplier_cost numeric default null)
returns table(item_type text, supplier_cost numeric, service_cost_basis numeric, category_addon_percent numeric, acquisition_cost numeric, item_markup_percent numeric, srp numeric, customer_discount_percent numeric, customer_price numeric)
language sql stable security definer set search_path to 'public' as $function$
  with biz as (
    select coalesce(public.pricing_business_id(),
                    (select fc.business_id from public.finance_customers fc where fc.id = p_customer_id)) as id
  ), base as (
    select i.item_type,
           case when i.item_type='service' then 0::numeric else coalesce(p_supplier_cost,i.standard_cost,0)::numeric end as product_cost,
           case when i.item_type='service' then coalesce(i.service_cost_basis,0)::numeric else 0::numeric end as service_basis,
           coalesce((select cp.addon_percent from public.finance_catalog_category_pricing cp
                      join public.finance_catalog_categories c on c.id=cp.category_id
                     where lower(trim(c.name))=lower(trim(i.category)) and cp.active
                       and cp.business_id = (select id from biz) limit 1),0)::numeric as addon,
           coalesce((select ip.markup_percent from public.finance_catalog_item_pricing ip
                     where ip.item_id=i.id and ip.active and ip.business_id = (select id from biz) limit 1),0)::numeric as markup
    from public.finance_procurement_items i
    where i.id=p_item_id
  ), priced as (
    select *,
      case when item_type='service' then null::numeric else product_cost*(1+addon/100) end as acq,
      case when item_type='service' then service_basis*(1+addon/100) else product_cost*(1+addon/100) end as pricing_base
    from base
  ), final as (
    select p.*, p.pricing_base*(1+p.markup/100) as sell,
      coalesce((select d.discount_percent from public.finance_catalog_customer_discounts d
                 where d.customer_id=p_customer_id and d.item_id=p_item_id and d.active
                   and d.business_id = (select id from biz) limit 1),0)::numeric as discount
    from priced p
  )
  select item_type, product_cost, service_basis, addon, acq, markup, sell, discount, sell*(1-discount/100)
  from final;
$function$;

-- SUPPLIER ITEM CODE is a catalog column: readable by everyone who can read
-- the shared catalog (Finance, Sales, Logistics, admins), and maintainable by
-- Business Admins as well as Finance (it was Finance / Super Admin only, so a
-- Business Admin saw a blank code and could not save one).
drop policy if exists finance_procurement_item_suppliers_shared_read on public.finance_procurement_item_suppliers;
create policy finance_procurement_item_suppliers_shared_read on public.finance_procurement_item_suppliers
  for select using (public.can_read_shared_catalog());
drop policy if exists finance_procurement_item_suppliers_business_admin on public.finance_procurement_item_suppliers;
create policy finance_procurement_item_suppliers_business_admin on public.finance_procurement_item_suppliers
  for all using (public.is_business_admin()) with check (public.is_business_admin());

-- Add-on % and markup % of the reader's OWN business (the restrictive
-- business-isolation policy still applies) are readable by every catalog
-- reader, so STORE PRICE in the catalog is the real price for them too
-- (Sales could previously read cost but not the pricing rules, so a direct
-- read of the price list showed cost as the store price). Writes stay
-- Finance / Business Admin / Super Admin.
drop policy if exists finance_catalog_item_pricing_catalog_read on public.finance_catalog_item_pricing;
create policy finance_catalog_item_pricing_catalog_read on public.finance_catalog_item_pricing
  for select using (public.can_read_shared_catalog());
drop policy if exists finance_catalog_category_pricing_catalog_read on public.finance_catalog_category_pricing;
create policy finance_catalog_category_pricing_catalog_read on public.finance_catalog_category_pricing
  for select using (public.can_read_shared_catalog());
