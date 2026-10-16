-- Build 114 — order DR window: why nothing can be delivered yet, and a way out when the goods are on hand.
--
-- 1. storefront_orders(): each "order from supplier" line now carries its PO (number, approval and
--    issuance status), and the order its PR status, so the DR window can say what it is waiting for.
-- 2. storefront_order_line_to_stock(): a Sales approver or Business Admin may switch an approved
--    order's "order from supplier" line to "from stock" while no PO has been made for it and nothing
--    of it was delivered. The line leaves the PR (a PR left with no lines is marked cancelled), the
--    order line then reserves stock like any "from stock" line, and the change is in the audit log.

create or replace function public.storefront_orders(p_include_done boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); loc uuid;
begin
  if not public.can_view_storefront() then raise exception 'Storefront access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select location_id into loc from public.storefront_settings where business_id = b;
  return coalesce((
    select jsonb_agg(x.o order by x.d desc) from (
      select so.order_date as d, jsonb_build_object(
        'id', so.id, 'order_number', so.order_number, 'order_date', so.order_date, 'status', so.status, 'quotation_number', q.quotation_number,
        'customer_id', so.customer_id, 'customer', c.legal_name, 'client_po', so.client_po_number, 'payment_terms', so.payment_terms,
        'vat_applied', so.vat_applied, 'total', so.total_amount, 'delivery_address', so.delivery_address, 'requested_delivery_date', so.requested_delivery_date,
        'pr_number', pr.pr_number, 'pr_status', pr.status::text, 'pr_fulfilment', pr.fulfillment_status,
        'po_numbers', coalesce((select jsonb_agg(distinct po.po_number) from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
                                  join public.purchase_requisition_items pri on pri.id = poi.source_requisition_item_id where pri.requisition_id = so.purchase_requisition_id), '[]'::jsonb),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', soi.id, 'description', soi.description, 'unit', soi.unit, 'ordered', soi.quantity, 'unit_price', soi.unit_price, 'fulfilment', soi.fulfilment,
                   'catalog_item_id', soi.catalog_item_id, 'delivered', dl.delivered, 'released', dl.released,
                   'pr_line', soi.purchase_requisition_item_id is not null,
                   'po', (select jsonb_build_object('po_number', po.po_number, 'status', po.status::text, 'issuance_status', po.issuance_status)
                            from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
                           where soi.purchase_requisition_item_id is not null and poi.source_requisition_item_id = soi.purchase_requisition_item_id
                             and po.status::text <> 'voided' order by po.created_at desc limit 1),
                   'received', case when soi.fulfilment = 'source' then public.sf_order_line_received(soi.id) end,
                   'on_hand', case when soi.catalog_item_id is null or soi.fulfilment = 'service' then null else public.q77_on_hand(b, soi.catalog_item_id, loc) end,
                   'reserved_here', case when soi.fulfilment = 'stock' then greatest(soi.quantity - dl.released, 0) else 0 end,
                   'reserved_total', case when soi.catalog_item_id is null or soi.fulfilment = 'service' then null else public.inventory_reserved(b, soi.catalog_item_id) end,
                   'default_lot_id', case when inv.id is null or loc is null then null else public.sf_line_lot(b, inv.id, loc, null, soi.id) end,
                   'lots', case when inv.id is null or loc is null then '[]'::jsonb else public.sf_lot_options(b, inv.id, loc) end
                 ) order by soi.ctid)
                 from public.sales_order_items soi
                 cross join lateral public.sf_order_line_delivered(soi.id) dl
                 left join lateral (select ii.id from public.logistics_inventory_items ii
                                     where ii.business_id = b and ii.procurement_item_id = soi.catalog_item_id and soi.fulfilment <> 'service' limit 1) inv on true
                where soi.order_id = so.id), '[]'::jsonb),
        'drs', coalesce((select jsonb_agg(jsonb_build_object('sale_id', s.id, 'sale_number', s.sale_number, 'dr_number', s.dr_number, 'si_number', s.si_number,
                   'sale_date', s.sale_date, 'total', s.total, 'release_status', s.release_status, 'released_at', s.released_at, 'hardcopy_dr_no', s.hardcopy_dr_no,
                   'invoice_number', inv.invoice_number, 'invoice_status', inv.status, 'balance_due', inv.balance_due, 'due_date', inv.due_date) order by s.created_at)
                 from public.storefront_sales s left join public.finance_customer_invoices inv on inv.id = s.ar_invoice_id
                where s.sales_order_id = so.id and s.status = 'completed'), '[]'::jsonb)
      ) as o
      from public.sales_orders so
      join public.finance_customers c on c.id = so.customer_id
      left join public.sales_quotations q on q.id = so.quotation_id
      left join public.purchase_requisitions pr on pr.id = so.purchase_requisition_id
     where so.business_id = b and so.status::text in ('approved','processing') or (so.business_id = b and p_include_done and so.status::text = 'fulfilled')
    ) x), '[]'::jsonb);
