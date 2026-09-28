'use server';
import { appError } from '@/core/errors/appError';

// U060 — server-side catalog search for pickers.
//
// Every catalog picker previously rendered a <select> of a pre-loaded list:
// in Finance that list was the *paginated register page* (50 rows of the
// current page/search), so once the catalog passed 50 items only products on
// the page currently displayed could be added to a PR/PO or given a pricing
// rule; in Sales/Logistics it was an unbounded query, which Supabase caps at
// 1,000 rows by default. This action searches the shared catalog in the
// database (the same GIN/trigram-backed columns the register search uses,
// CAT-06) and returns a small page, so pickers work at 10k–50k+ items.
// Session-scoped client: RLS decides who may read the catalog.

import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

export type CatalogSearchItem = {
  id: string;
  item_code: string;
  item_name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  standard_cost: number | null;
  item_type: string | null;
  service_cost_basis: number | null;
  default_supplier_id: string | null;
  active: boolean;
  /** Build 56: when the shared current cost was last updated (null = never). */
  cost_updated_at: string | null;
  /** SF-05: ITEM (generic item) and BRAND, shown in the picker results. */
  generic_item?: string | null;
  brand?: string | null;
};

const COLUMNS = 'id,item_code,item_name,description,category,unit,standard_cost,item_type,service_cost_basis,default_supplier_id,active,cost_updated_at,generic_item,brand';

/** SF-05 — optional CATEGORY / ITEM (generic item) / BRAND filters, with the
 *  same values as the catalog page filters (Build 61). */
export type CatalogSearchFilters = { category?: string | null; item?: string | null; brand?: string | null };

/** Exact, case-insensitive ilike pattern (wildcards escaped). */
const exact = (v: string) => v.replace(/[%_\\]/g, (m) => `\\${m}`);

export async function searchCatalogItemsAction(query: string, options?: { includeInactive?: boolean; limit?: number } & CatalogSearchFilters): Promise<CatalogSearchItem[]> {
  const profile = await getSessionProfile();
  if (!profile?.user.is_active) throw appError('Authentication required.');
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 50);
  const db = createClient();
  let q = db.from('finance_procurement_items').select(COLUMNS).order('item_name').limit(limit);
  if (!options?.includeInactive) q = q.eq('active', true);
  const category = String(options?.category ?? '').trim().slice(0, 200);
  const item = String(options?.item ?? '').trim().slice(0, 200);
  const brand = String(options?.brand ?? '').trim().slice(0, 200);
  if (category) q = q.eq('category', category);
  if (item) q = q.ilike('generic_item', exact(item));
  if (brand) q = q.ilike('brand', exact(brand));
  const term = String(query ?? '').trim().slice(0, 80).replace(/[%_,()]/g, ' ').trim();
  if (term) q = q.or(`item_code.ilike.%${term}%,item_name.ilike.%${term}%,category.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw appError(error.message);
  return (data ?? []) as CatalogSearchItem[];
}

/** Resolve specific items by id (to label an already-selected value). */
export async function getCatalogItemsByIdAction(ids: string[]): Promise<CatalogSearchItem[]> {
  const profile = await getSessionProfile();
  if (!profile?.user.is_active) throw appError('Authentication required.');
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 200);
  if (!unique.length) return [];
  const { data, error } = await createClient().from('finance_procurement_items').select(COLUMNS).in('id', unique);
  if (error) throw appError(error.message);
  return (data ?? []) as CatalogSearchItem[];
}

/** SF-05 — the catalog page's filter values (Build 61): active categories and
 *  the distinct ITEM / BRAND values of active items (catalog_filter_values). */
export async function getCatalogFilterOptionsAction(): Promise<{ categories: string[]; items: string[]; brands: string[] }> {
  const profile = await getSessionProfile();
  if (!profile?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const [{ data: cats, error: ce }, { data: values, error: ve }] = await Promise.all([
    db.from('finance_catalog_categories').select('name').eq('active', true).order('name'),
    db.rpc('catalog_filter_values'),
  ]);
  if (ce) throw appError(ce.message);
  if (ve) throw appError(ve.message);
  const vals = (values ?? []) as { kind: string; value: string }[];
  return {
    categories: ((cats ?? []) as { name: string }[]).map((c) => c.name),
    items: vals.filter((v) => v.kind === 'item').map((v) => v.value),
    brands: vals.filter((v) => v.kind === 'brand').map((v) => v.value),
  };
}
