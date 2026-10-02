-- ============================================================================
-- Build 78 — quick price review (CAT-36; replaces CAT-19 / CAT-29, decided by
-- the owner 2026-10-02)
--
--   • For the Sales approver and Finance (and Business Admins / the Super
--     Admin acting as a store): one screen listing the store's items with
--     supplier cost, category add-on, acquisition cost, markup and store
--     price, filtered by category, brand and supplier.
--   • Edit an item's markup or its store price inline (the store price sets
--     the markup: markup = store price ÷ acquisition cost − 1), or a
--     category's add-on. Changes apply at once: no approval.
--   • Every change is logged with the old and new values, who and when
--     (catalog_price_changes), shown on the screen.
--   • Prices stay per store; the shared supplier cost is not edited here.
-- ============================================================================

create table if not exists public.catalog_price_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  kind text not null check (kind in ('item_markup', 'store_price', 'category_addon')),
  item_id uuid references public.finance_procurement_items(id),
  category_id uuid references public.finance_catalog_categories(id),
  old_percent numeric(14,8),
  new_percent numeric(14,8),
  old_store_price numeric(14,2),
  new_store_price numeric(14,2),
  items_affected int,
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_catalog_price_changes_business on public.catalog_price_changes (business_id, changed_at desc);
create index if not exists idx_catalog_price_changes_item on public.catalog_price_changes (item_id, changed_at desc);

create or replace function public.can_review_prices()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.is_active)
     and (public.can_approve_storefront() or public.has_section_access('finance')
          or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance'));
$$;

alter table public.catalog_price_changes enable row level security;
drop policy if exists catalog_price_changes_read on public.catalog_price_changes;
create policy catalog_price_changes_read on public.catalog_price_changes
  for select to authenticated using (public.business_row_visible(business_id) and public.can_review_prices());
revoke all on public.catalog_price_changes from public, anon, authenticated;
grant select on public.catalog_price_changes to authenticated;

-- the pricing history now records who made the change (it recorded the rule's creator)
create or replace function public.snapshot_catalog_item_pricing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and (new.markup_percent is distinct from old.markup_percent or new.active is distinct from old.active)) or tg_op = 'INSERT' then
    insert into public.finance_catalog_pricing_history(business_id, rule_type, rule_id, item_id, value_percent, effective_from, captured_by)
    values (new.business_id, 'item_markup', new.id, new.item_id, new.markup_percent, new.effective_from, coalesce(auth.uid(), new.created_by));
  end if;
  return new;
end $$;
create or replace function public.snapshot_catalog_category_pricing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and (new.addon_percent is distinct from old.addon_percent or new.active is distinct from old.active)) or tg_op = 'INSERT' then
    insert into public.finance_catalog_pricing_history(business_id, rule_type, rule_id, category_id, value_percent, effective_from, captured_by)
    values (new.business_id, 'category_addon', new.id, new.category_id, new.addon_percent, new.effective_from, coalesce(auth.uid(), new.created_by));
  end if;
  return new;
end $$;

create or replace function public.price_review_business()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if auth.uid() is null or not public.can_review_prices() then raise exception 'The price review is for the Sales approver, Finance and Business Admins.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return b;
end $$;

-- the list
create or replace function public.price_review_items(p_q text default null, p_category text default null, p_brand text default null, p_supplier uuid default null,
                                                     p_limit int default 50, p_offset int default 0)
