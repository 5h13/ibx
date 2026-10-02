-- ============================================================================
-- Build 77 — Quote chain, stage 2 (punchlist DOC-01, DOC-03 incl. the
-- chosen-supplier part of DOC-07, DOC-08, DOC-13, CAT-13).
-- Decisions by the user (2026-09-27/28):
--   DOC-01  Sales sees the stock on hand per catalog line while quoting —
--           quantities only, never cost.
--   DOC-03  On a draft quote Sales marks lines "Ask Procurement for supplier
--           price" (awaiting-price flag, Procurement notified; no separate
--           request document). Procurement records only the decision: chosen
--           supplier, supplier price, validity, lead time and terms; Sales is
--           notified back; the line is re-priced from that cost with the
--           unchanged pricing formula; the chosen supplier carries into the
--           PR line when the order is approved (DOC-07). Optionally the price
--           is logged in the supplier quote log and set as current cost
--           (DOC-14 mechanism).
--   DOC-08  Finance pays against a PO: full prepayment and deposits/partial
--           payments; a PO carries several payments; paid and remaining
--           balance shown; payments made against the PO count toward the
--           supplier invoice when it is registered (approved) in AP.
--   DOC-13  The order chain shows Quote → SO → PR → PO → supplier receipt →
--           AP invoice → supplier payment, and the DR / SI / AR status.
--   CAT-13  Quote lines resolve to a catalog item. The "not in catalog"
--           escape needs a reason (enforced by the app) and is flagged; such a
--           line can never be ordered from a supplier (enforced here).
-- ============================================================================

-- ---------------------------------------------------------------- columns --
alter table public.sales_quotation_items
  add column if not exists custom_reason text,
  add column if not exists price_request_status text,
  add column if not exists price_request_note text,
  add column if not exists price_requested_by uuid references public.users(id),
  add column if not exists price_requested_at timestamptz,
  add column if not exists chosen_supplier_id uuid references public.finance_suppliers(id),
  add column if not exists supplier_unit_price numeric(14,2),
  add column if not exists supplier_validity text,
  add column if not exists supplier_lead_time text,
  add column if not exists supplier_terms text,
  add column if not exists supplier_quote_log_id uuid references public.finance_supplier_quote_log(id) on delete set null,
  add column if not exists price_answered_by uuid references public.users(id),
  add column if not exists price_answered_at timestamptz;
alter table public.sales_quotation_items drop constraint if exists sales_quotation_items_price_request_status_check;
alter table public.sales_quotation_items add constraint sales_quotation_items_price_request_status_check
  check (price_request_status is null or price_request_status in ('awaiting','answered'));
create index if not exists idx_quote_items_price_requests on public.sales_quotation_items (business_id, price_request_status) where price_request_status is not null;

alter table public.purchase_requisition_items
  add column if not exists preferred_supplier_id uuid references public.finance_suppliers(id),
  add column if not exists supplier_quoted_price numeric(14,2);

alter table public.finance_supplier_payments alter column invoice_id drop not null;
alter table public.finance_supplier_payments
  add column if not exists purchase_order_id uuid references public.purchase_orders(id),
  add column if not exists po_payment_kind text;
alter table public.finance_supplier_payments drop constraint if exists finance_supplier_payments_target_check;
alter table public.finance_supplier_payments add constraint finance_supplier_payments_target_check
  check ((invoice_id is not null and purchase_order_id is null) or (invoice_id is null and purchase_order_id is not null));
alter table public.finance_supplier_payments drop constraint if exists finance_supplier_payments_po_kind_check;
alter table public.finance_supplier_payments add constraint finance_supplier_payments_po_kind_check
  check (po_payment_kind is null or (purchase_order_id is not null and po_payment_kind in ('full_prepayment','deposit','partial')));
create index if not exists idx_ap_payment_po on public.finance_supplier_payments(purchase_order_id) where purchase_order_id is not null;

-- How much of a payment made against a PO went to which supplier invoice.
create table if not exists public.finance_supplier_payment_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  payment_id uuid not null references public.finance_supplier_payments(id) on delete cascade,
  invoice_id uuid not null references public.finance_supplier_invoices(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  applied_at timestamptz not null default now()
);
create index if not exists idx_ap_payment_app_payment on public.finance_supplier_payment_applications(payment_id);
create index if not exists idx_ap_payment_app_invoice on public.finance_supplier_payment_applications(invoice_id);
alter table public.finance_supplier_payment_applications enable row level security;
drop policy if exists ap_payment_applications_view on public.finance_supplier_payment_applications;
create policy ap_payment_applications_view on public.finance_supplier_payment_applications for select using (
  (public.is_super_admin() and (public.super_admin_view_business() is null or business_id = public.super_admin_view_business()))
  or (business_id = public.current_business_id()
      and (public.is_business_admin()
           or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'finance')
           or public.has_section_access('finance'))));
revoke all on public.finance_supplier_payment_applications from authenticated;
grant select on public.finance_supplier_payment_applications to authenticated;   -- written only by the functions below

-- ---------------------------------------------------------------- helpers --
create or replace function public.can_use_ap()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.is_active)
     and (public.is_super_admin() or public.is_business_admin()
          or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance')
          or public.has_section_access('finance'));
$$;
revoke all on function public.can_use_ap() from public;
grant execute on function public.can_use_ap() to authenticated;

