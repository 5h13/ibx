// Build 136 — the public shop's frame: the store's logo, name and colours, contact buttons, footer.
// Build 137 — three layouts, chosen per store in Sales → Online Shop:
//   A classic storefront — branded header with search, Request for quotation and Like us;
//   B bold hero — on the front page an announcement strip and a tall centred header (search, quotation,
//     Messenger / Viber / Call, Like us on Facebook); other pages a compact branded header;
//   C app style — compact white header (Facebook, search) and a bar fixed at the bottom with
//     Request for quotation and Messenger.
// Build 139 (from 5h13Shops Builds 3 and 9.1): the store's banner photo behind the header (A, B) or as a strip under it
// (C), on every page, darkened at the bottom so the name stays readable; initials when there is no logo; a "Manage
// shop" button and a Preview strip for the store's own staff; WhatsApp; a privacy line in the footer.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseTheme, themeCss, headerBackground } from '@/core/theme/brandTheme';
import { viberIntl, type ShopStore } from './data';
import { MessengerLink } from './MessengerLink';
import { waLink } from './contact';

const Icon = {
  messenger: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3C7 3 3 6.6 3 11.2c0 2.6 1.3 4.9 3.4 6.4V21l3.1-1.7c.8.2 1.7.3 2.5.3 5 0 9-3.6 9-8.2S17 3 12 3z" /><path d="M7.5 13.5l3-3 2.5 2 3.5-3" /></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  quote: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7M9 8h3" /></svg>,
  back: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>,
  announce: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 10v4h3l7 5V5L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></svg>,
};
const FbMark = ({ size = 18 }: { size?: number }) => (
  <span aria-hidden="true" className="inline-flex flex-none items-center justify-center rounded bg-[#1877f2] font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.7 }}>f</span>
);
const RFQ = 'bg-amber-400 text-amber-950 hover:bg-amber-300';
const FOCUS = { top: 'center top', center: 'center center', bottom: 'center bottom' } as const;

/** The banner photo behind a header, darkened at the bottom so the name stays readable. */
function BannerLayer({ store }: { store: ShopStore }) {
  if (!store.banner_url) return null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={store.banner_url} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: FOCUS[store.banner_focus ?? 'center'] }} />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/35 to-black/70" />
    </>
  );
}

function Logo({ store, size }: { store: ShopStore; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (store.logo_url) return <img src={store.logo_url} alt="" style={{ width: size, height: size }} className="flex-none rounded-full bg-white object-contain" />;
  const initials = store.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }} className="flex flex-none items-center justify-center rounded-full border-2 border-white/70 bg-slate-700 font-extrabold text-white">{initials}</span>;
}

