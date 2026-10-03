// Build 62 — Product Search: the catalog as a VIEW-ONLY lookup for Sales and
// other users (search products, check the store price, check stock on hand).
// Data comes only from catalog_product_search() (migration 20261115), which
// enforces catalog access and returns no cost, add-on, markup or supplier data.
import { requireSignedIn } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { canViewProductSearch } from '@/modules/catalog/productSearchAccess';
import { withCatalogPhotoUrls } from '@/modules/finance/procurement/catalogPhotos';
import { CascadeFilters } from '@/core/ui/CascadeFilters';

export const dynamic = 'force-dynamic';

type SP = { q?: string; category?: string; item?: string; brand?: string; stock?: string; page?: string };
const PAGE = 24;
const peso = (v: unknown) => (v == null ? '—' : `₱${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const qty = (v: unknown) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default async function ProductSearchPage(props: { searchParams?: Promise<SP> }) {
  const searchParams = await props.searchParams;
  const profile = await requireSignedIn();
  if (!canViewProductSearch(profile)) {
    return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">Product Search is available to Finance, Sales, Logistics and admins.</div></AuthedShell>;
  }
  const sp = searchParams ?? {};
  const f = { q: (sp.q ?? '').trim(), category: (sp.category ?? '').trim(), item: (sp.item ?? '').trim(), brand: (sp.brand ?? '').trim(), stock: sp.stock === '1' };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const db = createClient();
  const [{ data: rows, error }, { data: filterValues }] = await Promise.all([
    db.rpc('catalog_product_search', { p_q: f.q || null, p_category: f.category || null, p_item: f.item || null, p_brand: f.brand || null, p_in_stock_only: f.stock, p_limit: PAGE, p_offset: (page - 1) * PAGE }),
    // Build 84: pick-lists cascade — each narrows to the other selections.
    db.rpc('catalog_filter_values', { p_category: f.category || null, p_item: f.item || null, p_brand: f.brand || null }),
  ]);
  if (error) throw new Error(error.message);
  const items = await withCatalogPhotoUrls((rows ?? []) as any[]);
  const total = Number(items[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const categoryOptions = ((filterValues ?? []) as any[]).filter((v) => v.kind === 'category').map((v) => v.value as string);
  if (f.category && !categoryOptions.some((c) => c.toLowerCase() === f.category.toLowerCase())) categoryOptions.unshift(f.category);
  const itemOptions = ((filterValues ?? []) as any[]).filter((v) => v.kind === 'item').map((v) => v.value as string);
  const brandOptions = ((filterValues ?? []) as any[]).filter((v) => v.kind === 'brand').map((v) => v.value as string);
  const noBusiness = !profile.user.business_id;
  const link = (n: number) => {
    const u = new URLSearchParams();
    if (f.q) u.set('q', f.q); if (f.category) u.set('category', f.category); if (f.item) u.set('item', f.item); if (f.brand) u.set('brand', f.brand); if (f.stock) u.set('stock', '1');
    u.set('page', String(n)); return `?${u.toString()}`;
  };
  const filtered = Boolean(f.q || f.category || f.item || f.brand || f.stock);

  return (
    <AuthedShell profile={profile}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold">Product Search</h2>
          <p className="mt-1 text-sm text-slate-500">Look up products, store prices and stock on hand. View only. Available = on hand minus what approved sales orders have reserved. “Order only” = bought only against a client PO; “Not stocked” = this store has never ordered or received the item; “Out of stock” = stocked before, none on hand now.</p>
        </div>
        {noBusiness && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Select a business in &quot;Acting as&quot; to see store prices and stock — they are kept per business.</div>}

        <form method="get" className="grid items-end gap-3 rounded-lg border bg-white p-4 md:grid-cols-6">
          <CascadeFilters />
          <label className="block text-sm md:col-span-2"><span className="mb-1 block font-medium text-slate-700">Search</span>
            <input className="input" name="q" defaultValue={f.q} placeholder="Product name, code or description" autoFocus /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Category</span>
            <select className="input" name="category" data-cascade="1" defaultValue={f.category}><option value="">All categories</option>{categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Item</span>
            <input className="input" name="item" data-cascade="2" list="ps-items" defaultValue={f.item} placeholder="All items" /><datalist id="ps-items">{itemOptions.map((v) => <option key={v} value={v} />)}</datalist></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Brand</span>
            <input className="input" name="brand" data-cascade="3" list="ps-brands" defaultValue={f.brand} placeholder="All brands" /><datalist id="ps-brands">{brandOptions.map((v) => <option key={v} value={v} />)}</datalist></label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="stock" value="1" data-cascade="0" defaultChecked={f.stock} /> Available only</label>
          <div className="flex gap-2 md:col-span-6"><button className="button">Search</button>{filtered && <a className="button-secondary" href="/catalog">Clear</a>}</div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>{total === 0 ? 'No products found.' : `${total.toLocaleString()} product(s) · showing ${((page - 1) * PAGE + 1).toLocaleString()}–${Math.min(page * PAGE, total).toLocaleString()}`}</span>
          {pages > 1 && <div className="flex gap-1">
            {page > 1 ? <a className="button-secondary" href={link(page - 1)}>‹ Previous</a> : <span className="button-secondary pointer-events-none opacity-40">‹ Previous</span>}
            <span className="px-2 py-1">Page {page} of {pages.toLocaleString()}</span>
            {page < pages ? <a className="button-secondary" href={link(page + 1)}>Next ›</a> : <span className="button-secondary pointer-events-none opacity-40">Next ›</span>}
          </div>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => {
            const locs = (p.stock_by_location ?? []) as { location: string; on_hand: number }[];
            const onHand = p.on_hand == null ? null : Number(p.on_hand);
            const reserved = Number(p.reserved ?? 0);   // Build 78: held for approved sales orders
            const badge = p.item_type === 'service' ? { t: 'Service', c: 'bg-slate-100 text-slate-700' }
              : noBusiness ? null
              : p.stock_type === 'order_only' && !(Number(p.on_hand ?? 0) > 0) ? { t: 'Order only', c: 'bg-sky-50 text-sky-800' }
              : !p.stocked ? { t: 'Not stocked', c: 'bg-slate-100 text-slate-600' }
              : onHand == null ? null
              : onHand > 0 && reserved > 0 && onHand - reserved <= 0 ? { t: `${qty(onHand)} on hand, all reserved`, c: 'bg-amber-50 text-amber-800' }
              : onHand > 0 ? { t: `In stock: ${qty(onHand)} ${p.unit}`, c: 'bg-emerald-50 text-emerald-700' }
              : { t: 'Out of stock', c: 'bg-red-50 text-red-700' };
            return (
              <div key={p.item_id} className="flex gap-3 rounded-lg border bg-white p-3">
                <div className="h-24 w-24 flex-none overflow-hidden rounded border bg-slate-50">
                  {p.photo_url
                    ? <a href={`/catalog/${p.item_id}?back=${encodeURIComponent('/catalog' + link(page))}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={p.photo_url} alt={p.item_name} className="h-full w-full object-cover" /></a>
                    : <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <a className="font-medium leading-snug hover:underline" href={`/catalog/${p.item_id}?back=${encodeURIComponent('/catalog' + link(page))}`}>{p.item_name}</a>
                  <div className="text-xs text-slate-500">{p.item_code} · {[p.category, p.generic_item, p.brand].filter(Boolean).join(' · ')}</div>
                  {p.description && <div className="text-xs text-slate-600">{p.description}</div>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-lg font-semibold">{peso(p.store_price)}</span>
                    <span className="text-xs text-slate-500">per {p.unit}</span>
                    {badge && <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.c}`}>{badge.t}</span>}
                  </div>
                  {reserved > 0 && onHand != null && <div className="text-xs text-slate-600">{qty(reserved)} reserved for sales orders · <b>{qty(Math.max(onHand - reserved, 0))} available</b></div>}
                  {locs.length > 0 && (
                    <details className="text-xs text-slate-600">
                      <summary className="cursor-pointer">Stock by location</summary>
                      <ul className="mt-1 space-y-0.5">{locs.map((l) => <li key={l.location} className="flex justify-between gap-2"><span>{l.location}</span><span>{qty(l.on_hand)}</span></li>)}</ul>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AuthedShell>
  );
}