-- Stock of a catalog item in a business: at the Storefront's stock location
-- and across all its locations. Quantities only.
create or replace function public.q77_on_hand(p_business uuid, p_item uuid, p_location uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(bal.on_hand), 0) from public.logistics_inventory_items inv
    join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id
   where inv.business_id = p_business and inv.procurement_item_id = p_item
     and (p_location is null or bal.location_id = p_location);
$$;
revoke all on function public.q77_on_hand(uuid, uuid, uuid) from public, authenticated;

-- ================================================ DOC-01: stock on the quote --
-- For the quotation form: on hand per catalog item, at the store and in all
-- locations of the caller's business. No cost or price columns.
create or replace function public.sales_quote_stock(p_items uuid[])
returns table(item_id uuid, item_type text, on_hand_store numeric, on_hand_business numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); loc uuid;
begin
  select location_id into loc from public.storefront_settings where business_id = b;
  return query
  select i.id, coalesce(i.item_type, 'product'),
         case when coalesce(i.item_type, 'product') = 'service' or loc is null then null else public.q77_on_hand(b, i.id, loc) end,
         case when coalesce(i.item_type, 'product') = 'service' then null else public.q77_on_hand(b, i.id, null) end
    from public.finance_procurement_items i
   where i.id = any(coalesce(p_items, '{}'::uuid[]));
end $$;

-- Line status of a quotation for Sales: stock on hand plus the supplier price
-- request / decision (DOC-03) and the CAT-13 flag.
create or replace function public.sales_quote_line_status(p_quote uuid)
returns table(quotation_item_id uuid, catalog_item_id uuid, item_type text, on_hand_store numeric, on_hand_business numeric,
              not_in_catalog boolean, custom_reason text, price_request_status text, price_request_note text, price_requested_at timestamptz,
              chosen_supplier text, supplier_unit_price numeric, supplier_validity text, supplier_lead_time text, supplier_terms text,
              price_answered_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); loc uuid;
begin
  if not exists (select 1 from public.sales_quotations where id = p_quote and business_id = b) then raise exception 'Quotation not found in this business.'; end if;
  select location_id into loc from public.storefront_settings where business_id = b;
  return query
  select qi.id, qi.catalog_item_id,
         case when qi.catalog_item_id is null then 'custom' else coalesce(i.item_type, 'product') end,
         case when qi.catalog_item_id is null or coalesce(i.item_type, 'product') = 'service' or loc is null then null else public.q77_on_hand(b, qi.catalog_item_id, loc) end,
         case when qi.catalog_item_id is null or coalesce(i.item_type, 'product') = 'service' then null else public.q77_on_hand(b, qi.catalog_item_id, null) end,
         qi.catalog_item_id is null, qi.custom_reason, qi.price_request_status, qi.price_request_note, qi.price_requested_at,
         s.legal_name, qi.supplier_unit_price, qi.supplier_validity, qi.supplier_lead_time, qi.supplier_terms, qi.price_answered_at
    from public.sales_quotation_items qi
    left join public.finance_procurement_items i on i.id = qi.catalog_item_id
    left join public.finance_suppliers s on s.id = qi.chosen_supplier_id
   where qi.quotation_id = p_quote
   order by qi.created_at, qi.id;
end $$;

-- ================================================================ CAT-13 ----
-- A revision copies a line's supplier decision and "not in catalog" reason
-- from the line it revises (sales_revise_quotation re-prices at current cost
-- and does not know these columns).
create or replace function public.q77_quote_item_carry()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_from uuid; src record;
begin
  select revised_from into v_from from public.sales_quotations where id = new.quotation_id;
  if v_from is null or new.price_request_status is not null or new.custom_reason is not null then return new; end if;
  select * into src from public.sales_quotation_items x
   where x.quotation_id = v_from and x.catalog_item_id is not distinct from new.catalog_item_id and x.description = new.description
   order by x.created_at limit 1;
  if not found then return new; end if;
  new.custom_reason := src.custom_reason;
  if src.price_request_status = 'answered' then
    new.price_request_status := 'answered'; new.price_request_note := src.price_request_note;
    new.price_requested_by := src.price_requested_by; new.price_requested_at := src.price_requested_at;
    new.chosen_supplier_id := src.chosen_supplier_id; new.supplier_unit_price := src.supplier_unit_price;
    new.supplier_validity := src.supplier_validity; new.supplier_lead_time := src.supplier_lead_time; new.supplier_terms := src.supplier_terms;
    new.supplier_quote_log_id := src.supplier_quote_log_id; new.price_answered_by := src.price_answered_by; new.price_answered_at := src.price_answered_at;
  end if;
  return new;
end $$;
drop trigger if exists sales_quotation_items_q77_carry on public.sales_quotation_items;
create trigger sales_quotation_items_q77_carry before insert on public.sales_quotation_items
  for each row execute function public.q77_quote_item_carry();

-- A line that is not a catalog item can be delivered from stock but never
-- sent to Procurement (the PR needs a catalog item).
create or replace function public.q77_guard_order_item_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment = 'source' and new.catalog_item_id is null then
    raise exception '"%" is not a catalog item, so it cannot be ordered from a supplier. Ask Procurement to add it to the catalog and revise the quotation (CAT-13).', new.description;
  end if;
  return new;
end $$;
drop trigger if exists sales_order_items_q77_catalog on public.sales_order_items;
create trigger sales_order_items_q77_catalog before insert or update of fulfilment, catalog_item_id on public.sales_order_items
  for each row execute function public.q77_guard_order_item_catalog();