returns table(item_id uuid, item_code text, item_name text, category text, category_id uuid, brand text, unit text, item_type text, supplier text,
              supplier_cost numeric, cost_age_days int, addon_percent numeric, acquisition_cost numeric, markup_percent numeric, store_price numeric,
              below_7 boolean, last_changed_at timestamptz, last_changed_by text, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.price_review_business(); esc text := '\';
        q text := nullif(btrim(coalesce(p_q, '')), ''); br text := nullif(btrim(coalesce(p_brand, '')), ''); ca text := nullif(btrim(coalesce(p_category, '')), '');
begin
  q  := replace(replace(replace(q,  esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  br := replace(replace(replace(br, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  return query
  with base as (
    select i.*, cat.id as cat_id, coalesce(cp.addon_percent, 0) as addon, coalesce(ip.markup_percent, 0) as markup,
           coalesce(case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end, 0)::numeric as cost
      from public.finance_procurement_items i
      left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
      left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = b
      left join public.finance_catalog_item_pricing ip on ip.item_id = i.id and ip.active and ip.business_id = b
     where i.active
       and (ca is null or lower(i.category) = lower(ca))
       and (br is null or i.brand ilike '%' || br || '%')
       and (p_supplier is null or i.default_supplier_id = p_supplier
            or exists (select 1 from public.finance_procurement_item_suppliers s where s.item_id = i.id and s.supplier_id = p_supplier and s.active))
       and (q is null or i.item_name ilike '%' || q || '%' or i.item_code ilike '%' || q || '%' or coalesce(i.generic_item, '') ilike '%' || q || '%'
            or coalesce(i.brand, '') ilike '%' || q || '%')
  )
  select x.id, x.item_code, x.item_name, x.category, x.cat_id, x.brand, x.unit, x.item_type, s.legal_name, x.cost,
         case when x.cost_updated_at is null then null else ((now() at time zone 'Asia/Manila')::date - (x.cost_updated_at at time zone 'Asia/Manila')::date)::int end,
         x.addon, round(x.cost * (1 + x.addon / 100), 2), round(x.markup, 4), round(x.cost * (1 + x.addon / 100) * (1 + x.markup / 100), 2),
         x.markup < 7, lc.changed_at, lc.who, count(*) over ()
    from base x
    left join public.finance_suppliers s on s.id = x.default_supplier_id
    left join lateral (select c.changed_at, u.full_name as who from public.catalog_price_changes c left join public.users u on u.id = c.changed_by
                        where c.business_id = b and c.item_id = x.id order by c.changed_at desc limit 1) lc on true
   order by x.item_name
   limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- category add-ons for the store (also categories without one)
create or replace function public.price_review_categories()
returns table(category_id uuid, name text, addon_percent numeric, items bigint)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.price_review_business();
begin
  return query
  select c.id, c.name, coalesce(cp.addon_percent, 0),
         (select count(*) from public.finance_procurement_items i where i.active and lower(trim(i.category)) = lower(trim(c.name)))
    from public.finance_catalog_categories c
    left join public.finance_catalog_category_pricing cp on cp.category_id = c.id and cp.business_id = b and cp.active
   where c.active order by c.name;
end $$;

-- suppliers that supply at least one active item (filter values)
create or replace function public.price_review_suppliers()
returns table(supplier_id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.price_review_business();
  return query
  select distinct s.id, s.legal_name from public.finance_suppliers s
   where exists (select 1 from public.finance_procurement_items i where i.active and i.default_supplier_id = s.id)
      or exists (select 1 from public.finance_procurement_item_suppliers x join public.finance_procurement_items i on i.id = x.item_id and i.active
                  where x.supplier_id = s.id and x.active)
   order by s.legal_name;
end $$;

-- edit one item: markup OR store price
create or replace function public.price_review_set_item(p_item uuid, p_markup numeric default null, p_store_price numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.price_review_business(); pr record; v_old_markup numeric; v_new numeric; v_new_price numeric; v_kind text;
begin
  if (p_markup is null) = (p_store_price is null) then raise exception 'Enter either the markup or the store price.'; end if;
  select * into pr from public.storefront_item_price(p_item, b);
  if not found then raise exception 'Item not found or not active.'; end if;
  select markup_percent into v_old_markup from public.finance_catalog_item_pricing where business_id = b and item_id = p_item and active;
  if p_store_price is not null then
    v_kind := 'store_price';
    if coalesce(pr.acquisition_cost, 0) <= 0 then raise exception '% has no supplier cost yet, so its store price cannot be set from a markup. Set the supplier cost first.', pr.item_name; end if;
    if p_store_price < round(pr.acquisition_cost, 2) then
      raise exception 'The store price of % cannot be below its acquisition cost of ₱%.', pr.item_name, round(pr.acquisition_cost, 2);
    end if;
    v_new := round((p_store_price / pr.acquisition_cost - 1) * 100, 8);
  else
    v_kind := 'item_markup';
    v_new := round(p_markup, 8);
  end if;
  if v_new < 0 or v_new > 1000 then raise exception 'The markup must be between 0%% and 1000%%.'; end if;
  insert into public.finance_catalog_item_pricing(business_id, item_id, markup_percent, active, effective_from, created_by)
  values (b, p_item, v_new, true, (now() at time zone 'Asia/Manila')::date, auth.uid())
  on conflict (business_id, item_id) do update set markup_percent = excluded.markup_percent, active = true, effective_from = excluded.effective_from, updated_at = now();
  v_new_price := round(coalesce(pr.acquisition_cost, 0) * (1 + v_new / 100), 2);
  insert into public.catalog_price_changes(business_id, kind, item_id, old_percent, new_percent, old_store_price, new_store_price, changed_by)
  values (b, v_kind, p_item, coalesce(v_old_markup, 0), v_new, pr.list_price, v_new_price, auth.uid());
  return jsonb_build_object('item_id', p_item, 'markup_percent', round(v_new, 4), 'store_price', v_new_price, 'old_store_price', pr.list_price);
end $$;

-- edit one category add-on (changes the acquisition cost and store price of every item in it)
create or replace function public.price_review_set_addon(p_category uuid, p_addon numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.price_review_business(); c record; v_old numeric; v_n int;
begin
  if p_addon is null or p_addon < 0 or p_addon > 1000 then raise exception 'The add-on must be between 0%% and 1000%%.'; end if;
  select * into c from public.finance_catalog_categories where id = p_category and active;
  if not found then raise exception 'Category not found.'; end if;
  select addon_percent into v_old from public.finance_catalog_category_pricing where business_id = b and category_id = p_category and active;
  insert into public.finance_catalog_category_pricing(business_id, category_id, addon_percent, active, effective_from, created_by)
  values (b, p_category, round(p_addon, 4), true, (now() at time zone 'Asia/Manila')::date, auth.uid())
  on conflict (business_id, category_id) do update set addon_percent = excluded.addon_percent, active = true, effective_from = excluded.effective_from, updated_at = now();
  select count(*) into v_n from public.finance_procurement_items i where i.active and lower(trim(i.category)) = lower(trim(c.name));
  insert into public.catalog_price_changes(business_id, kind, category_id, old_percent, new_percent, items_affected, changed_by)
  values (b, 'category_addon', p_category, coalesce(v_old, 0), round(p_addon, 4), v_n, auth.uid());
  return jsonb_build_object('category', c.name, 'addon_percent', round(p_addon, 4), 'old_addon_percent', coalesce(v_old, 0), 'items_affected', v_n);
end $$;

-- the change log
create or replace function public.price_review_changes(p_limit int default 100, p_item uuid default null)
returns table(id uuid, changed_at timestamptz, changed_by text, kind text, item_code text, item_name text, category text,
              old_percent numeric, new_percent numeric, old_store_price numeric, new_store_price numeric, items_affected int)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.price_review_business();
begin
  return query
  select c.id, c.changed_at, u.full_name, c.kind, i.item_code, i.item_name, coalesce(cat.name, i.category),
         c.old_percent, c.new_percent, c.old_store_price, c.new_store_price, c.items_affected
    from public.catalog_price_changes c
    left join public.users u on u.id = c.changed_by
    left join public.finance_procurement_items i on i.id = c.item_id
    left join public.finance_catalog_categories cat on cat.id = c.category_id
   where c.business_id = b and (p_item is null or c.item_id = p_item)
   order by c.changed_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

revoke all on function public.price_review_business() from public, anon, authenticated;
grant execute on function public.can_review_prices() to authenticated;
grant execute on function public.price_review_items(text, text, text, uuid, int, int) to authenticated;
grant execute on function public.price_review_categories() to authenticated;
grant execute on function public.price_review_suppliers() to authenticated;
grant execute on function public.price_review_set_item(uuid, numeric, numeric) to authenticated;
grant execute on function public.price_review_set_addon(uuid, numeric) to authenticated;
grant execute on function public.price_review_changes(int, uuid) to authenticated;
