// Build 136 — a store's public online catalog: /shop/<store> (no login). Search, filters, products with photos.
// Build 137 — the front page in the store's layout (A / B / C) with its sections (promotion, announcements,
// featured product, slideshow) when switched on; search / filter results stay one shared list.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShopShell } from '@/modules/shop/ShopShell';
import { ShopFilters } from '@/modules/shop/ShopFilters';
import { loadCatalog, loadFilters, loadGroups, loadHome, loadStore, siteOrigin, PAGE_SIZE, type ShopRow, type ShopStore, type ShopHome } from '@/modules/shop/data';
import { pesoShop, shortDay, viberIntl } from '@/modules/shop/format';
import { ProductCard, AvailBadge } from '@/modules/shop/ProductCard';
import { Slideshow } from '@/modules/shop/Slideshow';
import { BannerCarousel, type Slide } from '@/modules/shop/BannerCarousel';
import { MessengerLink } from '@/modules/shop/MessengerLink';

export const dynamic = 'force-dynamic';

type SP = { q?: string; category?: string; item?: string; brand?: string; page?: string; find?: string };

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

type Groups = Awaited<ReturnType<typeof loadGroups>>;
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4';
const H2 = 'text-lg font-extrabold text-slate-900';
const catHref = (slug: string, c: string) => `/shop/${slug}?${new URLSearchParams({ category: c }).toString()}`;
const slideHref = (slug: string, sl: NonNullable<ShopHome['slideshow']>) => {
  const u = new URLSearchParams(); if (sl.category) u.set('category', sl.category); if (sl.item) u.set('item', sl.item); if (sl.brand) u.set('brand', sl.brand);
  return `/shop/${slug}?${u.toString()}`;
};

function CategoryGroups({ slug, groups }: { slug: string; groups: Groups }) {
  if (!groups.length) return <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Our catalog is being prepared. Message us for what you need.</div>;
  return (
    <>
      {groups.map((g) => (
        <section key={g.category} id={`cat-${encodeURIComponent(g.category)}`} className="scroll-mt-20 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={H2}>{g.category}</h2>
            {g.count > g.rows.length && <Link href={catHref(slug, g.category)} className="text-sm font-semibold text-[rgb(var(--btn))] underline">See all ({g.count})</Link>}
          </div>
          <ul className={GRID}>{g.rows.map((r) => <li key={r.item_id}><ProductCard slug={slug} r={r} /></li>)}</ul>
        </section>
      ))}
    </>
  );
}

function CategoryChips({ groups }: { groups: Groups }) {
  if (groups.length < 2) return null;
  return (
    <nav aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {groups.map((g) => <a key={g.category} href={`#cat-${encodeURIComponent(g.category)}`} className="flex-none rounded-full border bg-white px-3 py-1.5 text-xs font-semibold">{g.category} <span className="text-slate-400">{g.count}</span></a>)}
    </nav>
  );
}