-- ==================================================== DOC-03: price request --
-- A draft quote cannot move on while a line still waits for a supplier price.
create or replace function public.q77_guard_quote_awaiting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status::text = 'draft' and new.status::text not in ('draft','cancelled')
     and exists (select 1 from public.sales_quotation_items where quotation_id = new.id and price_request_status = 'awaiting') then
    raise exception 'Quotation % still has lines waiting for Procurement''s supplier price.', new.quotation_number;
  end if;
  return new;
end $$;
drop trigger if exists sales_quotations_q77_awaiting on public.sales_quotations;
create trigger sales_quotations_q77_awaiting before update of status on public.sales_quotations
  for each row execute function public.q77_guard_quote_awaiting();

-- Sales: flag lines of a draft quote "awaiting supplier price" and notify
-- Procurement (Finance section users of the business).
create or replace function public.sales_request_supplier_price(p_quote uuid, p_items uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); q record; l record; n int := 0; v_names text := '';
begin
  select * into q from public.sales_quotations where id = p_quote and business_id = b for update;
  if not found then raise exception 'Quotation not found in this business.'; end if;
  if q.status::text <> 'draft' then raise exception 'Supplier prices are requested on a draft quotation; % is %.', q.quotation_number, q.status; end if;
  if coalesce(cardinality(p_items), 0) = 0 then raise exception 'Choose the lines to ask Procurement about.'; end if;
  for l in select qi.*, i.item_type from public.sales_quotation_items qi left join public.finance_procurement_items i on i.id = qi.catalog_item_id
            where qi.id = any(p_items) order by qi.created_at loop
    if l.quotation_id <> q.id then raise exception 'A chosen line is not on quotation %.', q.quotation_number; end if;
    if l.catalog_item_id is null then raise exception '"%" is not a catalog item: pick the catalog item first (CAT-13).', l.description; end if;
    if coalesce(l.item_type, 'product') = 'service' then raise exception '"%" is a service; supplier prices are for products.', l.description; end if;
    if l.price_request_status = 'awaiting' then continue; end if;
    update public.sales_quotation_items set price_request_status = 'awaiting', price_request_note = nullif(btrim(coalesce(p_note, '')), ''),
           price_requested_by = auth.uid(), price_requested_at = now(), price_answered_by = null, price_answered_at = null
     where id = l.id;
    n := n + 1; v_names := v_names || case when v_names = '' then '' else ', ' end || l.description;
  end loop;
  if n = 0 then raise exception 'Those lines are already waiting for a supplier price.'; end if;
  insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
  select distinct b, ua.user_id, 'finance', 'sales_quotations', q.id, 'Supplier price requested: ' || q.quotation_number,
         n || ' line(s): ' || left(v_names, 300) || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''), '/finance/price-requests', auth.uid()
    from public.user_access ua join public.sections s on s.id = ua.section_id join public.users u on u.id = ua.user_id
   where s.code = 'finance' and u.is_active and u.business_id = b;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_quotations', q.id, 'supplier_price_requested', jsonb_build_object('lines', n, 'items', v_names, 'note', p_note));
  return jsonb_build_object('requested', n);
end $$;

create or replace function public.sales_cancel_price_request(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); l record;
begin
  select qi.*, q.status as qstatus into l from public.sales_quotation_items qi join public.sales_quotations q on q.id = qi.quotation_id
   where qi.id = p_item and qi.business_id = b for update of qi;
  if not found then raise exception 'Quotation line not found in this business.'; end if;
  if l.price_request_status is distinct from 'awaiting' then raise exception 'This line is not waiting for a supplier price.'; end if;
  update public.sales_quotation_items set price_request_status = null, price_request_note = null, price_requested_by = null, price_requested_at = null where id = p_item;
end $$;

-- Procurement: the requests of the business (awaiting first), with the
-- item's current cost and the latest supplier quotes logged for it.
create or replace function public.procurement_price_requests(p_include_answered boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not public.can_manage_supplier_quotes() then raise exception 'Procurement (Finance) access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return coalesce((
    select jsonb_agg(x.r order by x.awaiting desc, x.at desc) from (
      select qi.price_request_status = 'awaiting' as awaiting, coalesce(qi.price_requested_at, qi.created_at) as at, jsonb_build_object(
        'quotation_item_id', qi.id, 'quotation_id', q.id, 'quotation_number', q.quotation_number, 'quotation_status', q.status,
        'customer', c.legal_name, 'item_id', i.id, 'item_code', i.item_code, 'item_name', i.item_name, 'description', qi.description,
        'quantity', qi.quantity, 'unit', qi.unit, 'status', qi.price_request_status, 'note', qi.price_request_note,
        'requested_by', ru.full_name, 'requested_at', qi.price_requested_at,
        'current_cost', i.standard_cost, 'cost_updated_at', i.cost_updated_at,
        'chosen_supplier_id', qi.chosen_supplier_id, 'chosen_supplier', s.legal_name, 'supplier_unit_price', qi.supplier_unit_price,
        'supplier_validity', qi.supplier_validity, 'supplier_lead_time', qi.supplier_lead_time, 'supplier_terms', qi.supplier_terms,
        'answered_by', au.full_name, 'answered_at', qi.price_answered_at, 'line_unit_price', qi.unit_price,
        'recent_quotes', coalesce((select jsonb_agg(jsonb_build_object('supplier_id', l.supplier_id, 'supplier', ls.legal_name, 'unit_price', l.unit_price,
                                     'validity', l.validity, 'lead_time', l.lead_time, 'recorded_at', l.created_at) order by l.created_at desc)
                                     from (select * from public.finance_supplier_quote_log l0 where l0.item_id = i.id order by l0.created_at desc limit 5) l
                                     join public.finance_suppliers ls on ls.id = l.supplier_id), '[]'::jsonb)
      ) as r
      from public.sales_quotation_items qi
      join public.sales_quotations q on q.id = qi.quotation_id
      join public.finance_procurement_items i on i.id = qi.catalog_item_id
      left join public.finance_customers c on c.id = q.customer_id
      left join public.users ru on ru.id = qi.price_requested_by
      left join public.users au on au.id = qi.price_answered_by
      left join public.finance_suppliers s on s.id = qi.chosen_supplier_id
     where qi.business_id = b
       and (qi.price_request_status = 'awaiting'
            or (p_include_answered and qi.price_request_status = 'answered' and q.status::text <> 'superseded'))
    ) x), '[]'::jsonb);
