-- Consolidated implementation: operational inventory integrity.
-- Additive migration; existing migrations are untouched.

-- Quantity-only operational read model uses location-specific reorder settings.
-- (The 2026-09-26 migration defined this view with item-level reorder_level
-- at column position 5; CREATE OR REPLACE VIEW cannot rename/reorder an
-- existing column, only append new trailing ones, so we drop and recreate.)
DROP VIEW IF EXISTS public.logistics_inventory_status;
CREATE VIEW public.logistics_inventory_status AS
SELECT
  i.id AS inventory_item_id,
  i.item_code,
  i.item_name,
  i.unit,
  l.id AS location_id,
  l.location_code,
  l.location_name,
  COALESCE(b.on_hand,0) AS on_hand,
  COALESCE(s.reorder_level,0) AS reorder_level,
  GREATEST(COALESCE(b.on_hand,0)-COALESCE(s.reorder_level,0),0) AS above_reorder,
  CASE WHEN COALESCE(b.on_hand,0) <= 0 THEN 'out_of_stock'
       WHEN COALESCE(b.on_hand,0) <= COALESCE(s.reorder_level,0) AND COALESCE(s.reorder_level,0) > 0 THEN 'low_stock'
       ELSE 'in_stock' END AS stock_status
FROM public.logistics_inventory_items i
CROSS JOIN public.logistics_locations l
LEFT JOIN public.logistics_stock_balance b
  ON b.inventory_item_id=i.id AND b.location_id=l.id
LEFT JOIN public.logistics_inventory_location_settings s
  ON s.inventory_item_id=i.id AND s.location_id=l.id AND s.active
WHERE i.active AND l.active;

-- Explicitly document that physical inventory quantity is movement-derived.
CREATE OR REPLACE FUNCTION public.guard_inventory_quantity_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.procurement_item_id IS DISTINCT FROM OLD.procurement_item_id OR
    NEW.item_code IS DISTINCT FROM OLD.item_code OR
    NEW.item_name IS DISTINCT FROM OLD.item_name
  ) THEN
    RAISE EXCEPTION 'Inventory identity is catalog-controlled; change the Product/Inventory reference through the authorized catalog workflow.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS logistics_inventory_identity_guard ON public.logistics_inventory_items;
CREATE TRIGGER logistics_inventory_identity_guard
BEFORE UPDATE ON public.logistics_inventory_items
FOR EACH ROW EXECUTE FUNCTION public.guard_inventory_quantity_mutation();

-- Reject malformed UUIDs before any inventory lookup can reach a raw PostgreSQL UUID cast error.
CREATE OR REPLACE FUNCTION public.validate_logistics_inventory_uuid(p_value text, p_label text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value)='' THEN RAISE EXCEPTION '% is required.', p_label; END IF;
  RETURN p_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION '% must be a valid UUID.', p_label;
END $$;
