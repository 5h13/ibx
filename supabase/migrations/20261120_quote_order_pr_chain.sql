-- ============================================================================
-- Build 69 — Quote → Sales Order → PR, stage 1 of the quote chain
-- (punchlist DOC-05, DOC-06, DOC-07, DOC-11 numbering, DOC-12 fields,
-- DOC-13 links for this stage). Decisions by the user, 2026-09-27:
--   • Quote and order numbers are system-generated and cannot be edited.
--   • A revised quote keeps its base number with a revision (…-R2) and the
--     history of earlier revisions; a revision picks up the current cost.
--   • "Create order" on the client's go-signal records the client PO number
--     (optional), date, how it was received and who confirmed it; without a
--     client PO a screenshot of the confirmation is required. The Sales
--     Order goes to the Sales final approver.
--   • The same action decides, per line, "from stock" or "order from
--     supplier"; the PR for the supplier lines is released to Procurement
--     only when the order is approved (linked to the quote and the order).
-- ============================================================================

-- enum value used by revisions (only referenced inside function bodies below)
alter type public.sales_quotation_status add value if not exists 'superseded';

-- ------------------------------------------------------------- quotations --
alter table public.sales_quotations
  add column if not exists base_number text,
  add column if not exists revision int not null default 0,
  add column if not exists revised_from uuid references public.sales_quotations(id),
  add column if not exists payment_terms text,
  add column if not exists delivery_lead_time text;
update public.sales_quotations set base_number = quotation_number where base_number is null;
-- line order on screen and on the printed quotation = the order lines were entered
alter table public.sales_quotation_items add column if not exists created_at timestamptz not null default clock_timestamp();
create unique index if not exists sales_quotations_base_revision on public.sales_quotations (base_number, revision);

-- Numbers: <BUSINESS CODE>-QT-YYYY-###### (revision n: <base>-R<n>); never edited.
create or replace function public.guard_sales_quotation_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_base text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.revision, 0) > 0 then
      if new.revised_from is null then raise exception 'A quotation revision must name the quotation it revises.'; end if;
      select base_number into v_base from public.sales_quotations where id = new.revised_from;
      if v_base is null then raise exception 'The quotation being revised was not found.'; end if;
      new.base_number := v_base;
      new.quotation_number := v_base || '-R' || new.revision;
    else
      select code into v_code from public.businesses where id = new.business_id;
      new.revision := 0; new.revised_from := null;
      new.quotation_number := public.storefront_next_number(coalesce(v_code, 'IBX') || '-QT', 'sales_quotations', 'quotation_number');
      new.base_number := new.quotation_number;
    end if;
  elsif new.quotation_number is distinct from old.quotation_number or new.base_number is distinct from old.base_number
     or new.revision is distinct from old.revision or new.revised_from is distinct from old.revised_from then
    raise exception 'Quotation numbers are system-generated and cannot be changed.';
  end if;
  return new;
end $$;
drop trigger if exists sales_quotations_number_guard on public.sales_quotations;
create trigger sales_quotations_number_guard before insert or update on public.sales_quotations
  for each row execute function public.guard_sales_quotation_number();

-- ----------------------------------------------------------------- orders --
alter table public.sales_orders
  add column if not exists client_po_number text,
  add column if not exists go_signal_date date,
  add column if not exists go_signal_via text,
  add column if not exists go_signal_confirmed_by text,
  add column if not exists go_signal_proof_path text,
  add column if not exists purchase_requisition_id uuid references public.purchase_requisitions(id);
alter table public.sales_order_items
  add column if not exists quotation_item_id uuid references public.sales_quotation_items(id),
  add column if not exists fulfilment text not null default 'stock',
  add column if not exists purchase_requisition_item_id uuid references public.purchase_requisition_items(id),
  add column if not exists estimated_unit_cost numeric(14,2);
alter table public.sales_order_items drop constraint if exists sales_order_items_fulfilment_check;
alter table public.sales_order_items add constraint sales_order_items_fulfilment_check check (fulfilment in ('stock','source','service'));
-- one open order per quotation (created only when existing data already
-- complies; sales_create_order checks it either way)
do $$ begin
  if not exists (select quotation_id from public.sales_orders where quotation_id is not null and status <> 'cancelled' group by quotation_id having count(*) > 1) then
    create unique index if not exists sales_orders_one_open_per_quote on public.sales_orders (quotation_id) where quotation_id is not null and status <> 'cancelled';
  end if;