end $$;

-- Procurement records the decision on the line.
-- p = {quotation_item_id, supplier_id, unit_price, validity ('while_supply_lasts'|'fixed_price'), lead_time, terms,
--      log_quote (default true), set_current_cost (default false)}
create or replace function public.procurement_answer_price_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); l record; sup record; v_price numeric; v_validity text; v_lead text; v_terms text;
        v_log uuid; pr record; v_new_price numeric; v_cost_set boolean := false;
begin
  if not public.can_manage_supplier_quotes() then raise exception 'Only Procurement (Finance) can record the supplier price.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select qi.*, q.status as qstatus, q.customer_id, q.quotation_number, q.created_by as quote_creator into l
    from public.sales_quotation_items qi join public.sales_quotations q on q.id = qi.quotation_id
   where qi.id = nullif(p->>'quotation_item_id', '')::uuid and qi.business_id = b for update of qi;
  if not found then raise exception 'Price request not found in this business.'; end if;
  if l.price_request_status is null then raise exception 'Sales did not ask for a supplier price on this line.'; end if;
  if l.qstatus::text <> 'draft' then
    raise exception 'Quotation % is no longer a draft (%); its prices can no longer change.', l.quotation_number, l.qstatus;
  end if;
  select * into sup from public.finance_suppliers where id = nullif(p->>'supplier_id', '')::uuid;
  if not found or not sup.active then raise exception 'Choose an active registered supplier.'; end if;
  v_price := nullif(p->>'unit_price', '')::numeric;
  if v_price is null or v_price < 0 then raise exception 'Enter the supplier''s unit price.'; end if;
  v_validity := coalesce(nullif(p->>'validity', ''), 'while_supply_lasts');
  if v_validity not in ('while_supply_lasts','fixed_price') then raise exception 'Validity is "while supply lasts" or "fixed price".'; end if;
  v_lead := coalesce(nullif(btrim(coalesce(p->>'lead_time', '')), ''), 'Within the day');
  v_terms := coalesce(nullif(btrim(coalesce(p->>'terms', '')), ''), sup.payment_terms);

  if coalesce((p->>'log_quote')::boolean, true) then
    insert into public.finance_supplier_quote_log(item_id, supplier_id, unit_price, validity, lead_time, recorded_for_business_id)
    values (l.catalog_item_id, sup.id, round(v_price, 2), v_validity, v_lead, b) returning id into v_log;
    if coalesce((p->>'set_current_cost')::boolean, false) then
      perform public.set_item_cost_from_quote(v_log);
      v_cost_set := true;
    end if;
  elsif coalesce((p->>'set_current_cost')::boolean, false) then
    raise exception 'To set it as the current cost, the price must also be logged in the supplier quote log.';
  end if;

  -- re-price the line from the supplier's price with the unchanged formula
  select * into pr from public.get_catalog_sales_price(l.catalog_item_id, l.customer_id, round(v_price, 2)) limit 1;
  v_new_price := round(coalesce(pr.customer_price, l.unit_price), 2);
  update public.sales_quotation_items set
         chosen_supplier_id = sup.id, supplier_unit_price = round(v_price, 2), supplier_validity = v_validity, supplier_lead_time = v_lead,
         supplier_terms = v_terms, supplier_quote_log_id = v_log, price_request_status = 'answered', price_answered_by = auth.uid(), price_answered_at = now(),
         unit_price = v_new_price, pricing_supplier_cost = pr.supplier_cost, pricing_category_addon_percent = pr.category_addon_percent,
         pricing_acquisition_cost = pr.acquisition_cost, pricing_item_markup_percent = pr.item_markup_percent, pricing_srp = pr.srp,
         pricing_customer_discount_percent = pr.customer_discount_percent, pricing_item_type = coalesce(pr.item_type, pricing_item_type),
         pricing_snapshot_at = now()
   where id = l.id;
  update public.sales_quotations set subtotal = (select coalesce(sum(amount), 0) from public.sales_quotation_items where quotation_id = l.quotation_id), updated_at = now()
   where id = l.quotation_id;

  insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
  select distinct b, u.id, 'sales', 'sales_quotations', l.quotation_id, 'Supplier price received: ' || l.quotation_number,
         l.description || ': ' || sup.legal_name || ' ₱' || to_char(round(v_price, 2), 'FM999,999,990.00') || ' (' || replace(v_validity, '_', ' ') || ', ' || v_lead
           || '). Line price is now ₱' || to_char(v_new_price, 'FM999,999,990.00') || '.', '/sales/revenue', auth.uid()
    from public.users u where u.id in (l.price_requested_by, l.quote_creator) and u.is_active;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_quotation_items', l.id, 'supplier_price_recorded',
          jsonb_build_object('quotation', l.quotation_number, 'supplier', sup.legal_name, 'supplier_price', round(v_price, 2), 'validity', v_validity,
                             'lead_time', v_lead, 'terms', v_terms, 'logged', v_log is not null, 'set_current_cost', v_cost_set,
                             'old_line_price', l.unit_price, 'new_line_price', v_new_price));
  return jsonb_build_object('quotation_number', l.quotation_number, 'line_price', v_new_price, 'logged', v_log is not null, 'current_cost_set', v_cost_set);
