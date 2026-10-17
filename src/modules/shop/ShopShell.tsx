// Build 136 — the public shop's frame: the store's logo, name and colours, contact buttons, footer.
// Build 137 — three layouts, chosen per store in Sales → Online Shop:
//   A classic storefront — branded header with search, Request for quotation and Like us;
//   B bold hero — on the front page an announcement strip and a tall centred header (search, quotation,
//     Messenger / Viber / Call, Like us on Facebook); other pages a compact branded header;
//   C app style — compact white header (Facebook, search) and a bar fixed at the bottom with
//     Request for quotation and Messenger.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseTheme, themeCss, headerBackground } from '@/core/theme/brandTheme';
import { viberIntl, type ShopStore } from './data';
import { MessengerLink } from './MessengerLink';

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

function Logo({ store, size }: { store: ShopStore; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={store.logo_url || '/icons/icon-192.png'} alt="" style={{ width: size, height: size }} className="flex-none rounded-full bg-white object-contain" />;
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
  const fg = (theme as any)?.headerText ?? '#ffffff';
  const viber = viberIntl(store.viber_number);
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
  } else if (layout === 'B' && home) {
    header = (
      <>
        {strip && <div className="flex items-center gap-2.5 bg-slate-900 px-4 py-2.5 text-[13px] text-white">{Icon.announce}<span className="min-w-0 flex-1 truncate">{strip}</span></div>}
        <header className="text-center" style={{ background: bg, color: fg }}>
          <div className="mx-auto flex max-w-xl flex-col items-center gap-2.5 px-4 pb-5 pt-6">
            <Logo store={store} size={84} />
            <h1 className="text-3xl font-extrabold leading-none tracking-wide">{store.name}</h1>
            {store.tagline && <p className="text-sm opacity-90">{store.tagline}</p>}
            {store.facebook_url && <a href={store.facebook_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold"><FbMark />Like us on Facebook</a>}
            <div className="mt-1.5 w-full"><SearchBox slug={store.slug} q={q} placeholder="What part do you need?" big /></div>
            <div className="grid w-full grid-cols-3 gap-2">
              <Link href={quote} className={`col-span-3 flex h-[50px] items-center justify-center gap-2 rounded-xl text-base font-bold ${RFQ}`}>{Icon.quote}Request for quotation</Link>
              {store.messenger_url ? <MessengerLink url={store.messenger_url} className="flex h-11 items-center justify-center rounded-xl border border-white/40 text-[13px] font-semibold">Messenger</MessengerLink> : <span />}
              {viber ? <a href={`viber://chat?number=${encodeURIComponent(viber)}`} className="flex h-11 items-center justify-center rounded-xl border border-white/40 text-[13px] font-semibold">Viber</a> : <span />}
              {tel ? <a href={`tel:${tel}`} className="flex h-11 items-center justify-center rounded-xl border border-white/40 text-[13px] font-semibold">Call</a> : <span />}
            </div>
          </div>
        </header>
      </>
    );
  } else if (layout === 'B') {
    header = (
      <header className="sticky top-0 z-30 shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5">
          {backBtn}{nameBlock}
          <Link href={quote} className={`flex h-10 items-center rounded-lg px-3 text-xs font-bold ${RFQ}`}>Get a quote</Link>
        </div>
      </header>
    );
  } else {
    header = (
      <header className="shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pb-4 pt-3">
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
      {header}
      <main className={`mx-auto max-w-6xl px-4 py-4 ${layout === 'C' ? 'pb-28' : ''}`}>{children}</main>
      <footer className={`mx-auto max-w-6xl space-y-1 px-4 pt-6 text-xs ${layout === 'B' ? 'bg-slate-900 pb-10 text-slate-300' : 'pb-10 text-slate-500'} ${layout === 'C' ? 'pb-32' : ''}`}>
        <div className={`font-semibold ${layout === 'B' ? 'text-white' : 'text-slate-700'}`}>{store.name}</div>
        {store.address && <div>{store.address}</div>}
        <div className="flex flex-wrap gap-x-3">{store.phone && <a href={`tel:${store.phone.replace(/[^\d+]/g, '')}`} className="underline">{store.phone}</a>}{store.email && <a href={`mailto:${store.email}`} className="underline">{store.email}</a>}</div>
        {store.facebook_url && <a href={store.facebook_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline"><FbMark size={14} />Like us on Facebook</a>}
        <div>Prices may change without notice. Message us to confirm availability.</div>
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
