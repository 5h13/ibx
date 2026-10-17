// Build 136 — a store's public online catalog: /shop/<store> (no login). Search, filters, products with photos.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShopShell } from '@/modules/shop/ShopShell';
import { ShopFilters } from '@/modules/shop/ShopFilters';
import { loadCatalog, loadFilters, loadStore, pesoShop, PAGE_SIZE } from '@/modules/shop/data';

export const dynamic = 'force-dynamic';

type SP = { q?: string; category?: string; item?: string; brand?: string; page?: string };

export async function generateMetadata(props: { params: Promise<{ store: string }> }) {
  const { store } = await props.params;
  const s = await loadStore(store);
  return s ? { title: `${s.name} — online catalog`, description: s.tagline ?? `${s.name}: aircon and refrigeration parts. Browse prices and message us to order.` } : { title: 'Shop' };
}

export default async function StoreShop(props: { params: Promise<{ store: string }>; searchParams?: Promise<SP> }) {
  const { store: slug } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const store = await loadStore(slug);
  if (!store) notFound();
  const f = { q: sp.q ?? '', category: sp.category ?? '', item: sp.item ?? '', brand: sp.brand ?? '', page: Math.min(20, Math.max(1, Number(sp.page) || 1)) };
  const [cat, options] = await Promise.all([loadCatalog(slug, f), loadFilters(slug, f)]);
  const qs = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, category: f.category, item: f.item, brand: f.brand, ...extra })) if (v) u.set(k, String(v));
    return u.toString();
  };
  const filtered = Boolean(f.q || f.category || f.item || f.brand);
  return (
    <ShopShell store={store}>
      <div className="space-y-4">
        <ShopFilters action={`/shop/${slug}`} q={f.q} category={f.category} item={f.item} brand={f.brand} options={options} />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{cat.total} product{cat.total === 1 ? '' : 's'}{filtered ? ' found' : ''}</span>
          {filtered && <Link href={`/shop/${slug}`} className="underline">Clear</Link>}
        </div>
        {cat.rows.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">No products found. Try another word, or message us — we may have it.</div>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cat.rows.map((r) => (
            <li key={r.item_id}>
              <Link href={`/shop/${slug}/item/${r.item_id}`} className="flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="aspect-square bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.photo_url ? <img src={r.photo_url} alt={r.item_name} loading="lazy" className="h-full w-full object-contain" /> : null}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <div className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{r.item_name}</div>
                  {r.brand && <div className="truncate text-[11px] text-slate-500">{r.brand}</div>}
                  <div className="mt-auto pt-1 text-base font-extrabold text-slate-900">{pesoShop(r.price) ?? <span className="text-sm font-semibold text-slate-500">Ask for price</span>}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {cat.total > cat.rows.length && cat.page < 20 && (
          <Link href={`/shop/${slug}?${qs({ page: cat.page + 1 })}`} scroll={false} className="block rounded-xl border bg-white py-3 text-center text-sm font-bold">
            Show more ({cat.total - cat.rows.length} more)
          </Link>
        )}
        <p className="text-center text-[11px] text-slate-400">Showing up to {PAGE_SIZE * 20} products — use search or the filters to find more.</p>
      </div>
    </ShopShell>
  );
}
