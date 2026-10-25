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
// Build 141 (owner, 2026-10-25): the specification is SPEC 1 … SPEC 10, one "Label: Value" per cell (what the Studio,
// the shop and the search filters read). Older files with one SPECIFICATION column still import.
export const SPEC_COLUMN_COUNT = 10;
export const SPEC_COLUMNS = Array.from({ length: SPEC_COLUMN_COUNT }, (_, i) => `SPEC ${i + 1}`);
export const CATALOG_UPLOAD_EXTRA = ['Item Code', 'Unit', ...SPEC_COLUMNS, 'OPENING STOCK', 'OPENING UNIT COST', 'STOCK TYPE'] as const;

/** The item's specification (one line per spec) → the SPEC 1 … SPEC 10 cells; lines past the 10th stay together in
 * SPEC 10 (one per line in the cell), so nothing is lost when the file is imported again. */
export function specCells(specification: string | null | undefined): string[] {
  const lines = String(specification ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = lines.slice(0, SPEC_COLUMN_COUNT - 1);
  const rest = lines.slice(SPEC_COLUMN_COUNT - 1);
  if (rest.length) out.push(rest.join('\n'));
  while (out.length < SPEC_COLUMN_COUNT) out.push('');
  return out;
}

/** SPEC 1 … SPEC n cells → the item's specification (one line per spec), and the cells not written as "Label: Value". */
export function specFromCells(cells: string[]): { text: string; bad: { col: number; value: string }[] } {
  const lines: string[] = []; const bad: { col: number; value: string }[] = [];
  cells.forEach((cell, i) => {
    for (const raw of String(cell ?? '').split(/\r?\n/)) {
      const l = raw.trim().replace(/\s+/g, ' ');
      if (!l) continue;
      const k = l.indexOf(':');
      if (k <= 0 || !l.slice(k + 1).trim()) { bad.push({ col: i + 1, value: l }); continue; }
      lines.push(`${l.slice(0, k).trim()}: ${l.slice(k + 1).trim()}`);
    }
  });
  return { text: lines.join('\n'), bad };
}
