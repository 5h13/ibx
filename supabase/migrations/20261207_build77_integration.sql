-- ============================================================================
-- Build 77 integration: with LOG-10 (20261203) a receipt line records
-- delivered / accepted / damaged / rejected quantities and only ACCEPTED
-- goes into stock, so an order's supplier line counts as received only for
-- the accepted quantity.
-- ============================================================================
create or replace function public.sf_order_line_received(p_order_item uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(least(poi.quantity, coalesce((
           select sum(coalesce(ri.accepted_qty, ri.quantity)) from public.logistics_receipts r
             join public.logistics_receipt_items ri on ri.receipt_id = r.id
             join public.logistics_inventory_items inv on inv.id = ri.inventory_item_id
            where r.purchase_order_id = poi.purchase_order_id and r.status = 'posted' and inv.procurement_item_id = poi.item_id), 0))), 0)
    from public.sales_order_items soi
    join public.purchase_order_items poi on poi.source_requisition_item_id = soi.purchase_requisition_item_id
   where soi.id = p_order_item and soi.purchase_requisition_item_id is not null;
$$;
revoke all on function public.sf_order_line_received(uuid) from public, authenticated;
