// Build 136 — public online shop: reads through the shop_* database functions only (no login needed).
// Photos stay private in storage; the page gets short-lived links to them.
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';

export type ShopStore = { slug: string; code: string; name: string; logo_url: string | null; theme: unknown; phone: string | null; email: string | null; address: string | null;
  messenger_url: string | null; viber_number: string | null; tagline: string | null };
export type ShopRow = { item_id: string; item_name: string; category: string | null; generic_item: string | null; brand: string | null; unit: string | null;
  photo_path: string | null; price: number | null; total_count: number; photo_url?: string | null };
export type ShopItem = { id: string; name: string; category: string | null; generic_item: string | null; brand: string | null; unit: string | null;
  description: string | null; specification: string | null; item_type: string | null; photos: string[]; price: number | null; photo_urls?: string[] };

export const PAGE_SIZE = 24;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) { console.error(`[shop] ${fn}: ${error.message}`); return null; }
  return data as T;
}

export async function signPhotos(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(paths.filter(Boolean)));
  if (!uniq.length) return out;
  const { data } = await createAdminClient().storage.from('catalog-photos').createSignedUrls(uniq, 3600);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

export const loadStore = (slug: string) => rpc<ShopStore>('shop_store', { p_slug: slug });
export const loadShops = async () => (await rpc<{ slug: string; name: string; logo_url: string | null; tagline: string | null }[]>('shop_list', {})) ?? [];
export const loadFilters = async (slug: string, f: { category?: string; item?: string; brand?: string }) =>
  (await rpc<{ categories: string[]; items: string[]; brands: string[] }>('shop_filters', { p_slug: slug, p_category: f.category || null, p_item: f.item || null, p_brand: f.brand || null }))
  ?? { categories: [], items: [], brands: [] };

export async function loadCatalog(slug: string, f: { q?: string; category?: string; item?: string; brand?: string; page?: number }) {
  const page = Math.max(1, f.page ?? 1);
  const rows = (await rpc<ShopRow[]>('shop_catalog', {
    p_slug: slug, p_q: f.q?.trim() || null, p_category: f.category || null, p_item: f.item || null, p_brand: f.brand || null,
    p_limit: PAGE_SIZE * page, p_offset: 0,
  })) ?? [];
  const urls = await signPhotos(rows.map((r) => r.photo_path ?? ''));
  return { rows: rows.map((r) => ({ ...r, photo_url: r.photo_path ? urls.get(r.photo_path) ?? null : null })), total: Number(rows[0]?.total_count ?? 0), page };
}

/** Build 136b: the front page — each category with its first products and its full count. */
export async function loadGroups(slug: string, per = 8) {
  const rows = (await rpc<{ category: string; item_id: string; item_name: string; brand: string | null; unit: string | null; photo_path: string | null; price: number | null; category_count: number }[]>(
    'shop_catalog_by_category', { p_slug: slug, p_per: per })) ?? [];
  const urls = await signPhotos(rows.map((r) => r.photo_path ?? ''));
  const groups: { category: string; count: number; rows: ShopRow[] }[] = [];
  for (const r of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.category !== r.category) { g = { category: r.category, count: Number(r.category_count), rows: [] }; groups.push(g); }
    g.rows.push({ item_id: r.item_id, item_name: r.item_name, category: r.category, generic_item: null, brand: r.brand, unit: r.unit, photo_path: r.photo_path,
      price: r.price, total_count: Number(r.category_count), photo_url: r.photo_path ? urls.get(r.photo_path) ?? null : null });
  }
  return groups;
}

export async function loadItem(slug: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const item = await rpc<ShopItem>('shop_item', { p_slug: slug, p_item: id });
  if (!item) return null;
  const urls = await signPhotos(item.photos ?? []);
  return { ...item, photo_urls: (item.photos ?? []).map((p) => urls.get(p)).filter((x): x is string => !!x) };
}

export const pesoShop = (n: number | null | undefined) => (n == null ? null : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** +63 form for Viber links. */
export function viberIntl(n: string | null | undefined) {
  if (!n) return null;
  const d = n.replace(/[^\d]/g, '');
  if (d.startsWith('63')) return `+${d}`;
  if (d.startsWith('0')) return `+63${d.slice(1)}`;
  return `+${d}`;
}

/** The site's own address (for link-preview images and links), from the request. */
export async function siteOrigin() {
  const { headers } = await import('next/headers');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '5h13.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