end $$;

alter table public.purchase_requisitions
  add column if not exists sales_order_id uuid references public.sales_orders(id),
  add column if not exists quotation_id uuid references public.sales_quotations(id);
alter table public.purchase_requisition_items
  add column if not exists sales_order_item_id uuid references public.sales_order_items(id);
create unique index if not exists purchase_requisitions_one_per_sales_order on public.purchase_requisitions (sales_order_id) where sales_order_id is not null;

-- Numbers: <BUSINESS CODE>-SO-YYYY-######, always generated, never edited.
-- Approving an order is for the Sales final approver (Sales approver grant),
-- a Business Admin or the Super Admin.
create or replace function public.guard_sales_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if tg_op = 'INSERT' then
    select code into v_code from public.businesses where id = new.business_id;
    new.order_number := public.storefront_next_number(coalesce(v_code, 'IBX') || '-SO', 'sales_orders', 'order_number');
  else
    if new.order_number is distinct from old.order_number then raise exception 'Sales order numbers are system-generated and cannot be changed.'; end if;
    if new.status = 'approved' and old.status is distinct from 'approved' and auth.uid() is not null and not public.can_approve_storefront() then
      raise exception 'Only the Sales final approver (Sales approver), a Business Admin or the Super Admin can approve a sales order.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sales_orders_guard on public.sales_orders;
create trigger sales_orders_guard before insert or update on public.sales_orders
  for each row execute function public.guard_sales_order();

-- ------------------------------------------------------------------ helpers --
create or replace function public.sales_doc_business()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not public.can_use_storefront() then raise exception 'Sales access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return b;
end $$;

-- ------------------------------------------------------ DOC-05: revisions --
-- Copies the quote as the next revision (draft), re-pricing catalog lines at
-- the current cost / pricing rules; custom lines are copied as they are.
-- The quote it replaces becomes "superseded".
create or replace function public.sales_revise_quotation(p_quote uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); q record; v_new uuid; v_rev int; l record; pr record; v_sub numeric := 0; v_no text;
begin
  select * into q from public.sales_quotations where id = p_quote and business_id = b for update;
  if not found then raise exception 'Quotation not found in this business.'; end if;
  if q.status::text in ('superseded','cancelled') then raise exception 'This quotation was already revised or cancelled; revise the latest revision.'; end if;
  if exists (select 1 from public.sales_orders where quotation_id = q.id and status <> 'cancelled') then
    raise exception 'An order was already created from this quotation, so it can no longer be revised.';
  end if;
  select coalesce(max(revision), 0) + 1 into v_rev from public.sales_quotations where base_number = q.base_number;
  insert into public.sales_quotations(business_id, revision, revised_from, opportunity_id, customer_id, quotation_date, valid_until, currency,
                                      subtotal, discount_amount, tax_amount, other_charges, notes, payment_terms, delivery_lead_time, created_by)
  values (b, v_rev, q.id, q.opportunity_id, q.customer_id, (now() at time zone 'Asia/Manila')::date,
          case when q.valid_until is not null then (now() at time zone 'Asia/Manila')::date + greatest(q.valid_until - q.quotation_date, 0) end,
          q.currency, 0, q.discount_amount, q.tax_amount, q.other_charges, q.notes, q.payment_terms, q.delivery_lead_time, auth.uid())
  returning id, quotation_number into v_new, v_no;
  for l in select * from public.sales_quotation_items where quotation_id = q.id order by created_at, id loop
    if l.catalog_item_id is not null then
      select * into pr from public.get_catalog_sales_price(l.catalog_item_id, q.customer_id, null) limit 1;
      insert into public.sales_quotation_items(business_id, quotation_id, catalog_item_id, description, quantity, unit, unit_price, notes,
        pricing_supplier_cost, pricing_service_cost_basis, pricing_item_type, pricing_category_addon_percent, pricing_acquisition_cost,
        pricing_item_markup_percent, pricing_srp, pricing_customer_discount_percent, pricing_snapshot_at)
      values (b, v_new, l.catalog_item_id, l.description, l.quantity, l.unit, round(coalesce(pr.customer_price, l.unit_price), 2), l.notes,
        pr.supplier_cost, pr.service_cost_basis, coalesce(pr.item_type, l.pricing_item_type, 'product'), pr.category_addon_percent, pr.acquisition_cost,
        pr.item_markup_percent, pr.srp, pr.customer_discount_percent, now());
      v_sub := v_sub + round(l.quantity * round(coalesce(pr.customer_price, l.unit_price), 2), 2);
    else
      insert into public.sales_quotation_items(business_id, quotation_id, description, quantity, unit, unit_price, notes)
      values (b, v_new, l.description, l.quantity, l.unit, l.unit_price, l.notes);
      v_sub := v_sub + round(l.quantity * l.unit_price, 2);
    end if;
  end loop;
  update public.sales_quotations set subtotal = v_sub where id = v_new;
  update public.sales_quotations set status = 'superseded', updated_at = now() where id = q.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_quotations', v_new, 'quotation_revised', jsonb_build_object('from', q.quotation_number, 'to', v_no, 'old_subtotal', q.subtotal, 'new_subtotal', v_sub));
  return jsonb_build_object('id', v_new, 'quotation_number', v_no, 'old_subtotal', q.subtotal, 'subtotal', v_sub);
