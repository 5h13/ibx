-- Build 27: historical pricing snapshots, sales quotation pricing integration,
-- and finance-facing pricing recovery visibility.

alter table public.sales_quotation_items
  add column if not exists catalog_item_id uuid references public.finance_procurement_items(id) on delete restrict,
  add column if not exists pricing_supplier_cost numeric(14,2),
  add column if not exists pricing_category_addon_percent numeric(7,4),
  add column if not exists pricing_acquisition_cost numeric(14,2),
  add column if not exists pricing_item_markup_percent numeric(7,4),
  add column if not exists pricing_srp numeric(14,2),
  add column if not exists pricing_customer_discount_percent numeric(7,4),
  add column if not exists pricing_snapshot_at timestamptz;

alter table public.sales_order_items
  add column if not exists catalog_item_id uuid references public.finance_procurement_items(id) on delete restrict;

create index if not exists idx_sales_quote_items_catalog on public.sales_quotation_items(catalog_item_id);
create index if not exists idx_sales_order_items_catalog on public.sales_order_items(catalog_item_id);

create table if not exists public.finance_catalog_pricing_history (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check(rule_type in ('category_addon','item_markup','customer_discount')),
  rule_id uuid not null,
  category_id uuid references public.finance_catalog_categories(id),
  item_id uuid references public.finance_procurement_items(id),
  customer_id uuid references public.finance_customers(id),
  value_percent numeric(7,4) not null,
  effective_from date not null,
  captured_at timestamptz not null default now(),
  captured_by uuid references public.users(id)
);
create index if not exists idx_catalog_pricing_history_rule on public.finance_catalog_pricing_history(rule_type,rule_id,captured_at desc);
create index if not exists idx_catalog_pricing_history_period on public.finance_catalog_pricing_history(effective_from);

create or replace function public.snapshot_catalog_category_pricing()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and (new.addon_percent is distinct from old.addon_percent or new.active is distinct from old.active) then
    insert into public.finance_catalog_pricing_history(rule_type,rule_id,category_id,value_percent,effective_from,captured_by)
    values('category_addon',new.id,new.category_id,new.addon_percent,new.effective_from,new.created_by);
  elsif tg_op='INSERT' then
    insert into public.finance_catalog_pricing_history(rule_type,rule_id,category_id,value_percent,effective_from,captured_by)
    values('category_addon',new.id,new.category_id,new.addon_percent,new.effective_from,new.created_by);
  end if;
  return new;
end; $$;

drop trigger if exists trg_catalog_category_pricing_history on public.finance_catalog_category_pricing;
create trigger trg_catalog_category_pricing_history after insert or update on public.finance_catalog_category_pricing
for each row execute function public.snapshot_catalog_category_pricing();

create or replace function public.snapshot_catalog_item_pricing()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and (new.markup_percent is distinct from old.markup_percent or new.active is distinct from old.active) then
    insert into public.finance_catalog_pricing_history(rule_type,rule_id,item_id,value_percent,effective_from,captured_by)
    values('item_markup',new.id,new.item_id,new.markup_percent,new.effective_from,new.created_by);
  elsif tg_op='INSERT' then
    insert into public.finance_catalog_pricing_history(rule_type,rule_id,item_id,value_percent,effective_from,captured_by)
    values('item_markup',new.id,new.item_id,new.markup_percent,new.effective_from,new.created_by);
  end if;
  return new;
end; $$;

drop trigger if exists trg_catalog_item_pricing_history on public.finance_catalog_item_pricing;
create trigger trg_catalog_item_pricing_history after insert or update on public.finance_catalog_item_pricing
for each row execute function public.snapshot_catalog_item_pricing();

create or replace function public.snapshot_catalog_customer_discount()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and (new.discount_percent is distinct from old.discount_percent or new.active is distinct from old.active) then
    insert into public.finance_catalog_pricing_history(rule_type,rule_id,item_id,customer_id,value_percent,effective_from,captured_by)
    values('customer_discount',new.id,new.item_id,new.customer_id,new.discount_percent,new.effective_from,new.created_by);
  elsif tg_op='INSERT' then
    insert into public.finance_catalog_pricing_history(rule_type,rule_id,item_id,customer_id,value_percent,effective_from,captured_by)
    values('customer_discount',new.id,new.item_id,new.customer_id,new.discount_percent,new.effective_from,new.created_by);
  end if;
  return new;
end; $$;

drop trigger if exists trg_catalog_customer_discount_history on public.finance_catalog_customer_discounts;
create trigger trg_catalog_customer_discount_history after insert or update on public.finance_catalog_customer_discounts
for each row execute function public.snapshot_catalog_customer_discount();

alter table public.finance_catalog_pricing_history enable row level security;
drop policy if exists "catalog pricing history finance access" on public.finance_catalog_pricing_history;
create policy "catalog pricing history finance access" on public.finance_catalog_pricing_history
for select using (public.is_super_admin() or public.has_section_access('finance') or public.has_section_access('sales'));

-- Authoritative server-side pricing result used by Sales and Finance integrations.
create or replace function public.get_catalog_sales_price(
  p_item_id uuid,
  p_customer_id uuid default null,
  p_supplier_cost numeric default null
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
  select * from public.calculate_catalog_pricing(p_item_id,p_supplier_cost,p_customer_id);
$$;
grant execute on function public.get_catalog_sales_price(uuid,uuid,numeric) to authenticated;

create or replace view public.finance_catalog_pricing_recovery as
select
  date_trunc('month',q.quotation_date)::date as period_start,
  coalesce(i.category,'Uncategorized') as category,
  sum(qi.quantity * coalesce(qi.pricing_acquisition_cost,0)) as acquisition_value,
  sum(qi.quantity * greatest(coalesce(qi.pricing_srp,qi.unit_price,0)-coalesce(qi.pricing_acquisition_cost,0),0)) as gross_pricing_recovery,
  sum(qi.quantity * coalesce(qi.unit_price,0)) as quoted_value
from public.sales_quotations q
join public.sales_quotation_items qi on qi.quotation_id=q.id
left join public.finance_procurement_items i on i.id=qi.catalog_item_id
where q.status in ('approved','sent','accepted')
  and qi.catalog_item_id is not null
  and qi.pricing_snapshot_at is not null
group by 1,2;