end $$;

-- ---------------------------------------------- DOC-07: chosen supplier → PR --
-- When the order's PR line is created, it takes the chosen supplier and its
-- price from the quotation line (Procurement sees it on the PR line).
create or replace function public.q77_pr_item_supplier()
returns trigger language plpgsql security definer set search_path = public as $$
declare qi record;
begin
  if new.sales_order_item_id is null or new.preferred_supplier_id is not null then return new; end if;
  select x.chosen_supplier_id, x.supplier_unit_price, x.supplier_validity, x.supplier_lead_time, x.supplier_terms, s.legal_name into qi
    from public.sales_order_items soi join public.sales_quotation_items x on x.id = soi.quotation_item_id
    left join public.finance_suppliers s on s.id = x.chosen_supplier_id
   where soi.id = new.sales_order_item_id;
  if qi.chosen_supplier_id is null then return new; end if;
  new.preferred_supplier_id := qi.chosen_supplier_id;
  new.supplier_quoted_price := qi.supplier_unit_price;
  new.notes := coalesce(new.notes || ' · ', '') || 'Chosen supplier: ' || qi.legal_name || ' at ₱' || to_char(qi.supplier_unit_price, 'FM999,999,990.00')
               || coalesce(' (' || replace(qi.supplier_validity, '_', ' ') || coalesce(', ' || qi.supplier_lead_time, '') || coalesce(', terms ' || qi.supplier_terms, '') || ')', '');
  return new;
end $$;
drop trigger if exists purchase_requisition_items_q77_supplier on public.purchase_requisition_items;
create trigger purchase_requisition_items_q77_supplier before insert on public.purchase_requisition_items
  for each row execute function public.q77_pr_item_supplier();

-- ==================================================== DOC-08: pay by PO ------
-- PO value: its total, or the sum of its lines when the header total was never
-- filled in.
create or replace function public.ap_po_value(p_po uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when coalesce(po.total_amount, 0) > 0 then po.total_amount
              else coalesce((select sum(round(poi.quantity * poi.unit_cost, 2)) from public.purchase_order_items poi where poi.purchase_order_id = po.id), 0)
                   + coalesce(po.tax_amount, 0) + coalesce(po.other_charges, 0) end
    from public.purchase_orders po where po.id = p_po;
$$;

-- What has been paid on an invoice: its own posted payments + PO payments applied to it.
create or replace function public.ap_invoice_paid(p_invoice uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from public.finance_supplier_payments where invoice_id = p_invoice and status = 'posted'), 0)
       + coalesce((select sum(a.amount) from public.finance_supplier_payment_applications a where a.invoice_id = p_invoice), 0);
$$;

create or replace function public.recalculate_supplier_invoice_paid(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric(14,2) := public.ap_invoice_paid(p_invoice_id);
begin
  update public.finance_supplier_invoices
     set amount_paid = v_paid,
         status = case when status = 'voided' then status
                       when v_paid > 0 and v_paid >= total_amount then 'paid'::public.ap_invoice_status
                       when v_paid > 0 then 'partially_paid'::public.ap_invoice_status
                       when status in ('paid','partially_paid') then 'approved'::public.ap_invoice_status
                       else status end,
         updated_at = now()
   where id = p_invoice_id;
end $$;

-- Apply the unapplied part of the PO's posted payments to its registered
-- (approved / partially paid) invoices, oldest first.
create or replace function public.ap_apply_po_payments(p_po uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay record; inv record; v_free numeric; v_bal numeric; v_amt numeric; v_prev text := coalesce(current_setting('ibx.ap_applying', true), '');
begin
  if p_po is null then return; end if;
  perform set_config('ibx.ap_applying', '1', true);
  for pay in select p.* from public.finance_supplier_payments p where p.purchase_order_id = p_po and p.status = 'posted' order by p.payment_date, p.created_at loop
    v_free := pay.amount - coalesce((select sum(amount) from public.finance_supplier_payment_applications where payment_id = pay.id), 0);
    continue when v_free <= 0;
    for inv in select i.* from public.finance_supplier_invoices i where i.purchase_order_id = p_po and i.status in ('approved','partially_paid')
                order by i.invoice_date, i.created_at loop
      v_bal := inv.total_amount - public.ap_invoice_paid(inv.id);
      continue when v_bal <= 0;
      v_amt := least(v_free, v_bal);
      insert into public.finance_supplier_payment_applications(business_id, payment_id, invoice_id, amount) values (pay.business_id, pay.id, inv.id, v_amt);
      perform public.recalculate_supplier_invoice_paid(inv.id);
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'finance_supplier_payments', pay.id, 'po_payment_applied_to_invoice', jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'amount', v_amt));
      v_free := v_free - v_amt;
      exit when v_free <= 0;
    end loop;
  end loop;
  perform set_config('ibx.ap_applying', v_prev, true);
end $$;

