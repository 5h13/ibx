// Build 136 — the public shop's frame: the store's logo, name and colours, contact buttons, footer.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseTheme, themeCss, headerBackground } from '@/core/theme/brandTheme';
import { viberIntl, type ShopStore } from './data';
import { MessengerLink } from './MessengerLink';

export function ShopShell({ store, children, back }: { store: ShopStore; children: ReactNode; back?: string }) {
  const theme = parseTheme(store.theme);
  const css = themeCss(theme);
  const bg = headerBackground(theme) ?? 'linear-gradient(90deg, #0f172a, #1e293b)';
  const fg = (theme as any)?.headerText ?? '#ffffff';
  const viber = viberIntl(store.viber_number);
  return (
    <div className="shop-app min-h-screen bg-slate-50 text-slate-800">
      <meta name="theme-color" content={(theme as any)?.header ?? '#0f172a'} />
      <style dangerouslySetInnerHTML={{ __html: ':root{--btn:15 118 110;--on-btn:255 255 255}@media (max-width:767px){.shop-app input,.shop-app select{font-size:16px}}' }} />
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <header className="sticky top-0 z-30 shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          {back && <Link href={back} aria-label="Back to the catalog" className="-ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-lg hover:bg-white/10"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></Link>}
          <Link href={`/shop/${store.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={store.logo_url || '/icons/icon-192.png'} alt="" className="h-10 w-10 flex-none rounded-lg bg-white object-contain" />
            <span className="min-w-0 leading-tight"><span className="block truncate text-base font-extrabold">{store.name}</span>
              {store.tagline && <span className="block truncate text-xs opacity-80">{store.tagline}</span>}</span>
          </Link>
          <div className="flex flex-none gap-1.5">
            {store.messenger_url && <MessengerLink url={store.messenger_url} className="rounded-lg border border-white/30 px-2.5 py-1.5 text-xs font-semibold">Messenger</MessengerLink>}
            {viber && <a href={`viber://chat?number=${encodeURIComponent(viber)}`} className="rounded-lg border border-white/30 px-2.5 py-1.5 text-xs font-semibold">Viber</a>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
      <footer className="mx-auto max-w-6xl space-y-1 px-4 pb-10 pt-6 text-xs text-slate-500">
        <div className="font-semibold text-slate-700">{store.name}</div>
        {store.address && <div>{store.address}</div>}
        <div className="flex flex-wrap gap-x-3">{store.phone && <a href={`tel:${store.phone.replace(/[^\d+]/g, '')}`} className="underline">{store.phone}</a>}{store.email && <a href={`mailto:${store.email}`} className="underline">{store.email}</a>}</div>
        <div>Prices may change without notice. Message us to confirm availability.</div>
      </footer>
    </div>
  );
}
