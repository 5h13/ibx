// Build 61 — catalog search + filters (CATEGORY, ITEM, BRAND, SUPPLIER),
// shared by the catalog page and the CSV export so both show the same rows.

export type CatalogFilters = { q: string; category: string; item: string; brand: string; supplier: string };

const clean = (v: unknown) => String(v ?? '').trim().slice(0, 200);
/** PostgREST filter strings use , ( ) as syntax; % and _ are ilike wildcards. */
const safe = (v: string) => v.replace(/[,()]/g, ' ').replace(/[%_\\]/g, (m) => `\\${m}`).trim();

export function readCatalogFilters(sp: Record<string, string | string[] | undefined> | URLSearchParams | undefined): CatalogFilters {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : Array.isArray(sp?.[k]) ? (sp?.[k] as string[])[0] : (sp?.[k] as string | undefined));
  return { q: clean(get('catalog_q')), category: clean(get('catalog_category')), item: clean(get('catalog_item')), brand: clean(get('catalog_brand')), supplier: clean(get('catalog_supplier')) };
}

export function hasCatalogFilters(f: CatalogFilters) { return Boolean(f.q || f.category || f.item || f.brand || f.supplier); }

/** Query-string for links (paging, export) that keeps the current search + filters. */
export function catalogFilterQuery(f: CatalogFilters, extra: Record<string, string | number> = {}) {
  const u = new URLSearchParams();
  if (f.q) u.set('catalog_q', f.q);
  if (f.category) u.set('catalog_category', f.category);
  if (f.item) u.set('catalog_item', f.item);
  if (f.brand) u.set('catalog_brand', f.brand);
  if (f.supplier) u.set('catalog_supplier', f.supplier);
  for (const [k, v] of Object.entries(extra)) u.set(k, String(v));
  return u.toString();
}

/** Apply to a finance_catalog_price_list query. */
export function applyCatalogFilters<Q>(query: Q, f: CatalogFilters): Q {
  let q: any = query;
  if (f.category) q = q.eq('category', f.category);
  if (f.item) q = q.ilike('generic_item', `%${safe(f.item)}%`);
  if (f.brand) q = q.ilike('brand', `%${safe(f.brand)}%`);
  if (f.supplier === 'none') q = q.is('default_supplier_id', null);
  else if (f.supplier) q = q.eq('default_supplier_id', f.supplier);
  const t = safe(f.q);
  if (t) q = q.or(['item_name', 'item_code', 'category', 'generic_item', 'brand', 'description', 'supplier_name', 'supplier_item_code'].map((c) => `${c}.ilike.%${t}%`).join(','));
  return q as Q;
}