function FeaturedCard({ slug, f, big = false, label = 'Featured product' }: { slug: string; f: NonNullable<ShopHome['featured']>; big?: boolean; label?: string }) {
  if (big) {
    return (
      <section aria-label={label} className="overflow-hidden rounded-2xl border-2 border-[rgb(var(--btn))] bg-white">
        <div className="bg-[rgb(var(--btn))] px-3.5 py-2 text-xs font-bold tracking-widest text-[rgb(var(--on-btn))]">{label.toUpperCase()}</div>
        <Link href={`/shop/${slug}/item/${f.item_id}`} className="relative block h-60 bg-slate-100">
          <AvailBadge available={f.available} className="absolute left-3 top-3 z-10" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {f.photo_url && <img src={f.photo_url} alt={f.item_name} className="h-full w-full object-contain" />}
        </Link>
        <div className="space-y-1.5 p-3.5">
          <div className="text-lg font-bold text-slate-900">{f.item_name}</div>
          {f.brand && <div className="text-sm text-slate-600">{f.brand}</div>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-2xl font-extrabold text-slate-900">{pesoShop(f.price) ?? <span className="text-base text-slate-500">Ask for price</span>}</span>
            <Link href={`/shop/${slug}/item/${f.item_id}`} className="flex h-11 items-center rounded-xl bg-[rgb(var(--btn))] px-4 text-sm font-semibold text-[rgb(var(--on-btn))]">Ask about it</Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section aria-label={label} className="space-y-2.5">
      <h2 className={H2}>{label}</h2>
      <Link href={`/shop/${slug}/item/${f.item_id}`} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="h-32 w-32 flex-none overflow-hidden rounded-xl bg-slate-100">{f.photo_url && <img src={f.photo_url} alt="" className="h-full w-full object-contain" />}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--btn))]">FEATURED</span><AvailBadge available={f.available} /></span>
          <span className="font-semibold leading-snug text-slate-900">{f.item_name}</span>
          {f.brand && <span className="text-xs text-slate-500">{f.brand}</span>}
          <span className="mt-auto text-xl font-extrabold text-slate-900">{pesoShop(f.price) ?? <span className="text-sm text-slate-500">Ask for price</span>}</span>
        </span>
      </Link>
    </section>
  );
}

// Build 141: a promotion made in the Studio is one picture (tap → its item or category)
function PromoImage({ slug, p }: { slug: string; p: NonNullable<ShopHome['promo']> }) {
  const href = p.link_category ? catHref(slug, p.link_category) : p.item ? `/shop/${slug}/item/${p.item.item_id}` : null;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={p.image_url!} alt={p.title} className="block h-auto w-full" />;
  return <section aria-label="Promotion" className="overflow-hidden rounded-2xl bg-white shadow-sm" data-testid="promo-image">{href ? <Link href={href}>{img}</Link> : img}</section>;
}
// eslint-disable-next-line @next/next/no-img-element
const PicAnnouncement = ({ a }: { a: ShopHome['announcements'][number] }) => <article className="overflow-hidden rounded-2xl bg-white shadow-sm"><img src={a.image_url!} alt={a.title} className="block h-auto w-full" data-testid="announcement-image" /></article>;

function PromoCard({ slug, p }: { slug: string; p: NonNullable<ShopHome['promo']> }) {
  if (p.image_url) return <PromoImage slug={slug} p={p} />;
  return (
    <section aria-label="Promotion" className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2"><span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold tracking-wider text-amber-950">PROMO</span>{p.ends_on && <span className="text-xs text-amber-800">Until {shortDay(p.ends_on)}</span>}</div>
        <div className="text-2xl font-extrabold leading-tight text-amber-950">{p.title}</div>
        {p.body && <div className="whitespace-pre-line text-sm text-amber-900">{p.body}</div>}
        {p.link_category && <Link href={catHref(slug, p.link_category)} className="self-start text-sm font-bold text-amber-950 underline">See the promo items ›</Link>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.item?.photo_url && <Link href={`/shop/${slug}/item/${p.item.item_id}`} className="h-28 w-28 flex-none self-center overflow-hidden rounded-xl bg-white"><img src={p.item.photo_url} alt={p.item.item_name} className="h-full w-full object-contain" /></Link>}
    </section>
  );
}

function PromoBanner({ slug, p }: { slug: string; p: NonNullable<ShopHome['promo']> }) {
  if (p.image_url) return <PromoImage slug={slug} p={p} />;
  return (
    <section aria-label="Promotion" className="relative h-56 overflow-hidden rounded-2xl bg-slate-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.item?.photo_url && <img src={p.item.photo_url} alt="" className="absolute inset-y-0 right-0 h-full w-3/5 object-contain" />}
      <div className="absolute bottom-3.5 left-3.5 right-[38%] flex flex-col gap-1 rounded-xl bg-white p-3 shadow">
        <span className="self-start rounded-full bg-red-700 px-2 py-0.5 text-[11px] font-bold text-white">PROMO{p.ends_on ? ` · until ${shortDay(p.ends_on)}` : ''}</span>
        <div className="text-xl font-extrabold leading-tight text-slate-900">{p.title}</div>
        {p.body && <div className="line-clamp-2 text-xs text-slate-600">{p.body}</div>}
        {p.link_category ? <Link href={catHref(slug, p.link_category)} className="text-[13px] font-bold underline">Shop the promo ›</Link>
          : p.item ? <Link href={`/shop/${slug}/item/${p.item.item_id}`} className="text-[13px] font-bold underline">See the item ›</Link> : null}
      </div>
    </section>
  );
}