-- Payments against a PO: valid PO of the same business, never more than the
-- PO's remaining value, PO link fixed once made, posted amount fixed.
create or replace function public.q77_guard_po_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare po record; v_value numeric; v_other numeric;
begin
  if tg_op = 'UPDATE' then
    if new.purchase_order_id is distinct from old.purchase_order_id or new.invoice_id is distinct from old.invoice_id then
      raise exception 'A supplier payment''s PO or invoice cannot be changed; void it and record a new one.';
    end if;
    if old.status = 'posted' and new.amount is distinct from old.amount then raise exception 'A posted payment''s amount cannot be changed.'; end if;
    if old.status = 'voided' and new.status <> 'voided' then raise exception 'A voided payment cannot be reopened.'; end if;
  end if;
  if new.purchase_order_id is null or new.status = 'voided' then return new; end if;
  select * into po from public.purchase_orders where id = new.purchase_order_id;
  if not found then raise exception 'Purchase order not found.'; end if;
  if po.business_id is distinct from new.business_id then raise exception 'The purchase order belongs to another business.'; end if;
  if tg_op = 'INSERT' and (po.status::text not in ('approved','posted','paid') or po.issuance_status = 'cancelled') then
    raise exception 'Payments are made against an approved purchase order (% is %).', po.po_number, po.status;
  end if;
  v_value := public.ap_po_value(po.id);
  select coalesce(sum(amount), 0) into v_other from public.finance_supplier_payments
   where purchase_order_id = po.id and status <> 'voided' and id <> new.id;
  v_other := v_other + coalesce((select sum(p.amount) from public.finance_supplier_payments p join public.finance_supplier_invoices i on i.id = p.invoice_id
                                  where i.purchase_order_id = po.id and i.status <> 'voided' and p.status = 'posted'), 0);
  if new.amount > v_value - v_other + 0.004 then
    raise exception 'Payment of ₱% is more than what is left to pay on % (₱% of ₱%).', to_char(new.amount, 'FM999,999,990.00'), po.po_number,
      to_char(greatest(v_value - v_other, 0), 'FM999,999,990.00'), to_char(v_value, 'FM999,999,990.00');
  end if;
  if new.po_payment_kind = 'full_prepayment' and abs(new.amount - (v_value - v_other)) > 0.004 and tg_op = 'INSERT' then
    raise exception 'A full prepayment pays the whole remaining balance of % (₱%).', po.po_number, to_char(v_value - v_other, 'FM999,999,990.00');
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_payments_q77_guard on public.finance_supplier_payments;
create trigger finance_supplier_payments_q77_guard before insert or update on public.finance_supplier_payments
  for each row execute function public.q77_guard_po_payment();

-- Posting / voiding a payment updates the invoices it pays.
create or replace function public.q77_after_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.invoice_id is not null and (new.status = 'posted' or (tg_op = 'UPDATE' and old.status = 'posted')) then
    perform public.recalculate_supplier_invoice_paid(new.invoice_id);
  end if;
  if new.purchase_order_id is not null then
    if new.status = 'voided' and tg_op = 'UPDATE' and old.status = 'posted' then
      for a in delete from public.finance_supplier_payment_applications where payment_id = new.id returning invoice_id loop
        perform public.recalculate_supplier_invoice_paid(a.invoice_id);
      end loop;
    elsif new.status = 'posted' then
      perform public.ap_apply_po_payments(new.purchase_order_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_payments_q77_after on public.finance_supplier_payments;
create trigger finance_supplier_payments_q77_after after insert or update of status on public.finance_supplier_payments
  for each row execute function public.q77_after_payment();

-- Registering (approving) a PO's invoice applies the payments already made
-- against the PO; voiding it releases them to the PO's other invoices.
create or replace function public.q77_after_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ibx.ap_applying', true), '') = '1' then return new; end if;
  if new.purchase_order_id is null then return new; end if;
  if new.status = 'voided' and old.status is distinct from 'voided' then
    delete from public.finance_supplier_payment_applications where invoice_id = new.id;
    perform public.ap_apply_po_payments(new.purchase_order_id);
  elsif new.status in ('approved','partially_paid') then
    perform public.ap_apply_po_payments(new.purchase_order_id);
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_invoices_q77_after on public.finance_supplier_invoices;
create trigger finance_supplier_invoices_q77_after after update of status, purchase_order_id on public.finance_supplier_invoices
  for each row execute function public.q77_after_invoice();

-- Finance: record a draft payment against a PO (then prepare → review →
-- approve with the existing AP workflow, and post with ap_post_po_payment).
-- p = {purchase_order_id, kind ('full_prepayment'|'deposit'|'partial'), amount (defaults to the remaining
--      balance for a full prepayment), payment_date, payment_method, reference_number, bank_account, notes}
create or replace function public.ap_po_payment_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); po record; v_kind text := coalesce(nullif(p->>'kind', ''), 'deposit'); v_amt numeric; v_code text; v_no text; v_id uuid;
        v_left numeric;
