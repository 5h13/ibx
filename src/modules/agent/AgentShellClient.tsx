'use client';
// Build 95 — agent app client pieces: the store switch (top-level), the navigation
// (tabs on a computer, a bottom bar on a phone), the app menu and the install button.
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { agentNoticesReadAction, setAgentStoreAction } from './agentActions';
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
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  catalog: 'M4 6h16M4 12h16M4 18h10', clients: 'M16 14a4 4 0 10-8 0M12 10a3 3 0 100-6 3 3 0 000 6zM4 20a8 8 0 0116 0',
  orders: 'M6 4h12l1 4H5l1-4zM5 8h14v11a1 1 0 01-1 1H6a1 1 0 01-1-1V8zm4 4h6', payments: 'M3 7h18v10H3zM3 10h18M7 14h3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const MAIN = [
  { href: '/agent', label: 'Home', icon: 'home' },
  { href: '/agent/catalog', label: 'Catalogue', icon: 'catalog' },
  { href: '/agent/clients', label: 'Clients', icon: 'clients' },
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
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
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

export function AgentMenu({ name, office = false }: { name: string; office?: boolean }) {
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
            {office && <Link href="/dashboard" className="block border-b px-3 py-2 font-semibold hover:bg-slate-50">← Back to office</Link>}<Link href="/profile" className="block px-3 py-2 hover:bg-slate-50">My profile (username, nickname, email)</Link><Link href="/account/change-password" className="block px-3 py-2 hover:bg-slate-50">Change password</Link>
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

/** Build 96 — the bell: notices to the agent (e.g. a client moved to him or away from him). Opening it marks them read. */
export function AgentNotices({ data }: { data: { unread: number; items: { id: string; title: string; message: string | null; store: string; read: boolean; created_at: string }[] } }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(Number(data.unread) || 0);
  useEffect(() => setUnread(Number(data.unread) || 0), [data.unread]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) { setUnread(0); agentNoticesReadAction().catch(() => {}); }
  };
  return (
    <div className="relative">
      <button type="button" onClick={toggle} className="relative flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, currentColor 15%, transparent)' }} aria-label={`Notices${unread ? ` (${unread} new)` : ''}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-[#fff]">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-lg border bg-white text-sm text-slate-800 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80">
            <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-slate-500">Notices</div>
            {data.items.map((n) => (
              <div key={n.id} className={`border-b px-3 py-2 last:border-0 ${n.read ? '' : 'bg-blue-50'}`}>
                <div className="font-medium leading-snug">{n.title}</div>
                {n.message && <div className="mt-0.5 text-xs text-slate-600">{n.message}</div>}
                <div className="mt-0.5 text-[11px] text-slate-400">{n.store} · {new Date(n.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
            ))}
            {!data.items.length && <div className="px-3 py-6 text-center text-slate-500">No notices.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// Build 102a — reopen on the last screen. A phone may close the installed app while the agent is in
// Messenger / Viber; it then restarts at the start page. If that happens within 12 hours, go back to the
// screen he was on (the catalogue keeps its own search, filters and open product).
const LAST_KEY = 'ibx-agent-last';
export function ResumeLastScreen() {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const here = `${path}${sp.toString() ? `?${sp.toString()}` : ''}`;
  useEffect(() => {
    try {
      const fresh = !sessionStorage.getItem('ibx-agent-open');
      sessionStorage.setItem('ibx-agent-open', '1');
      if (fresh && path === '/agent' && !sp.toString()) {
        const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') as { path: string; t: number } | null;
        if (last && last.path !== '/agent' && last.path.startsWith('/agent') && Date.now() - last.t < 12 * 3600000) { router.replace(last.path); return; }
      }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem(LAST_KEY, JSON.stringify({ path: here, t: Date.now() })); } catch { /* */ } }, [here]);
  return null;
}
