-- Build 31: controlled approved-PR -> PO conversion and line traceability
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS source_requisition_item_id uuid REFERENCES public.purchase_requisition_items(id);

CREATE INDEX IF NOT EXISTS idx_po_items_source_pr_item
  ON public.purchase_order_items(source_requisition_item_id);

CREATE OR REPLACE FUNCTION public.guard_po_source_pr_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pr_status public.entry_status;
BEGIN
  IF NEW.source_requisition_item_id IS NOT NULL THEN
    SELECT pr.status INTO pr_status
    FROM public.purchase_requisition_items pri
    JOIN public.purchase_requisitions pr ON pr.id=pri.requisition_id
    WHERE pri.id=NEW.source_requisition_item_id;
    IF pr_status IS NULL THEN RAISE EXCEPTION 'Source purchase requisition line was not found.'; END IF;
    IF pr_status <> 'approved' THEN RAISE EXCEPTION 'PO lines may only be converted from an approved purchase requisition.'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS purchase_order_source_pr_item_guard ON public.purchase_order_items;
CREATE TRIGGER purchase_order_source_pr_item_guard
BEFORE INSERT OR UPDATE ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_po_source_pr_item();

-- An approved PR line may be converted into multiple POs, but the source is always retained.
CREATE INDEX IF NOT EXISTS idx_po_requisition ON public.purchase_orders(requisition_id);
