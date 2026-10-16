-- Build 115 — quotation prices (UIA-18 / 19 / 20 / 21).
--
-- UIA-20  quote_price_lines(): the quotation form and its preview take each line's price from the
--         same pricing engine the save uses (store, customer discount, cost basis), so what is shown
--         is what is saved.
-- UIA-19  A quotation line's unit price may be typed. At or above the floor (7% over acquisition
--         cost, never above the store price — the counter's rule, SF-14) it is accepted; below it the
--         line is flagged and the quotation can only be approved by a Sales approver, Business Admin
--         or Super Admin. An item with no cost on record: any price below the store price is flagged.
--         Under an operating mode that auto-approves quotations, the flagged quotation is approved
--         with a warning written to its record (MODE-01: warn, no second person).
-- UIA-18  Quotation quantities are whole numbers.
-- UIA-21  item_price_history(): store price / SRP changes, cost changes, purchase prices per
--         supplier and this customer's past quoted and sold prices, for Sales (preparers included),
--         Finance and admins.

-- ------------------------------------------------------------------ columns --
alter table public.sales_quotation_items
  add column if not exists engine_unit_price numeric(14,2),
  add column if not exists floor_price numeric(14,2),
  add column if not exists price_overridden boolean not null default false,
  add column if not exists below_floor boolean not null default false;

-- whole-number quantities on new and changed quotation lines (existing rows untouched)
create or replace function public.guard_quote_line_qty()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' or new.quantity is distinct from old.quantity) and new.quantity <> trunc(new.quantity) then
    raise exception 'Quotation quantities must be whole numbers (% is not).', new.quantity;
  end if;
  return new;
end $$;
drop trigger if exists sales_quotation_items_whole_qty on public.sales_quotation_items;
create trigger sales_quotation_items_whole_qty before insert or update of quantity on public.sales_quotation_items
  for each row execute function public.guard_quote_line_qty();

-- ------------------------------------------------------------- engine prices --
create or replace function public.quote_price_lines(p_customer uuid, p_items uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id, 'item_type', pr.item_type,
           'srp', round(coalesce(pr.srp, 0), 2), 'price', round(coalesce(pr.customer_price, 0), 2),
           'customer_discount_percent', coalesce(pr.customer_discount_percent, 0),
           'acquisition_cost', round(coalesce(pr.acquisition_cost, 0), 2),
           'no_cost', coalesce(pr.item_type <> 'service' and coalesce(pr.supplier_cost, 0) <= 0, false),
           'floor', round(least(coalesce(pr.srp, 0), coalesce(pr.acquisition_cost, 0) * 1.07), 2))), '[]'::jsonb)
    from unnest(p_items) as u(id)
    join public.finance_procurement_items i on i.id = u.id
    cross join lateral public.get_catalog_sales_price(i.id, p_customer, null) pr
$$;
grant execute on function public.quote_price_lines(uuid, uuid[]) to authenticated;

-- ------------------------------------------- approval of a below-floor quote --
create or replace function public.guard_quote_below_floor()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.status::text = 'approved' and old.status::text is distinct from 'approved' then
    select count(*) into n from public.sales_quotation_items where quotation_id = new.id and below_floor;
    if n > 0 then
      if coalesce(current_setting('ibx.workflow_auto', true), '') = 'on' then
        insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
        values (coalesce(auth.uid(), new.prepared_by), 'sales_quotations', new.id, 'price_exception_warned',
                jsonb_build_object('lines_below_floor', n, 'note', 'Approved by the operating mode with ' || n || ' line(s) below the 7% floor; no second person checked the price.'));
      elsif auth.uid() is not null and not public.can_approve_storefront() then
        raise exception 'This quotation has % line(s) priced below the floor (7%% over acquisition cost); only a Sales approver or Business Admin can approve it.', n;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sales_quotations_below_floor on public.sales_quotations;
create trigger sales_quotations_below_floor before update of status on public.sales_quotations
  for each row execute function public.guard_quote_below_floor();
revoke all on function public.guard_quote_below_floor() from public, authenticated;

