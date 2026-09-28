-- Fix: post_receipt_to_stock / post_transfer_to_stock were REVOKEd from
-- authenticated and GRANTed to service_role only (20260926 / 20261003), but
-- postReceiptAction/postTransferAction in src/modules/logistics/inventoryActions.ts
-- call them through the session-scoped (RLS-enforced, anon-key) Supabase
-- client, which has no service_role privileges. A logged-in logistics user
-- therefore cannot post a receipt or transfer at all today -- "posting"
-- fails with a permission-denied error despite the underlying SQL logic
-- being correct. Found during Build 49's audit of LOG-09/11/14/28/29/30.
--
-- Fix: grant EXECUTE to authenticated (the app-layer logistics() role/section
-- gate already runs before either action calls the RPC, matching how every
-- other server-side workflow function in this codebase is invoked). Since
-- both functions are SECURITY DEFINER and therefore bypass RLS internally,
-- add an explicit business-isolation check inside each function itself --
-- otherwise granting broad EXECUTE would let any authenticated logistics
-- user post another business's receipt/transfer by id, which the app's
-- session-scoped SELECT calls elsewhere never exposed as a real risk only
-- because RLS was in the path for reads, not because these RPCs were safe.

CREATE OR REPLACE FUNCTION public.post_receipt_to_stock(p_receipt_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; l record;
BEGIN
  SELECT * INTO r FROM public.logistics_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found.'; END IF;
  IF NOT public.is_super_admin() AND r.business_id IS DISTINCT FROM public.current_business_id() THEN
    RAISE EXCEPTION 'Receipt does not belong to your business.';
  END IF;
  IF r.status='posted' THEN RETURN; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'Receipt must be approved before posting.'; END IF;

  FOR l IN SELECT * FROM public.logistics_receipt_items WHERE receipt_id=r.id LOOP
    INSERT INTO public.logistics_stock_movements(
      inventory_item_id, location_id, movement_date, movement_type, quantity,
      unit_cost, source_table, source_record_id, reference_number, notes, created_by
    ) VALUES (
      l.inventory_item_id, r.location_id, r.receipt_date, 'receipt', l.quantity,
      l.unit_cost, 'logistics_receipts', r.id, r.receipt_number, l.description, p_actor
    ) ON CONFLICT (source_table, source_record_id, inventory_item_id, location_id, movement_type) WHERE source_table IS NOT NULL AND source_record_id IS NOT NULL DO NOTHING;
  END LOOP;

  UPDATE public.logistics_receipts
  SET status='posted', posted_at=now(), updated_at=now()
  WHERE id=r.id AND status='approved';
END $$;

CREATE OR REPLACE FUNCTION public.post_transfer_to_stock(p_transfer_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record; l record; v_balance numeric;
BEGIN
  SELECT * INTO t FROM public.logistics_stock_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
  IF NOT public.is_super_admin() AND t.business_id IS DISTINCT FROM public.current_business_id() THEN
    RAISE EXCEPTION 'Transfer does not belong to your business.';
  END IF;
  IF t.status='posted' THEN RETURN; END IF;
  IF t.status <> 'approved' THEN RAISE EXCEPTION 'Transfer must be approved before posting.'; END IF;

  FOR l IN SELECT * FROM public.logistics_stock_transfer_items WHERE transfer_id=t.id LOOP
    SELECT COALESCE(SUM(CASE WHEN sm.location_id=t.from_location_id AND sm.movement_type IN ('receipt','transfer_in','adjustment') THEN sm.quantity
                             WHEN sm.location_id=t.from_location_id AND sm.movement_type IN ('issue','transfer_out') THEN -sm.quantity ELSE 0 END),0)
      INTO v_balance
    FROM public.logistics_stock_movements sm
    WHERE sm.inventory_item_id=l.inventory_item_id;
    IF v_balance < l.quantity THEN
      RAISE EXCEPTION 'Insufficient available stock for transfer item % (requested %, available %).', l.inventory_item_id, l.quantity, v_balance;
    END IF;

    INSERT INTO public.logistics_stock_movements(inventory_item_id,location_id,movement_date,movement_type,quantity,unit_cost,source_table,source_record_id,reference_number,notes,created_by)
    VALUES(l.inventory_item_id,t.from_location_id,t.transfer_date,'transfer_out',l.quantity,0,'logistics_stock_transfers',t.id,t.transfer_number,l.notes,p_actor)
    ON CONFLICT (source_table, source_record_id, inventory_item_id, location_id, movement_type) WHERE source_table IS NOT NULL AND source_record_id IS NOT NULL DO NOTHING;
    INSERT INTO public.logistics_stock_movements(inventory_item_id,location_id,movement_date,movement_type,quantity,unit_cost,source_table,source_record_id,reference_number,notes,created_by)
    VALUES(l.inventory_item_id,t.to_location_id,t.transfer_date,'transfer_in',l.quantity,0,'logistics_stock_transfers',t.id,t.transfer_number,l.notes,p_actor)
    ON CONFLICT (source_table, source_record_id, inventory_item_id, location_id, movement_type) WHERE source_table IS NOT NULL AND source_record_id IS NOT NULL DO NOTHING;
  END LOOP;

  UPDATE public.logistics_stock_transfers SET status='posted', posted_at=now(), updated_at=now() WHERE id=t.id AND status='approved';
END $$;

REVOKE ALL ON FUNCTION public.post_receipt_to_stock(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_receipt_to_stock(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_transfer_to_stock(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_transfer_to_stock(uuid, uuid) TO authenticated, service_role;

-- Same bug, same fix, for PO issuance: issuePurchaseOrderAction
-- (src/modules/finance/procurement/actions.ts) also calls this RPC through
-- the session-scoped client, so issuing a PO has been failing the same way
-- since 20261021_po13_po08_issuance_and_receiving_gate.sql shipped. This
-- means PO-08/PO-09/PO-13, previously marked Verified Closed in Build 42,
-- were never actually reachable in the live app -- flagged separately in
-- the punchlist rather than silently left as "Verified Closed."
CREATE OR REPLACE FUNCTION public.issue_purchase_order(p_po_id uuid, p_actor uuid, p_method text default null)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.purchase_orders WHERE id=p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found.'; END IF;
  IF NOT public.is_super_admin() AND p.business_id IS DISTINCT FROM public.current_business_id() THEN
    RAISE EXCEPTION 'Purchase order does not belong to your business.';
  END IF;
  IF p.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved purchase order may be issued.'; END IF;
  IF p.issuance_status='issued' THEN RETURN; END IF;
  IF p_method IS NULL OR length(trim(p_method))=0 THEN RAISE EXCEPTION 'Issuance method is required (e.g. email, courier, supplier portal, hand delivered).'; END IF;
  UPDATE public.purchase_orders
  SET issuance_status='issued', issued_at=now(), issued_by=p_actor, issuance_method=p_method, updated_at=now()
  WHERE id=p.id;
END $$;
REVOKE ALL ON FUNCTION public.issue_purchase_order(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_purchase_order(uuid, uuid, text) TO authenticated, service_role;