export function SearchBox({ slug, q = '', placeholder = 'Search parts, brands, models…', big = false }: { slug: string; q?: string; placeholder?: string; big?: boolean }) {
  return (
    <form action={`/shop/${slug}`} role="search" className="flex w-full gap-2">
      <label className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 text-slate-500 ${big ? 'h-[50px]' : 'h-[46px]'}`}>
        {Icon.search}<span className="sr-only">Search the catalog</span>
        <input name="q" type="search" defaultValue={q} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-500" />
      </label>
    </form>
  );
}

export function ShopShell({ store, children, back, home = false, q = '', strip }: { store: ShopStore; children: ReactNode; back?: string; home?: boolean; q?: string; strip?: string | null }) {
  const layout = store.layout ?? 'A';
  const theme = parseTheme(store.theme);
  const css = themeCss(theme);
  const bg = headerBackground(theme) ?? 'linear-gradient(90deg, #0b3d6b, #0f4c81)';
  const banner = !!store.banner_url;
  const fg = banner ? '#ffffff' : (theme as any)?.headerText ?? '#ffffff';
  const viber = viberIntl(store.viber_number);
  const wa = store.whatsapp_number ? waLink(store.whatsapp_number) : null;
  const tel = store.phone ? store.phone.replace(/[^\d+]/g, '') : null;
  const quote = `/shop/${store.slug}/quote`;
  const backBtn = back ? <Link href={back} aria-label="Back" className="-ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-lg hover:bg-black/10">{Icon.back}</Link> : null;
  const nameBlock = (
    <Link href={`/shop/${store.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
      <Logo store={store} size={layout === 'C' ? 40 : 46} />
      <span className="min-w-0 leading-tight"><span className="block truncate text-lg font-extrabold tracking-wide">{store.name}</span>
        {store.tagline && <span className="block truncate text-xs opacity-80">{store.tagline}</span>}</span>
    </Link>
  );

  let header: ReactNode;
  if (layout === 'C') {
    header = (
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white text-slate-900" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          {backBtn}{nameBlock}
          {store.facebook_url && <a href={store.facebook_url} target="_blank" rel="noopener noreferrer" aria-label="Like us on Facebook" className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1877f2] text-xl font-bold text-white">f</a>}
          <Link href={`/shop/${store.slug}?find=1`} aria-label="Search the catalog" className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">{Icon.search}</Link>
        </div>
      </header>
    );
    if (banner) header = (
      <>
        {header}
        <div className={`relative mx-auto max-w-6xl overflow-hidden ${home ? 'h-40 sm:h-56' : 'h-20 sm:h-28'}`} data-testid="shop-banner"><BannerLayer store={store} />
          {home && store.tagline && <p className="absolute inset-x-0 bottom-0 px-4 pb-3 text-[15px] font-semibold text-white">{store.tagline}</p>}
        </div>
      </>
    );
  } else if (layout === 'B' && home) {
    header = (
      <>
        {strip && <div className="flex items-center gap-2.5 bg-slate-900 px-4 py-2.5 text-[13px] text-white">{Icon.announce}<span className="min-w-0 flex-1 truncate">{strip}</span></div>}
        <header className="relative overflow-hidden text-center" style={{ background: bg, color: fg }} data-testid={banner ? 'shop-banner' : undefined}>
          <BannerLayer store={store} />
          <div className={`relative mx-auto flex max-w-xl flex-col items-center gap-2.5 px-4 pb-5 ${banner ? 'pt-14' : 'pt-6'}`}>
            <Logo store={store} size={84} />
            <h1 className="text-3xl font-extrabold leading-none tracking-wide">{store.name}</h1>
            {store.tagline && <p className="text-sm opacity-90">{store.tagline}</p>}
            {store.facebook_url && <a href={store.facebook_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold"><FbMark />Like us on Facebook</a>}
            <div className="mt-1.5 w-full"><SearchBox slug={store.slug} q={q} placeholder="What part do you need?" big /></div>
            <Link href={quote} className={`flex h-[50px] w-full items-center justify-center gap-2 rounded-xl text-base font-bold ${RFQ}`}>{Icon.quote}Request for quotation</Link>
            <div className="flex w-full gap-2 [&>*]:flex-1">
              {store.messenger_url && <MessengerLink url={store.messenger_url} className="flex h-11 items-center justify-center rounded-xl border border-white/40 bg-black/10 text-[13px] font-semibold">Messenger</MessengerLink>}
              {viber && <a href={`viber://chat?number=${encodeURIComponent(viber)}`} className="flex h-11 items-center justify-center rounded-xl border border-white/40 bg-black/10 text-[13px] font-semibold">Viber</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center rounded-xl border border-white/40 bg-black/10 text-[13px] font-semibold">WhatsApp</a>}
              {tel && <a href={`tel:${tel}`} className="flex h-11 items-center justify-center rounded-xl border border-white/40 bg-black/10 text-[13px] font-semibold">Call</a>}
            </div>
          </div>
        </header>
      </>
    );
  } else if (layout === 'B') {
    header = (
      <header className="sticky top-0 z-30 overflow-hidden shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }} data-testid={banner ? 'shop-banner' : undefined}>
        <BannerLayer store={store} />
        <div className={`relative mx-auto flex max-w-6xl items-center gap-2 px-4 ${banner ? 'pb-3 pt-10' : 'py-2.5'}`}>
          {backBtn}{nameBlock}
          <Link href={quote} className={`flex h-10 items-center rounded-lg px-3 text-xs font-bold ${RFQ}`}>Get a quote</Link>
        </div>
      </header>
    );
  } else {
    header = (
      <header className="relative overflow-hidden shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }} data-testid={banner ? 'shop-banner' : undefined}>
        <BannerLayer store={store} />
        <div className={`relative mx-auto flex max-w-6xl flex-col gap-3 px-4 pb-4 ${banner && home ? 'pt-16' : 'pt-3'}`}>
          <div className="flex items-center gap-2">
            {backBtn}{nameBlock}
            {store.messenger_url && <MessengerLink url={store.messenger_url} className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/35">{Icon.messenger}<span className="sr-only">Message us on Messenger</span></MessengerLink>}
          </div>
          <SearchBox slug={store.slug} q={q} />
          <div className="flex gap-2">
            <Link href={quote} className={`flex h-[46px] flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-bold ${RFQ}`}>{Icon.quote}Request for quotation</Link>
            {store.facebook_url && <a href={store.facebook_url} target="_blank" rel="noopener noreferrer" className="flex h-[46px] items-center gap-1.5 rounded-xl bg-[#1877f2] px-3 text-[13px] font-semibold text-white"><FbMark size={16} />Like us</a>}
          </div>
        </div>
      </header>
    );
  }

  return (
    <div className="shop-app min-h-screen bg-slate-50 text-slate-800">
      <meta name="theme-color" content={layout === 'C' ? '#ffffff' : (theme as any)?.header ?? '#0b3d6b'} />
      <style dangerouslySetInnerHTML={{ __html: ':root{--btn:11 61 107;--on-btn:255 255 255}@media (max-width:767px){.shop-app input,.shop-app select,.shop-app textarea{font-size:16px}}' }} />
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {store.preview && <div role="status" className="bg-amber-300 px-4 py-2 text-center text-[13px] font-bold text-amber-950">Preview — the public can&apos;t see this shop until the Super Admin opens it.</div>}
      {header}
      {store.manage && (
        <a href="/sales/online-shop" className="fixed left-3 z-50 flex min-h-[44px] items-center gap-1 rounded-full bg-slate-900/90 px-3.5 text-[13px] font-bold text-white shadow-lg"
          style={{ bottom: (layout === 'C' ? 76 : 0) + 12 }}>Manage shop<span aria-hidden="true">→</span></a>
      )}
      <main className={`mx-auto max-w-6xl px-4 py-4 ${layout === 'C' ? 'pb-28' : ''}`}>{children}</main>
      <footer className={`mx-auto max-w-6xl space-y-1 px-4 pt-6 text-xs ${layout === 'B' ? 'bg-slate-900 pb-10 text-slate-300' : 'pb-10 text-slate-500'} ${layout === 'C' ? 'pb-32' : ''}`}>
        <div className={`font-semibold ${layout === 'B' ? 'text-white' : 'text-slate-700'}`}>{store.name}</div>
        {store.address && <div>{store.address}</div>}
        <div className="flex flex-wrap gap-x-3">{store.phone && <a href={`tel:${store.phone.replace(/[^\d+]/g, '')}`} className="underline">{store.phone}</a>}{store.email && <a href={`mailto:${store.email}`} className="underline">{store.email}</a>}</div>
        {store.facebook_url && <a href={store.facebook_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline"><FbMark size={14} />Like us on Facebook</a>}
        <div>Prices may change without notice. Message us to confirm availability.</div>
        <div className={`pt-2 text-[11px] opacity-80 ${store.manage ? 'pb-16' : ''}`}>Privacy: when you send a request here, {store.name} keeps your name, mobile number and request to reply to you. To have them deleted, message or call the store.</div>
      </footer>
      {layout === 'C' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 pt-2.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
          <div className="mx-auto flex max-w-6xl gap-2">
            <Link href={quote} className={`flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl text-base font-bold ${RFQ}`}>{Icon.quote}Request for quotation</Link>
            {store.messenger_url && <MessengerLink url={store.messenger_url} className="flex h-[50px] w-[50px] items-center justify-center rounded-xl bg-[#0866ff] text-white">{Icon.messenger}<span className="sr-only">Message us on Messenger</span></MessengerLink>}
          </div>
        </div>
      )}
    </div>
  );
}