-- ------------------------------------------------------------ price history --
create or replace function public.item_price_history(p_item uuid, p_customer uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.pricing_business_id();
  v_cat uuid;
  v_item record;
begin
  if not (public.is_super_admin() or public.is_business_admin()
          or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                      where ua.user_id = auth.uid() and s.code in ('sales', 'finance'))
          or exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('sales', 'finance'))) then
    raise exception 'Sales or Finance access is required to see price history.';
  end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select i.id, i.item_code, i.item_name, i.category, i.standard_cost into v_item from public.finance_procurement_items i where i.id = p_item;
  if not found then raise exception 'Item not found.'; end if;
  select c.id into v_cat from public.finance_catalog_categories c where lower(trim(c.name)) = lower(trim(v_item.category)) limit 1;

  return jsonb_build_object(
    'item', jsonb_build_object('id', v_item.id, 'code', v_item.item_code, 'name', v_item.item_name),
    'current', (select to_jsonb(pr) from public.get_catalog_sales_price(p_item, p_customer, null) pr limit 1),
    -- (1) store price / SRP: every change of cost, category add-on or item markup for this store,
    --     with the SRP it gave (cost × (1 + add-on) × (1 + markup), each as of that moment)
    'srp_changes', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.at, 'what', e.what, 'srp',
               round(coalesce(ec.cost, v_item.standard_cost, 0) * (1 + coalesce(ea.pct, 0) / 100) * (1 + coalesce(em.pct, 0) / 100), 2),
               'cost', ec.cost, 'addon_percent', ea.pct, 'markup_percent', em.pct,
               'by', (select full_name from public.users u where u.id = e.by)) order by e.at desc)
        from (
          select h.set_at as at, 'cost ' || coalesce(h.previous_cost::text, '—') || ' → ' || h.new_cost as what, h.set_by as by
            from public.finance_item_cost_history h where h.item_id = p_item
          union all
          select ph.captured_at, case ph.rule_type when 'item_markup' then 'markup → ' else 'category add-on → ' end || ph.value_percent || '%', ph.captured_by
            from public.finance_catalog_pricing_history ph
           where ph.business_id = b and ph.customer_id is null
             and ((ph.rule_type = 'item_markup' and ph.item_id = p_item) or (ph.rule_type = 'category_addon' and ph.category_id = v_cat))
        ) e
        left join lateral (select h.new_cost as cost from public.finance_item_cost_history h where h.item_id = p_item and h.set_at <= e.at order by h.set_at desc limit 1) ec on true
        left join lateral (select ph.value_percent as pct from public.finance_catalog_pricing_history ph where ph.business_id = b and ph.rule_type = 'category_addon'
                             and ph.category_id = v_cat and ph.captured_at <= e.at order by ph.captured_at desc limit 1) ea on true
        left join lateral (select ph.value_percent as pct from public.finance_catalog_pricing_history ph where ph.business_id = b and ph.rule_type = 'item_markup'
                             and ph.item_id = p_item and ph.customer_id is null and ph.captured_at <= e.at order by ph.captured_at desc limit 1) em on true), '[]'::jsonb),
    -- (2) cost changes
    'cost_changes', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.set_at, 'previous', h.previous_cost, 'cost', h.new_cost, 'source', h.source, 'note', h.note,
               'supplier', (select legal_name from public.finance_suppliers s where s.id = h.supplier_id),
               'by', (select full_name from public.users u where u.id = h.set_by)) order by h.set_at desc)
        from public.finance_item_cost_history h where h.item_id = p_item), '[]'::jsonb),
    -- (3) purchase prices per supplier, every purchase (this store)
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('date', ph.purchase_date, 'supplier', s.legal_name, 'supplier_item_code', ph.supplier_item_code,
               'po_number', po.po_number, 'quantity', ph.quantity, 'unit', ph.unit, 'po_price', ph.po_unit_price, 'invoice_price', ph.invoice_unit_price,
               'price', ph.effective_unit_price, 'source', ph.price_source) order by ph.purchase_date desc, ph.created_at desc)
        from public.finance_item_supplier_price_history ph
        left join public.finance_suppliers s on s.id = ph.supplier_id
        left join public.purchase_orders po on po.id = ph.purchase_order_id
       where ph.item_id = p_item and ph.business_id = b), '[]'::jsonb),
    -- (4) this customer's past prices: quoted and sold (counter sales and order DRs)
    'customer', case when p_customer is null then '[]'::jsonb else coalesce((
      select jsonb_agg(x order by x->>'date' desc) from (
        select jsonb_build_object('date', q.quotation_date, 'kind', 'quoted', 'document', q.quotation_number, 'status', q.status::text,
                                  'quantity', qi.quantity, 'price', qi.unit_price) as x
          from public.sales_quotation_items qi join public.sales_quotations q on q.id = qi.quotation_id
         where q.business_id = b and q.customer_id = p_customer and qi.catalog_item_id = p_item and q.status::text not in ('cancelled')
        union all
        select jsonb_build_object('date', s.sale_date, 'kind', 'sold', 'document', coalesce(s.dr_number, s.sale_number), 'status', s.status,
                                  'quantity', si.quantity, 'price', si.unit_price)
          from public.storefront_sale_items si join public.storefront_sales s on s.id = si.sale_id
         where s.business_id = b and s.customer_id = p_customer and si.item_id = p_item and s.status = 'completed'
        ) t), '[]'::jsonb) end
  );
end $$;
grant execute on function public.item_price_history(uuid, uuid) to authenticated;