function Announcements({ list, variant }: { list: ShopHome['announcements']; variant: 'cards' | 'dated' | 'compact' }) {
  if (!list.length) return null;
  if (variant === 'dated') {
    return (
      <section aria-label="Announcements" className="space-y-3">
        <h2 className={H2}>News from the store</h2>
        {list.map((a) => {
          if (a.image_url) return <PicAnnouncement key={a.id} a={a} />;
          const d = shortDay(a.date).split(' ');
          return (
            <article key={a.id} className="flex gap-3">
              <div className="w-14 flex-none rounded-xl bg-slate-100 py-2 text-center"><div className="text-[11px] uppercase text-slate-500">{d[0]}</div><div className="text-xl font-bold">{d[1]}</div></div>
              <div><div className="font-semibold text-slate-900">{a.title}</div>{a.body && <div className="whitespace-pre-line text-sm text-slate-600">{a.body}</div>}</div>
            </article>
          );
        })}
      </section>
    );
  }
  if (variant === 'compact') {
    return (
      <section aria-label="Announcements" className="space-y-2.5 rounded-2xl bg-white p-3.5 shadow-sm">
        <h2 className={H2}>Announcements</h2>
        {list.map((a, k) => a.image_url ? <PicAnnouncement key={a.id} a={a} /> : (
          <article key={a.id} className="flex gap-2.5"><span className={`mt-2 h-2 w-2 flex-none rounded-full ${k === 0 ? 'bg-[rgb(var(--btn))]' : 'bg-slate-300'}`} />
            <div><div className="text-sm font-semibold text-slate-900">{a.title}</div><div className="whitespace-pre-line text-[13px] text-slate-600">{shortDay(a.date)}{a.body ? ` · ${a.body}` : ''}</div></div></article>
        ))}
      </section>
    );
  }
  return (
    <section aria-label="Announcements" className="space-y-2.5">
      <h2 className={H2}>Announcements</h2>
      {list.map((a) => a.image_url ? <PicAnnouncement key={a.id} a={a} /> : (
        <article key={a.id} className="space-y-1 rounded-2xl bg-white px-3.5 py-3 shadow-sm">
          <div className="text-xs text-slate-500">{shortDay(a.date)}</div>
          <div className="font-semibold text-slate-900">{a.title}</div>
          {a.body && <div className="whitespace-pre-line text-sm text-slate-600">{a.body}</div>}
        </article>
      ))}
    </section>
  );
}