end $$;

create or replace function public.storefront_order_line_to_stock(p_line uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); l record; v_pr uuid; v_left int; v_prno text;
begin
  if not public.can_approve_storefront() then
    raise exception 'Only a Sales approver, a Business Admin or the Super Admin can switch an order line to stock.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the line is switched to stock (e.g. the goods are on hand).'; end if;
  select soi.*, so.order_number, so.status::text as order_status, so.business_id as biz, so.purchase_requisition_id as pr_id
    into l from public.sales_order_items soi join public.sales_orders so on so.id = soi.order_id
   where soi.id = p_line for update of soi;
  if not found or l.biz is distinct from b then raise exception 'Order line not found in this store.'; end if;
  if l.order_status not in ('approved', 'processing') then raise exception 'Only a line of an approved order can be switched.'; end if;
  if l.fulfilment <> 'source' then raise exception 'This line is already supplied from stock.'; end if;
  if (select delivered from public.sf_order_line_delivered(l.id)) > 0 then raise exception 'Part of this line was already delivered; it cannot be switched.'; end if;
  if l.purchase_requisition_item_id is not null and exists (
       select 1 from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
        where poi.source_requisition_item_id = l.purchase_requisition_item_id and po.status::text <> 'voided') then
    raise exception 'A purchase order was already made for this line; cancel or void the PO line first.';
  end if;
  v_pr := (select requisition_id from public.purchase_requisition_items where id = l.purchase_requisition_item_id);
  update public.sales_order_items set fulfilment = 'stock', purchase_requisition_item_id = null where id = l.id;
  if l.purchase_requisition_item_id is not null then
    delete from public.purchase_requisition_items where id = l.purchase_requisition_item_id;
    select count(*) into v_left from public.purchase_requisition_items where requisition_id = v_pr;
    update public.purchase_requisitions
       set estimated_total = (select coalesce(sum(round(quantity * coalesce(estimated_unit_cost, 0), 2)), 0) from public.purchase_requisition_items where requisition_id = v_pr),
           fulfillment_status = case when v_left = 0 then 'cancelled' else fulfillment_status end,
           notes = coalesce(notes || ' ', '') || case when v_left = 0 then '[Cancelled: every line was switched to stock on ' || l.order_number || '.]' else '[A line was switched to stock on ' || l.order_number || '.]' end,
           updated_at = now()
     where id = v_pr
    returning pr_number into v_prno;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_order_items', l.id, 'order_line_switched_to_stock',
          jsonb_build_object('order_number', l.order_number, 'description', l.description, 'quantity', l.quantity, 'pr_number', v_prno,
                             'pr_cancelled', coalesce(v_left, 1) = 0, 'reason', btrim(p_reason)));
  return jsonb_build_object('order_number', l.order_number, 'pr_number', v_prno, 'pr_cancelled', coalesce(v_left, 1) = 0);
end $$;
revoke all on function public.storefront_order_line_to_stock(uuid, text) from public;
grant execute on function public.storefront_order_line_to_stock(uuid, text) to authenticated;