begin
  if not public.can_use_ap() then raise exception 'Finance access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if v_kind not in ('full_prepayment','deposit','partial') then raise exception 'Choose full prepayment, deposit or partial payment.'; end if;
  select * into po from public.purchase_orders where id = nullif(p->>'purchase_order_id', '')::uuid and business_id = b;
  if not found then raise exception 'Purchase order not found in this business.'; end if;
  select x.remaining - x.pending into v_left from public.ap_po_payment_status(po.id) x;   -- what is not yet paid nor in approval
  v_amt := coalesce(nullif(p->>'amount', '')::numeric, case when v_kind = 'full_prepayment' then v_left end);
  if v_amt is null or v_amt <= 0 then raise exception 'Enter the amount to pay.'; end if;
  if coalesce(btrim(p->>'payment_method'), '') = '' then raise exception 'Choose the payment method.'; end if;
  select code into v_code from public.businesses where id = b;
  v_no := public.storefront_next_number(coalesce(v_code, 'IBX') || '-APP', 'finance_supplier_payments', 'payment_number');
  insert into public.finance_supplier_payments(business_id, payment_number, purchase_order_id, po_payment_kind, payment_date, amount, payment_method,
                                               reference_number, bank_account, notes, status, created_by)
  values (b, v_no, po.id, v_kind, coalesce(nullif(p->>'payment_date', '')::date, (now() at time zone 'Asia/Manila')::date), round(v_amt, 2), btrim(p->>'payment_method'),
          nullif(btrim(coalesce(p->>'reference_number', '')), ''), nullif(btrim(coalesce(p->>'bank_account', '')), ''),
          nullif(btrim(coalesce(p->>'notes', '')), ''), 'draft', auth.uid())
  returning id into v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_supplier_payments', v_id, 'po_payment_created', jsonb_build_object('po_number', po.po_number, 'kind', v_kind, 'amount', round(v_amt, 2)));
  return jsonb_build_object('id', v_id, 'payment_number', v_no, 'amount', round(v_amt, 2));
end $$;

create or replace function public.ap_post_po_payment(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); pay record;
begin
  if not public.can_use_ap() then raise exception 'Finance access is required.'; end if;
  select * into pay from public.finance_supplier_payments where id = p_payment and business_id = b for update;
  if not found or pay.purchase_order_id is null then raise exception 'PO payment not found in this business.'; end if;
  if pay.status <> 'approved' then raise exception 'Only an approved payment can be posted (this one is %).', pay.status; end if;
  if not (public.is_super_admin() or public.is_business_admin()
          or public.has_workflow_role((select id from public.sections where code = 'finance'), 'approver')) then
    raise exception 'Posting a supplier payment needs the Finance approver role.';
  end if;
  update public.finance_supplier_payments set status = 'posted', posted_by = auth.uid(), posted_at = now(), updated_at = now() where id = pay.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_supplier_payments', pay.id, 'posted', jsonb_build_object('purchase_order_id', pay.purchase_order_id, 'amount', pay.amount));
  return (select to_jsonb(s) from public.ap_po_payment_status(pay.purchase_order_id) s);
end $$;

-- Paid / remaining per PO of the business (one PO, or all approved POs).
create or replace function public.ap_po_payment_status(p_po uuid default null)
returns table(purchase_order_id uuid, po_number text, supplier text, po_status text, po_value numeric, paid numeric, pending numeric,
              remaining numeric, unapplied numeric, invoices jsonb, payments jsonb)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not public.can_use_ap() then raise exception 'Finance access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return query
  with po as (
    select o.id, o.po_number, o.status::text as st, s.legal_name, public.ap_po_value(o.id) as val
      from public.purchase_orders o join public.finance_suppliers s on s.id = o.supplier_id
     where o.business_id = b and (case when p_po is null then o.status::text in ('approved','posted','paid') else o.id = p_po end)
  ), m as (
    select po.*,
      coalesce((select sum(p.amount) from public.finance_supplier_payments p where p.purchase_order_id = po.id and p.status = 'posted'), 0) as po_posted,
      coalesce((select sum(p.amount) from public.finance_supplier_payments p where p.purchase_order_id = po.id and p.status in ('draft','prepared','reviewed','approved')), 0) as po_pending,
      coalesce((select sum(p.amount) from public.finance_supplier_payments p join public.finance_supplier_invoices i on i.id = p.invoice_id
                 where i.purchase_order_id = po.id and i.status <> 'voided' and p.status = 'posted'), 0) as inv_posted,
      coalesce((select sum(a.amount) from public.finance_supplier_payment_applications a join public.finance_supplier_payments p on p.id = a.payment_id
                 where p.purchase_order_id = po.id), 0) as applied
    from po
  )
  select m.id, m.po_number, m.legal_name, m.st, m.val, m.po_posted + m.inv_posted, m.po_pending,
         greatest(m.val - m.po_posted - m.inv_posted, 0), m.po_posted - m.applied,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'status', i.status, 'total', i.total_amount,
                                    'paid', i.amount_paid, 'balance', i.balance_due,
                                    'from_po_payments', coalesce((select sum(a.amount) from public.finance_supplier_payment_applications a where a.invoice_id = i.id), 0))
                                    order by i.invoice_date)
                     from public.finance_supplier_invoices i where i.purchase_order_id = m.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'payment_number', p.payment_number, 'kind', p.po_payment_kind, 'date', p.payment_date,
                                    'amount', p.amount, 'status', p.status, 'method', p.payment_method, 'reference', p.reference_number,
                                    'applied', coalesce((select sum(a.amount) from public.finance_supplier_payment_applications a where a.payment_id = p.id), 0))
                                    order by p.payment_date, p.created_at)
                     from public.finance_supplier_payments p where p.purchase_order_id = m.id), '[]'::jsonb)
    from m order by m.po_number desc;
end $$;

