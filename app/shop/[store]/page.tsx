// Build 136 — a store's public online catalog: /shop/<store> (no login). Search, filters, products with photos.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShopShell } from '@/modules/shop/ShopShell';
import { ShopFilters } from '@/modules/shop/ShopFilters';
import { loadCatalog, loadFilters, loadGroups, loadStore, pesoShop, siteOrigin, PAGE_SIZE, type ShopRow } from '@/modules/shop/data';

export const dynamic = 'force-dynamic';

type SP = { q?: string; category?: string; item?: string; brand?: string; page?: string };

export async function generateMetadata(props: { params: Promise<{ store: string }> }) {
  const { store } = await props.params;
  const s = await loadStore(store);
  if (!s) return { title: 'Shop' };
  const origin = await siteOrigin();
  const title = `${s.name} — online catalog`;
  const description = s.tagline ?? `${s.name}: aircon and refrigeration parts. Browse prices and message us to order.`;
  const logo = s.logo_url ? (s.logo_url.startsWith('/') ? `${origin}${s.logo_url}` : s.logo_url) : null;
  return {
    title, description,
    icons: logo ? { icon: logo } : undefined,
    openGraph: { type: 'website', title, description, siteName: s.name, url: `${origin}/shop/${store}`, images: logo ? [{ url: logo, alt: s.name }] : [] },
    twitter: { card: 'summary', title, description, images: logo ? [logo] : [] },
  };
}

export default async function StoreShop(props: { params: Promise<{ store: string }>; searchParams?: Promise<SP> }) {
  const { store: slug } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const store = await loadStore(slug);
  if (!store) notFound();
  const f = { q: sp.q ?? '', category: sp.category ?? '', item: sp.item ?? '', brand: sp.brand ?? '', page: Math.min(20, Math.max(1, Number(sp.page) || 1)) };
  const filtered = Boolean(f.q || f.category || f.item || f.brand);
  // Build 136b: no search / filter = the front page, grouped by category; otherwise the results under category headings
  const [cat, options, groups] = await Promise.all([
    filtered ? loadCatalog(slug, f) : Promise.resolve({ rows: [] as ShopRow[], total: 0, page: 1 }),
    loadFilters(slug, f),
    filtered ? Promise.resolve([] as Awaited<ReturnType<typeof loadGroups>>) : loadGroups(slug, 4),
  ]);
  const resultGroups: { category: string; rows: ShopRow[] }[] = [];
  for (const r of cat.rows) {
    const c = r.category || 'Other';
    const g = resultGroups[resultGroups.length - 1];
    if (g && g.category === c) g.rows.push(r); else resultGroups.push({ category: c, rows: [r] });
  }
  const card = (r: ShopRow) => (
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
  );
  const grid = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4';
  const qs = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, category: f.category, item: f.item, brand: f.brand, ...extra })) if (v) u.set(k, String(v));
    return u.toString();
  };
  return (
    <ShopShell store={store}>
      <div className="space-y-4">
        <ShopFilters action={`/shop/${slug}`} q={f.q} category={f.category} item={f.item} brand={f.brand} options={options} />
        {!filtered && (
          <>
            {groups.length > 1 && (
              <nav aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {groups.map((g) => <a key={g.category} href={`#cat-${encodeURIComponent(g.category)}`} className="flex-none rounded-full border bg-white px-3 py-1.5 text-xs font-semibold">{g.category} <span className="text-slate-400">{g.count}</span></a>)}
              </nav>
            )}
            {groups.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Our catalog is being prepared. Message us for what you need.</div>}
            {groups.map((g) => (
              <section key={g.category} id={`cat-${encodeURIComponent(g.category)}`} className="scroll-mt-20 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-extrabold text-slate-900">{g.category}</h2>
                  {g.count > g.rows.length && <Link href={`/shop/${slug}?${new URLSearchParams({ category: g.category }).toString()}`} className="text-sm font-semibold text-[rgb(var(--btn))] underline">See all ({g.count})</Link>}
                </div>
                <ul className={grid}>{g.rows.map(card)}</ul>
              </section>
            ))}
          </>
        )}
        {filtered && (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{cat.total} product{cat.total === 1 ? '' : 's'} found</span>
              <Link href={`/shop/${slug}`} className="underline">Clear</Link>
            </div>
            {cat.rows.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">No products found. Try another word, or message us — we may have it.</div>}
            {resultGroups.map((g, i) => (
              <section key={`${g.category}-${i}`} className="space-y-2">
                {(resultGroups.length > 1 || !f.category) && <h2 className="text-lg font-extrabold text-slate-900">{g.category}</h2>}
                <ul className={grid}>{g.rows.map(card)}</ul>
              </section>
            ))}
            {cat.total > cat.rows.length && cat.page < 20 && (
              <Link href={`/shop/${slug}?${qs({ page: cat.page + 1 })}`} scroll={false} className="block rounded-xl border bg-white py-3 text-center text-sm font-bold">
                Show more ({cat.total - cat.rows.length} more)
              </Link>
            )}
          </>
        )}
        {filtered && <p className="text-center text-[11px] text-slate-400">Showing up to {PAGE_SIZE * 20} products — use search or the filters to find more.</p>}
      </div>
    </ShopShell>
  );
}