end $$;

-- ------------------------------------------- DOC-06/07: create the order --
-- Lines of a quote with stock on hand in this business (all locations), for
-- the "from stock / order from supplier" choice.
create or replace function public.sales_quote_order_lines(p_quote uuid)
returns table(quotation_item_id uuid, catalog_item_id uuid, description text, quantity numeric, unit text, unit_price numeric,
              item_type text, on_hand numeric, current_cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.sales_doc_business();
begin
  if not exists (select 1 from public.sales_quotations where id = p_quote and business_id = b) then raise exception 'Quotation not found in this business.'; end if;
  return query
  select qi.id, qi.catalog_item_id, qi.description, qi.quantity, qi.unit, qi.unit_price,
         case when qi.catalog_item_id is null then 'custom' else coalesce(i.item_type, qi.pricing_item_type, 'product') end,
         case when qi.catalog_item_id is null or coalesce(i.item_type, 'product') = 'service' then null
              else coalesce((select sum(bal.on_hand) from public.logistics_inventory_items inv
                               join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id
                              where inv.business_id = b and inv.procurement_item_id = qi.catalog_item_id), 0) end,
         coalesce(qi.pricing_supplier_cost, i.standard_cost)::numeric
    from public.sales_quotation_items qi
    left join public.finance_procurement_items i on i.id = qi.catalog_item_id
   where qi.quotation_id = p_quote
   order by qi.created_at, qi.id;
end $$;

-- p = {quotation_id, client_po_number, go_signal_date, go_signal_via, confirmed_by, proof_path,
--      requested_delivery_date, delivery_address, contact_name, contact_phone, notes,
--      lines:[{quotation_item_id, fulfilment:'stock'|'source'}]}
create or replace function public.sales_create_order(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); q record; v_order uuid; v_no text; l record; v_f text; v_src int := 0;
        v_via text := btrim(coalesce(p->>'go_signal_via', '')); v_po text := nullif(btrim(coalesce(p->>'client_po_number', '')), '');
        v_proof text := nullif(btrim(coalesce(p->>'proof_path', '')), '');
begin
  select * into q from public.sales_quotations where id = (p->>'quotation_id')::uuid and business_id = b for update;
  if not found then raise exception 'Quotation not found in this business.'; end if;
  if q.status::text not in ('approved','sent','accepted') then
    raise exception 'The quotation must be approved (and sent to the client) before the client''s go-signal is recorded; it is %.', q.status;
  end if;
  if exists (select 1 from public.sales_orders where quotation_id = q.id and status <> 'cancelled') then raise exception 'An order already exists for this quotation.'; end if;
  if v_via = '' then raise exception 'Say how the client''s go-signal was received.'; end if;
  if coalesce(btrim(p->>'confirmed_by'), '') = '' then raise exception 'Enter who confirmed for the client.'; end if;
  if nullif(p->>'go_signal_date', '') is null then raise exception 'Enter the date of the go-signal.'; end if;
  if (p->>'go_signal_date')::date > (now() at time zone 'Asia/Manila')::date then raise exception 'The go-signal date cannot be in the future.'; end if;
  if v_po is null and v_proof is null then raise exception 'Without a client PO number, attach a screenshot of the client''s confirmation.'; end if;
  if v_proof is not null and v_proof not like q.id::text || '/%' then raise exception 'The attached confirmation does not belong to this quotation.'; end if;

  insert into public.sales_orders(business_id, quotation_id, opportunity_id, customer_id, order_date, requested_delivery_date, delivery_address,
                                  contact_name, contact_phone, subtotal, discount_amount, tax_amount, other_charges, notes, status, prepared_by, prepared_at,
                                  client_po_number, go_signal_date, go_signal_via, go_signal_confirmed_by, go_signal_proof_path, created_by)
  values (b, q.id, q.opportunity_id, q.customer_id, (now() at time zone 'Asia/Manila')::date, nullif(p->>'requested_delivery_date', '')::date,
          nullif(btrim(coalesce(p->>'delivery_address', '')), ''), nullif(btrim(coalesce(p->>'contact_name', '')), ''), nullif(btrim(coalesce(p->>'contact_phone', '')), ''),
          q.subtotal, q.discount_amount, q.tax_amount, q.other_charges, nullif(btrim(coalesce(p->>'notes', '')), ''), 'prepared', auth.uid(), now(),
          v_po, (p->>'go_signal_date')::date, v_via, btrim(p->>'confirmed_by'), v_proof, auth.uid())
  returning id, order_number into v_order, v_no;

  for l in select qi.*, i.item_type as cat_type, i.standard_cost from public.sales_quotation_items qi
             left join public.finance_procurement_items i on i.id = qi.catalog_item_id where qi.quotation_id = q.id order by qi.created_at, qi.id loop
    select x.fulfilment into v_f from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) as x(quotation_item_id uuid, fulfilment text) where x.quotation_item_id = l.id;
    if coalesce(l.cat_type, l.pricing_item_type) = 'service' and l.catalog_item_id is not null then v_f := 'service';
    elsif v_f is null then v_f := 'stock';
    elsif v_f not in ('stock','source') then raise exception 'Choose "from stock" or "order from supplier" for %.', l.description;
    end if;
    if v_f = 'source' then v_src := v_src + 1; end if;
    insert into public.sales_order_items(business_id, order_id, quotation_item_id, catalog_item_id, description, quantity, unit, unit_price, notes, fulfilment, estimated_unit_cost)
    values (b, v_order, l.id, l.catalog_item_id, l.description, l.quantity, l.unit, l.unit_price, l.notes, v_f, round(coalesce(l.pricing_supplier_cost, l.standard_cost, 0), 2));
  end loop;
  if not exists (select 1 from public.sales_order_items where order_id = v_order) then raise exception 'The quotation has no lines.'; end if;

  update public.sales_quotations set status = 'accepted', updated_at = now() where id = q.id and status::text <> 'accepted';
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_orders', v_order, 'order_created_from_go_signal',
          jsonb_build_object('order_number', v_no, 'quotation_number', q.quotation_number, 'client_po', v_po, 'via', v_via, 'confirmed_by', btrim(p->>'confirmed_by'),
                             'proof', v_proof is not null, 'lines_to_source', v_src));
  return jsonb_build_object('id', v_order, 'order_number', v_no, 'lines_to_source', v_src);