-- ==================================================== DOC-13: chain view -----
-- Quote → SO → PR → PO(s) → supplier receipt(s) / AP invoice(s) / supplier
-- payment(s), and the order's DRs with SI and AR status, plus each line's
-- status. Read-only; Sales cannot read these tables directly.
create or replace function public.sales_order_chain(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); o record; v_pos uuid[];
begin
  select so.*, q.quotation_number, pr.pr_number, pr.status::text as pr_status, pr.fulfillment_status as pr_fulfilment
    into o from public.sales_orders so
    left join public.sales_quotations q on q.id = so.quotation_id
    left join public.purchase_requisitions pr on pr.id = so.purchase_requisition_id
   where so.id = p_order and so.business_id = b;
  if not found then raise exception 'Sales order not found in this business.'; end if;
  select coalesce(array_agg(distinct poi.purchase_order_id), '{}') into v_pos
    from public.purchase_order_items poi join public.purchase_requisition_items pri on pri.id = poi.source_requisition_item_id
   where o.purchase_requisition_id is not null and pri.requisition_id = o.purchase_requisition_id;
  return jsonb_build_object('quotation_number', o.quotation_number, 'order_number', o.order_number, 'pr_number', o.pr_number, 'pr_status', o.pr_status,
    'pr_fulfilment', o.pr_fulfilment,
    'po_numbers', coalesce((select jsonb_agg(po.po_number order by po.po_number) from public.purchase_orders po where po.id = any(v_pos)), '[]'::jsonb),
    'pos', coalesce((select jsonb_agg(jsonb_build_object(
        'po_number', po.po_number, 'status', po.status, 'issuance_status', po.issuance_status, 'supplier', s.legal_name, 'order_date', po.order_date,
        'value', public.ap_po_value(po.id),
        'receipts', coalesce((select jsonb_agg(jsonb_build_object('receipt_number', r.receipt_number, 'date', r.receipt_date, 'status', r.status,
                                 'supplier_dr', r.delivery_reference) order by r.receipt_date, r.created_at)
                              from public.logistics_receipts r where r.purchase_order_id = po.id), '[]'::jsonb),
        'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number, 'date', i.invoice_date, 'status', i.status,
                                 'total', i.total_amount, 'paid', i.amount_paid, 'balance', i.balance_due) order by i.invoice_date, i.created_at)
                              from public.finance_supplier_invoices i where i.purchase_order_id = po.id), '[]'::jsonb),
        'payments', coalesce((select jsonb_agg(jsonb_build_object('payment_number', p.payment_number, 'date', p.payment_date, 'amount', p.amount, 'status', p.status,
                                 'against', case when p.purchase_order_id is not null then 'PO' else 'invoice ' || i.invoice_number end,
                                 'kind', p.po_payment_kind) order by p.payment_date, p.created_at)
                              from public.finance_supplier_payments p left join public.finance_supplier_invoices i on i.id = p.invoice_id
                             where p.status <> 'voided' and (p.purchase_order_id = po.id or i.purchase_order_id = po.id)), '[]'::jsonb),
        'paid', coalesce((select sum(p.amount) from public.finance_supplier_payments p left join public.finance_supplier_invoices i on i.id = p.invoice_id
                           where p.status = 'posted' and (p.purchase_order_id = po.id or (i.purchase_order_id = po.id and i.status <> 'voided'))), 0)
      ) order by po.po_number) from public.purchase_orders po join public.finance_suppliers s on s.id = po.supplier_id where po.id = any(v_pos)), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', soi.id, 'description', soi.description, 'unit', soi.unit, 'fulfilment', soi.fulfilment, 'ordered', soi.quantity,
        'received', case when soi.fulfilment = 'source' then public.sf_order_line_received(soi.id) end,
        'delivered', dl.delivered, 'released', dl.released, 'chosen_supplier', cs.legal_name) order by soi.ctid)
        from public.sales_order_items soi cross join lateral public.sf_order_line_delivered(soi.id) dl
        left join public.sales_quotation_items qi on qi.id = soi.quotation_item_id
        left join public.finance_suppliers cs on cs.id = qi.chosen_supplier_id
       where soi.order_id = o.id), '[]'::jsonb),
    'drs', coalesce((select jsonb_agg(jsonb_build_object('sale_number', s.sale_number, 'dr_number', s.dr_number, 'date', s.sale_date, 'total', s.total,
        'release_status', s.release_status, 'si_number', s.si_number, 'invoice_number', inv.invoice_number, 'invoice_status', inv.status,
        'balance_due', inv.balance_due) order by s.created_at)
        from public.storefront_sales s left join public.finance_customer_invoices inv on inv.id = s.ar_invoice_id
       where s.sales_order_id = o.id and s.status = 'completed'), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ grants --
grant execute on function public.sales_quote_stock(uuid[]), public.sales_quote_line_status(uuid), public.sales_request_supplier_price(uuid, uuid[], text),
  public.sales_cancel_price_request(uuid), public.procurement_price_requests(boolean), public.procurement_answer_price_request(jsonb),
  public.ap_po_payment_create(jsonb), public.ap_post_po_payment(uuid), public.ap_po_payment_status(uuid), public.sales_order_chain(uuid) to authenticated;
revoke all on function public.q77_quote_item_carry(), public.q77_guard_order_item_catalog(), public.q77_guard_quote_awaiting(), public.q77_pr_item_supplier(),
  public.q77_guard_po_payment(), public.q77_after_payment(), public.q77_after_invoice(), public.ap_apply_po_payments(uuid),
  public.ap_po_value(uuid), public.ap_invoice_paid(uuid) from public, authenticated;