function FacebookCard({ url }: { url: string }) {
  return (
    <section aria-label="Facebook" className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <span aria-hidden="true" className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-[#1877f2] text-2xl font-bold text-white">f</span>
      <span className="min-w-0 flex-1"><span className="block font-bold text-slate-900">Like us on Facebook</span><span className="block truncate text-[13px] text-slate-500">Promos and new stock first</span></span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center rounded-xl bg-[#1877f2] px-4 text-sm font-semibold text-white">Like</a>
    </section>
  );
}

function HomeA({ store, home, groups }: { store: ShopStore; home: ShopHome; groups: Groups }) {
  const slug = store.slug;
  return (
    <div className="space-y-6">
      {home.promo && <PromoCard slug={slug} p={home.promo} />}
      {home.slideshow && <Slideshow slug={slug} variant="single" title={home.slideshow.title} seeAllHref={slideHref(slug, home.slideshow)} items={home.slideshow.items} />}
      {home.featured && <FeaturedCard slug={slug} f={home.featured} />}
      <Announcements list={home.announcements} variant="cards" />
      <CategoryChips groups={groups} />
      <CategoryGroups slug={slug} groups={groups} />
      {store.facebook_url && <FacebookCard url={store.facebook_url} />}
    </div>
  );
}

function HomeB({ store, home, groups }: { store: ShopStore; home: ShopHome; groups: Groups }) {
  const slug = store.slug;
  return (
    <div className="space-y-7">
      {home.promo && <PromoBanner slug={slug} p={home.promo} />}
      {groups.length > 1 && (
        <section aria-label="Shop by category" className="space-y-2.5">
          <h2 className={H2}>Shop by category</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {groups.map((g) => (
              <Link key={g.category} href={catHref(slug, g.category)} className="flex flex-col items-center gap-1.5 rounded-xl bg-white px-1.5 py-3 text-center shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <span className="h-11 w-11 overflow-hidden rounded-xl bg-slate-100">{g.rows[0]?.photo_url && <img src={g.rows[0].photo_url} alt="" className="h-full w-full object-contain" />}</span>
                <span className="text-[13px] font-semibold leading-tight text-slate-900">{g.category}</span>
                <span className="text-[11px] text-slate-500">{g.count} items</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {home.slideshow && <Slideshow slug={slug} variant="strip" title={home.slideshow.title} seeAllHref={slideHref(slug, home.slideshow)} items={home.slideshow.items} />}
      {home.featured && <FeaturedCard slug={slug} f={home.featured} big />}
      <Announcements list={home.announcements} variant="dated" />
      <CategoryGroups slug={slug} groups={groups} />
    </div>
  );
}

function HomeC({ store, home, groups }: { store: ShopStore; home: ShopHome; groups: Groups }) {
  const slug = store.slug;
  const slides: Slide[] = [
    ...(home.promo && !home.promo.image_url ? [{ key: `p-${home.promo.id}`, kind: 'promo' as const, title: home.promo.title, body: home.promo.body, note: home.promo.ends_on ? `until ${shortDay(home.promo.ends_on)}` : null,
      href: home.promo.link_category ? catHref(slug, home.promo.link_category) : home.promo.item ? `/shop/${slug}/item/${home.promo.item.item_id}` : null, photo_url: home.promo.item?.photo_url ?? null }] : []),
    ...home.announcements.slice(0, 4).map((a) => ({ key: `a-${a.id}`, kind: 'announcement' as const, title: a.title, body: a.body, note: shortDay(a.date), href: null, image_url: a.image_url ?? null })),
  ];
  const viber = viberIntl(store.viber_number);
  const tel = store.phone ? store.phone.replace(/[^\d+]/g, '') : null;
  const tile = 'flex flex-col items-center gap-1.5 rounded-xl bg-white px-1 py-2.5 text-center text-xs font-semibold text-slate-900 shadow-sm';
  return (
    <div className="space-y-5">
      {home.promo?.image_url && <PromoImage slug={slug} p={home.promo} />}
      <BannerCarousel slides={slides} />
      <nav aria-label="Contact the store" className="grid grid-cols-4 gap-2">
        <Link href={`/shop/${slug}/quote`} className={tile}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7" /></svg></span>Get a quote</Link>
        {store.messenger_url ? <MessengerLink url={store.messenger_url} className={tile}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#0866ff]"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3C7 3 3 6.6 3 11.2c0 2.6 1.3 4.9 3.4 6.4V21l3.1-1.7c.8.2 1.7.3 2.5.3 5 0 9-3.6 9-8.2S17 3 12 3z" /></svg></span>Messenger</MessengerLink> : <span />}
        {viber ? <a href={`viber://chat?number=${encodeURIComponent(viber)}`} className={tile}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3C7 3 3 6.6 3 11.2c0 2.6 1.3 4.9 3.4 6.4V21l3.1-1.7c.8.2 1.7.3 2.5.3 5 0 9-3.6 9-8.2S17 3 12 3z" /></svg></span>Viber</a> : <span />}
        {tel ? <a href={`tel:${tel}`} className={tile}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg></span>Call us</a> : <span />}
      </nav>
      {home.featured && <FeaturedCard slug={slug} f={home.featured} label="Product of the week" />}
      {home.slideshow && <Slideshow slug={slug} variant="progress" title={home.slideshow.title} seeAllHref={slideHref(slug, home.slideshow)} items={home.slideshow.items} />}
      {slides.length === 0 && <Announcements list={home.announcements} variant="compact" />}
      {groups.length > 0 && (
        <section aria-label="Browse the catalog" className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <h2 className={`${H2} px-3.5 pb-1 pt-3`}>Browse the catalog</h2>
          {groups.map((g) => (
            <Link key={g.category} href={catHref(slug, g.category)} className="flex min-h-[56px] items-center gap-3 border-t border-slate-100 px-3.5 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-slate-100">{g.rows[0]?.photo_url && <img src={g.rows[0].photo_url} alt="" className="h-full w-full object-contain" />}</span>
              <span className="flex-1 font-semibold text-slate-900">{g.category}</span>
              <span className="text-[13px] text-slate-500">{g.count}</span><span aria-hidden="true" className="text-lg text-slate-400">›</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

export default async function StoreShop(props: { params: Promise<{ store: string }>; searchParams?: Promise<SP> }) {
  const { store: slug } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const store = await loadStore(slug);
  if (!store) notFound();
  const f = { q: sp.q ?? '', category: sp.category ?? '', item: sp.item ?? '', brand: sp.brand ?? '', page: Math.min(20, Math.max(1, Number(sp.page) || 1)) };
  const filtered = Boolean(f.q || f.category || f.item || f.brand || sp.find === '1');

  if (!filtered) {
    const [home, groups] = await Promise.all([loadHome(slug), loadGroups(slug, 4)]);
    const layout = store.layout ?? 'A';
    return (
      <ShopShell store={store} home strip={home.announcements[0]?.title ?? null}>
        {layout === 'B' ? <HomeB store={store} home={home} groups={groups} />
          : layout === 'C' ? <HomeC store={store} home={home} groups={groups} />
          : <HomeA store={store} home={home} groups={groups} />}
      </ShopShell>
    );
  }

  const [cat, options] = await Promise.all([loadCatalog(slug, f), loadFilters(slug, f)]);
  const resultGroups: { category: string; rows: ShopRow[] }[] = [];
  for (const r of cat.rows) {
    const c = r.category || 'Other';
    const g = resultGroups[resultGroups.length - 1];
    if (g && g.category === c) g.rows.push(r); else resultGroups.push({ category: c, rows: [r] });
  }
  const qs = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, category: f.category, item: f.item, brand: f.brand, ...extra })) if (v) u.set(k, String(v));
    return u.toString();
  };
  return (
    <ShopShell store={store} back={`/shop/${slug}`} q={f.q}>
      <div className="space-y-4">
        <ShopFilters action={`/shop/${slug}`} q={f.q} category={f.category} item={f.item} brand={f.brand} options={options} />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{cat.total} product{cat.total === 1 ? '' : 's'} found</span>
          <Link href={`/shop/${slug}`} className="underline">Back to the shop</Link>
        </div>
        {cat.rows.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">No products found. Try another word, or <Link href={`/shop/${slug}/quote`} className="underline">send us a request for quotation</Link> — we may have it.</div>}
        {resultGroups.map((g, i) => (
          <section key={`${g.category}-${i}`} className="space-y-2">
            {(resultGroups.length > 1 || !f.category) && <h2 className={H2}>{g.category}</h2>}
            <ul className={GRID}>{g.rows.map((r) => <li key={r.item_id}><ProductCard slug={slug} r={r} /></li>)}</ul>
          </section>
        ))}
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
