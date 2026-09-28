-- 5H13 ERP consolidated implementation: transfer/ledger controls.
-- Additive migration; existing migrations are untouched.

-- Transfer lines must reference active catalog-linked inventory items and positive quantities.
CREATE OR REPLACE FUNCTION public.guard_transfer_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE active_item boolean; same_business boolean;
BEGIN
  SELECT active INTO active_item
  FROM public.logistics_inventory_items WHERE id=NEW.inventory_item_id;
  IF COALESCE(active_item,false)=false THEN
    RAISE EXCEPTION 'Transfer item must be an active inventory item.';
  END IF;
  IF NEW.quantity <= 0 THEN RAISE EXCEPTION 'Transfer quantity must be greater than zero.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS logistics_transfer_item_guard ON public.logistics_stock_transfer_items;
CREATE TRIGGER logistics_transfer_item_guard
BEFORE INSERT OR UPDATE ON public.logistics_stock_transfer_items
FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_item();

-- Prevent changes to a transfer after posting; corrections must be represented by new controlled movements.
CREATE OR REPLACE FUNCTION public.guard_posted_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='posted' AND (
    NEW.from_location_id IS DISTINCT FROM OLD.from_location_id OR
    NEW.to_location_id IS DISTINCT FROM OLD.to_location_id OR
    NEW.transfer_date IS DISTINCT FROM OLD.transfer_date OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'Posted transfers are immutable.';
  END IF;
  IF TG_OP='DELETE' AND OLD.status='posted' THEN
    RAISE EXCEPTION 'Posted transfers cannot be deleted.';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS logistics_posted_transfer_guard ON public.logistics_stock_transfers;
CREATE TRIGGER logistics_posted_transfer_guard
BEFORE UPDATE OR DELETE ON public.logistics_stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.guard_posted_transfer();

-- A quantity-only running ledger view. Unit cost is intentionally retained only in the base ledger.
CREATE OR REPLACE VIEW public.logistics_stock_ledger_running AS
SELECT
  sm.id,
  sm.movement_number,
  sm.inventory_item_id,
  sm.location_id,
  sm.movement_date,
  sm.movement_type,
  sm.quantity,
  sm.source_table,
  sm.source_record_id,
  sm.reference_number,
  sm.notes,
  sm.created_by,
  sm.created_at,
  SUM(CASE WHEN sm.movement_type IN ('receipt','transfer_in','adjustment') THEN sm.quantity ELSE -sm.quantity END)
    OVER (PARTITION BY sm.inventory_item_id, sm.location_id ORDER BY sm.movement_date, sm.created_at, sm.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
FROM public.logistics_stock_movements sm;

CREATE INDEX IF NOT EXISTS idx_logistics_movements_reference
ON public.logistics_stock_movements(reference_number, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_logistics_transfer_items_transfer
ON public.logistics_stock_transfer_items(transfer_id, inventory_item_id);

-- Preserve receiving lot/batch identity in the movement ledger for traceability.
ALTER TABLE public.logistics_stock_movements
  ADD COLUMN IF NOT EXISTS lot_number text;

CREATE INDEX IF NOT EXISTS idx_logistics_movements_lot
ON public.logistics_stock_movements(lot_number, inventory_item_id, location_id);

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
      unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_number
    ) VALUES (
      l.inventory_item_id, r.location_id, r.receipt_date, 'receipt', l.quantity,
      l.unit_cost, 'logistics_receipts', r.id, r.receipt_number, l.description, p_actor, l.lot_number
    ) ON CONFLICT (source_table, source_record_id, inventory_item_id, location_id, movement_type) WHERE source_table IS NOT NULL AND source_record_id IS NOT NULL DO NOTHING;
  END LOOP;
  UPDATE public.logistics_receipts SET status='posted', posted_at=now(), updated_at=now() WHERE id=r.id AND status='approved';
END $$;
REVOKE ALL ON FUNCTION public.post_receipt_to_stock(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_receipt_to_stock(uuid, uuid) TO service_role;
