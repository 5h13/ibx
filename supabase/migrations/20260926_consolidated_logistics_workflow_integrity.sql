-- 5H13 ERP consolidated implementation: logistics workflow + stock ledger integrity.
-- Additive migration; prior migrations are intentionally untouched.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='entry_status' AND e.enumlabel='posted') THEN
    ALTER TYPE public.entry_status ADD VALUE 'posted';
  END IF;
END $$;

-- Stock movement numbering is system controlled.
CREATE OR REPLACE FUNCTION public.next_stock_movement_number()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('STM:'||to_char(current_date,'YYYY')));
  SELECT coalesce(max(substring(movement_number from 10)::bigint),0)+1 INTO n
  FROM public.logistics_stock_movements
  WHERE movement_number ~ ('^STM-'||to_char(current_date,'YYYY')||'-[0-9]{4,}$');
  RETURN 'STM-'||to_char(current_date,'YYYY')||'-'||lpad(n::text,4,'0');
END $$;

ALTER TABLE public.logistics_stock_movements
  ALTER COLUMN movement_number SET DEFAULT public.next_stock_movement_number();

CREATE OR REPLACE FUNCTION public.guard_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.movement_number := public.next_stock_movement_number();
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.movement_number IS DISTINCT FROM OLD.movement_number OR
    NEW.inventory_item_id IS DISTINCT FROM OLD.inventory_item_id OR
    NEW.location_id IS DISTINCT FROM OLD.location_id OR
    NEW.quantity IS DISTINCT FROM OLD.quantity OR
    NEW.movement_type IS DISTINCT FROM OLD.movement_type OR
    NEW.source_table IS DISTINCT FROM OLD.source_table OR
    NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
  ) THEN
    RAISE EXCEPTION 'Posted stock movements are immutable; create an authorized correcting movement.';
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Posted stock movements cannot be deleted; create an authorized correcting movement.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS logistics_stock_movement_guard ON public.logistics_stock_movements;
CREATE TRIGGER logistics_stock_movement_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.logistics_stock_movements
FOR EACH ROW EXECUTE FUNCTION public.guard_stock_movement();

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movement_source_line
ON public.logistics_stock_movements(source_table, source_record_id, inventory_item_id, location_id, movement_type)
WHERE source_table IS NOT NULL AND source_record_id IS NOT NULL;

-- Posted receiving creates ledger entries exactly once and only from approved receipts.
CREATE OR REPLACE FUNCTION public.post_receipt_to_stock(p_receipt_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; l record;
BEGIN
  SELECT * INTO r FROM public.logistics_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found.'; END IF;
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

-- Posted transfer validates source availability and creates paired OUT/IN movements atomically.
CREATE OR REPLACE FUNCTION public.post_transfer_to_stock(p_transfer_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record; l record; v_balance numeric;
BEGIN
  SELECT * INTO t FROM public.logistics_stock_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found.'; END IF;
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

-- Read model for operational stock balances. Costs remain in the ledger for Finance/Procurement,
-- while Logistics screens can use quantity-only columns.
CREATE OR REPLACE VIEW public.logistics_stock_balance AS
SELECT
  sm.inventory_item_id,
  sm.location_id,
  COALESCE(SUM(CASE WHEN sm.movement_type IN ('receipt','transfer_in','adjustment') THEN sm.quantity ELSE 0 END),0) AS total_in,
  COALESCE(SUM(CASE WHEN sm.movement_type IN ('issue','transfer_out') THEN sm.quantity ELSE 0 END),0) AS total_out,
  COALESCE(SUM(CASE WHEN sm.movement_type IN ('receipt','transfer_in','adjustment') THEN sm.quantity ELSE -sm.quantity END),0) AS on_hand
FROM public.logistics_stock_movements sm
GROUP BY sm.inventory_item_id, sm.location_id;

-- Operational view exposing quantity states without exposing acquisition cost.
CREATE OR REPLACE VIEW public.logistics_inventory_status AS
SELECT
  i.id AS inventory_item_id,
  i.item_code,
  i.item_name,
  i.unit,
  i.reorder_level,
  l.id AS location_id,
  l.location_code,
  l.location_name,
  COALESCE(b.on_hand,0) AS on_hand,
  GREATEST(COALESCE(b.on_hand,0)-i.reorder_level,0) AS above_reorder,
  CASE WHEN COALESCE(b.on_hand,0) <= 0 THEN 'out_of_stock'
       WHEN COALESCE(b.on_hand,0) <= i.reorder_level THEN 'low_stock'
       ELSE 'in_stock' END AS stock_status
FROM public.logistics_inventory_items i
CROSS JOIN public.logistics_locations l
LEFT JOIN public.logistics_stock_balance b ON b.inventory_item_id=i.id AND b.location_id=l.id
WHERE i.active AND l.active;

-- Prevent receipt posting from creating inventory when line quantities are invalid.
ALTER TABLE public.logistics_receipt_items
  DROP CONSTRAINT IF EXISTS logistics_receipt_items_quantity_positive;
ALTER TABLE public.logistics_receipt_items
  ADD CONSTRAINT logistics_receipt_items_quantity_positive CHECK (quantity > 0);

-- Transfers must use active locations.
CREATE OR REPLACE FUNCTION public.guard_transfer_locations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a boolean; b boolean;
BEGIN
  SELECT active INTO a FROM public.logistics_locations WHERE id=NEW.from_location_id;
  SELECT active INTO b FROM public.logistics_locations WHERE id=NEW.to_location_id;
  IF COALESCE(a,false)=false OR COALESCE(b,false)=false THEN RAISE EXCEPTION 'Transfer locations must be active.'; END IF;
  IF NEW.from_location_id=NEW.to_location_id THEN RAISE EXCEPTION 'Source and destination locations must differ.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS logistics_transfer_location_guard ON public.logistics_stock_transfers;
CREATE TRIGGER logistics_transfer_location_guard BEFORE INSERT OR UPDATE ON public.logistics_stock_transfers FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_locations();


-- Keep the RPC entry points callable only by the server-side service role.
REVOKE ALL ON FUNCTION public.post_receipt_to_stock(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_receipt_to_stock(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.post_transfer_to_stock(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_transfer_to_stock(uuid, uuid) TO service_role;

-- Procurement lifecycle metadata: approval is not the same as supplier issuance.
ALTER TABLE public.purchase_requisitions
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'awaiting_po';
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS issuance_status text NOT NULL DEFAULT 'draft';
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES public.users(id);

ALTER TABLE public.purchase_requisitions
  DROP CONSTRAINT IF EXISTS purchase_requisitions_fulfillment_status_check;
ALTER TABLE public.purchase_requisitions
  ADD CONSTRAINT purchase_requisitions_fulfillment_status_check
  CHECK (fulfillment_status IN ('awaiting_po','partially_ordered','fully_ordered','closed','cancelled'));
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_issuance_status_check;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_issuance_status_check
  CHECK (issuance_status IN ('draft','issued','acknowledged','closed','cancelled'));

CREATE OR REPLACE FUNCTION public.issue_purchase_order(p_po_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.purchase_orders WHERE id=p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found.'; END IF;
  IF p.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved purchase order may be issued.'; END IF;
  IF p.issuance_status='issued' THEN RETURN; END IF;
  UPDATE public.purchase_orders
  SET issuance_status='issued', issued_at=now(), issued_by=p_actor, updated_at=now()
  WHERE id=p.id;
END $$;
REVOKE ALL ON FUNCTION public.issue_purchase_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_purchase_order(uuid, uuid) TO service_role;