end $$;

-- ------------------------------ release the PR when the order is approved --
create or replace function public.sales_order_release_pr()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pr uuid; v_prno text; q record; v_cust text; l record; v_total numeric := 0;
begin
  if new.status <> 'approved' or old.status = 'approved' then return new; end if;
  if not exists (select 1 from public.sales_order_items where order_id = new.id and fulfilment = 'source') then return new; end if;
  if exists (select 1 from public.purchase_requisitions where sales_order_id = new.id) then return new; end if;
  select quotation_number into q from public.sales_quotations where id = new.quotation_id;
  select legal_name into v_cust from public.finance_customers where id = new.customer_id;
  insert into public.purchase_requisitions(business_id, requested_by, department, needed_by, purpose, notes, status, fulfillment_status,
                                           prepared_by, prepared_at, approved_by, approved_at, sales_order_id, quotation_id)
  values (new.business_id, coalesce(new.prepared_by, new.created_by), 'Sales', new.requested_delivery_date,
          'Customer order ' || new.order_number || coalesce(' (quotation ' || q.quotation_number || ')', '') || ' — ' || coalesce(v_cust, 'customer'),
          'Released automatically when the sales order was approved. Client PO: ' || coalesce(new.client_po_number, 'none (confirmation screenshot on the order)') || '.',
          'approved', 'awaiting_po', coalesce(new.prepared_by, new.created_by), now(), coalesce(auth.uid(), new.approved_by), now(), new.id, new.quotation_id)
  returning id, pr_number into v_pr, v_prno;
  for l in select * from public.sales_order_items where order_id = new.id and fulfilment = 'source' order by ctid loop
    with ins as (
      insert into public.purchase_requisition_items(business_id, requisition_id, item_id, description, quantity, unit, estimated_unit_cost, notes, sales_order_item_id)
      values (new.business_id, v_pr, l.catalog_item_id, l.description, l.quantity, l.unit, coalesce(l.estimated_unit_cost, 0), 'For ' || new.order_number, l.id)
      returning id)
    update public.sales_order_items set purchase_requisition_item_id = (select id from ins) where id = l.id;
    v_total := v_total + round(l.quantity * coalesce(l.estimated_unit_cost, 0), 2);
  end loop;
  update public.purchase_requisitions set estimated_total = v_total where id = v_pr;
  update public.sales_orders set purchase_requisition_id = v_pr where id = new.id;
  -- tell Procurement (Finance section, every workflow role) in this business
  insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
  select distinct new.business_id, ua.user_id, 'finance', 'purchase_requisitions', v_pr, 'New PR from sales order: ' || v_prno,
         'Sales order ' || new.order_number || ' was approved; the lines to order from suppliers are on ' || v_prno || ', ready for a PO.',
         '/finance/procurement?tab=pr', auth.uid()
    from public.user_access ua join public.sections s on s.id = ua.section_id join public.users u on u.id = ua.user_id
   where s.code = 'finance' and u.is_active and u.business_id = new.business_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'purchase_requisitions', v_pr, 'pr_released_from_sales_order', jsonb_build_object('pr_number', v_prno, 'order_number', new.order_number, 'estimated_total', v_total));
  return new;
