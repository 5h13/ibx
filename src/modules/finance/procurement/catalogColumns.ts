// Build 60 — the catalog column layout (user-defined, 2026-09-27), shared by
// the catalog table, the CSV export, the import template and the importer.

export const CATALOG_PHOTO_BUCKET = 'catalog-photos';

export const CATALOG_COLUMNS = [
  'STANDARD ITEM NAME', 'CATEGORY', 'ITEM', 'BRAND', 'DESCRIPTION', 'Product Photo',
  'SUPPLIER', 'SUPPLIER ITEM CODE', 'Supplier Cost', 'Add on', 'Acquisition Cost',
  'STORE PRICE', '%Mark up',
] as const;

/** Map a CSV header (new layout or the older snake_case template) to a field key. */
export function normalizeCatalogHeader(h: string): string {
  const k = String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/%/g, ' percent ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const alias: Record<string, string> = {
    standard_item_name: 'item_name', item_name: 'item_name',
    category: 'category', item: 'generic_item', generic_item: 'generic_item', brand: 'brand', description: 'description',
    product_photo: 'product_photo', supplier: 'supplier', supplier_item_code: 'supplier_item_code',
    supplier_cost: 'supplier_cost', standard_cost: 'supplier_cost',
    add_on: 'add_on', acquisition_cost: 'acquisition_cost', store_price: 'store_price',
    percent_mark_up: 'markup_percent', percent_markup: 'markup_percent', mark_up: 'markup_percent', markup: 'markup_percent', markup_percent: 'markup_percent',
    unit: 'unit', item_code: 'item_code', code: 'item_code',
    specification: 'specification', specifications: 'specification', spec: 'specification', specs: 'specification',
    opening_stock: 'opening_stock', opening_qty: 'opening_stock', starting_stock: 'opening_stock', beginning_stock: 'opening_stock',
    opening_unit_cost: 'opening_cost', opening_cost: 'opening_cost',
    stock_type: 'stock_type', stock_item: 'stock_type', stocking: 'stock_type',
  };
  return alias[k] ?? k;
}

/** Columns hidden from the Finance catalog TABLE only (user request, Build 62).
 * The data is kept and still used in the form, item details, filters,
 * import, export and Product Search. */
export const CATALOG_TABLE_HIDDEN = ['CATEGORY', 'ITEM', 'BRAND', 'DESCRIPTION'] as const;
export const CATALOG_TABLE_COLUMNS = CATALOG_COLUMNS.filter((c) => !(CATALOG_TABLE_HIDDEN as readonly string[]).includes(c));

/** Build 76 — extra columns of the full-catalog upload / export, after the
 * catalog layout: the item code (matches the row to the item, so a cleaned-up
 * name still updates the same item), unit, specification and the opening
 * stock (LOG-46) with an optional unit cost (default: Supplier Cost). */
// Build 79 (CAT-38): STOCK TYPE = Stock / Order only (blank: Stock for a new item, unchanged for an existing one).
export const CATALOG_UPLOAD_EXTRA = ['Item Code', 'Unit', 'SPECIFICATION', 'OPENING STOCK', 'OPENING UNIT COST', 'STOCK TYPE'] as const;
