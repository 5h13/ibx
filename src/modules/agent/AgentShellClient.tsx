'use client';
// Build 95 — agent app client pieces: the store switch (top-level), the navigation
// (tabs on a computer, a bottom bar on a phone), the app menu and the install button.
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { setAgentStoreAction } from './agentActions';
import type { AgentStore } from './agentContext';

export function AgentStoreSwitch({ stores, store }: { stores: AgentStore[]; store: AgentStore | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const pick = (id: string) => start(async () => {
    await setAgentStoreAction(id);
    // a client, an order or a month belongs to the store it came from: start clean in the new store
    router.push(`${pathname}?b=${id}`);
  });
  if (stores.length <= 1) return <div className="truncate text-base font-semibold">{store?.name ?? '—'}</div>;
  return (
    <label className="block">
      <span className="sr-only">Store</span>
      <span className="block text-[10px] uppercase tracking-wide opacity-75">{pending ? 'Switching store…' : 'Selling for'}</span>
      <select className="w-full max-w-xs truncate rounded-md border bg-transparent px-2 py-1 text-base font-semibold text-inherit outline-none [&>option]:bg-white [&>option]:text-slate-900"
        style={{ borderColor: 'color-mix(in srgb, currentColor 35%, transparent)', background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
        value={store?.business_id ?? ''} disabled={pending} onChange={(e) => pick(e.target.value)} aria-label="Store">
        {stores.map((s) => <option key={s.business_id} value={s.business_id}>{s.name}</option>)}
      </select>
    </label>
  );
}

const ICON: Record<string, string> = {
  catalog: 'M4 6h16M4 12h16M4 18h10', clients: 'M16 14a4 4 0 10-8 0M12 10a3 3 0 100-6 3 3 0 000 6zM4 20a8 8 0 0116 0',
  orders: 'M6 4h12l1 4H5l1-4zM5 8h14v11a1 1 0 01-1 1H6a1 1 0 01-1-1V8zm4 4h6', payments: 'M3 7h18v10H3zM3 10h18M7 14h3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const MAIN = [
  { href: '/agent/catalog', label: 'Catalogue', icon: 'catalog' },
  { href: '/agent', label: 'Clients', icon: 'clients' },
  { href: '/agent/orders', label: 'Orders', icon: 'orders' },
  { href: '/agent/payments', label: 'Payments', icon: 'payments' },
];
const MORE = [
  { href: '/agent/quotations', label: 'Quotations' },
  { href: '/agent/expenses', label: 'Expenses' },
  { href: '/agent/commission', label: 'My Commission' },
];

export function AgentNav({ variant }: { variant: 'tabs' | 'bottom' }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const active = (h: string) => (h === '/agent' ? path === '/agent' : path.startsWith(h));
  useEffect(() => setMore(false), [path]);
  if (variant === 'tabs') {
    return (
      <nav className="mx-auto hidden max-w-6xl gap-1 px-3 md:flex">
        {[...MAIN, ...MORE].map((n) => (
          <Link key={n.href} href={n.href} className={`rounded-t-md px-3 py-1.5 text-sm ${active(n.href) ? 'bg-slate-50 font-semibold text-slate-900' : 'opacity-80 hover:opacity-100'}`}>{n.label}</Link>
        ))}
      </nav>
    );
  }
  const moreActive = MORE.some((n) => active(n.href));
  return (
    <>
      {more && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setMore(false)} />}
      {more && (
        <div className="fixed inset-x-0 bottom-16 z-50 mx-3 mb-[env(safe-area-inset-bottom)] overflow-hidden rounded-xl border bg-white shadow-lg md:hidden">
          {MORE.map((n) => <Link key={n.href} href={n.href} className={`block border-b px-4 py-3 text-base last:border-0 ${active(n.href) ? 'font-semibold' : ''}`}>{n.label}</Link>)}
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {MAIN.map((n) => (
          <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active(n.href) ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
            <Icon d={ICON[n.icon]} />{n.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMore((m) => !m)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${moreActive || more ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
          <Icon d={ICON.more} />More
        </button>
      </nav>
    </>
  );
}

export function AgentMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold" style={{ background: 'color-mix(in srgb, currentColor 15%, transparent)' }} onClick={() => setOpen((o) => !o)} aria-label="Account">
        {name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border bg-white text-sm text-slate-800 shadow-lg">
            <div className="border-b px-3 py-2 text-xs text-slate-500">{name}</div>
            <Link href="/account/change-password" className="block px-3 py-2 hover:bg-slate-50">Change password</Link>
            <form action="/api/auth/signout" method="post"><button className="block w-full px-3 py-2 text-left text-red-700 hover:bg-slate-50">Log out</button></form>
          </div>
        </>
      )}
    </div>
  );
}

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
/** "Install app": Android / Chrome / Edge show the install prompt; iPhone gets the Share → Add to Home Screen steps. */
export function InstallButton() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  if (installed || (!evt && !ios)) return null;
  const click = async () => {
    if (evt) { await evt.prompt(); const r = await evt.userChoice; if (r.outcome === 'accepted') setInstalled(true); setEvt(null); }
    else setHelp(true);
  };
  return (
    <>
      <button type="button" onClick={click} className="flex-none rounded-md px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'color-mix(in srgb, currentColor 15%, transparent)' }} title="Install the app on this phone">
        <span aria-hidden>⤓</span> Install
      </button>
      {help && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 text-slate-800 sm:items-center" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm space-y-2 rounded-xl bg-white p-4 text-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Install 5H13 on your iPhone</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap the <b>Share</b> button (square with an arrow up).</li>
              <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </ol>
            <p className="text-xs text-slate-500">The 5H13 icon then opens the agent app full screen, like any app.</p>
            <button type="button" className="button w-full" onClick={() => setHelp(false)}>OK</button>
          </div>
        </div>
      )}
    </>
  );
}