end $$;
drop trigger if exists sales_orders_release_pr on public.sales_orders;
create trigger sales_orders_release_pr after update of status on public.sales_orders
  for each row execute function public.sales_order_release_pr();

-- ----------------------------------------- DOC-13: chain for this stage --
-- Sales users cannot read PRs directly; this returns the linked numbers.
create or replace function public.sales_order_chain(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.sales_doc_business(); o record;
begin
  select so.*, q.quotation_number, pr.pr_number, pr.status::text as pr_status, pr.fulfillment_status as pr_fulfilment
    into o from public.sales_orders so
    left join public.sales_quotations q on q.id = so.quotation_id
    left join public.purchase_requisitions pr on pr.id = so.purchase_requisition_id
   where so.id = p_order and so.business_id = b;
  if not found then raise exception 'Sales order not found in this business.'; end if;
  return jsonb_build_object('quotation_number', o.quotation_number, 'order_number', o.order_number, 'pr_number', o.pr_number, 'pr_status', o.pr_status,
    'pr_fulfilment', o.pr_fulfilment,
    'po_numbers', coalesce((select jsonb_agg(distinct po.po_number) from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
                              join public.purchase_requisition_items pri on pri.id = poi.source_requisition_item_id
                             where pri.requisition_id = o.purchase_requisition_id), '[]'::jsonb));
end $$;

-- confirmation screenshots (private; served with short-lived signed links)
insert into storage.buckets (id, name, public) values ('sales-go-signal', 'sales-go-signal', false) on conflict (id) do nothing;

grant execute on function public.sales_revise_quotation(uuid), public.sales_quote_order_lines(uuid), public.sales_create_order(jsonb),
  public.sales_order_chain(uuid) to authenticated;
revoke all on function public.guard_sales_quotation_number(), public.guard_sales_order(), public.sales_order_release_pr() from public, authenticated;
