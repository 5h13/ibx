'use client';
// Build 95 — agent catalogue for the phone: product cards like the store
// catalogue; tap the photo or the name for the product (photos, details, stock,
// prices; capital only behind "Show capital"). Without a client the card shows
// the price range (Tier 4 – Tier 1); with a client, only the client's price.
// The order / quotation opens as a pop-up with its buttons at the top. The
// basket is kept per store, so switching store switches the basket too.
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { catalogAction, productDetailAction, saveOrderAction, saveQuoteAction, type CatalogRow, type ProductDetail } from './agentActions';
import { peso, qty } from './AgentHeader';
import type { AgentClient } from './AgentClients';
import { Sheet } from './Sheet';
import { ShareImageButton, type ShareBrand, type ShareAgent } from './ShareCard';

type Mode = 'client' | '1' | '2' | '3' | '4' | 'custom';
type Line = { key: number; row: CatalogRow; quantity: string; mode: Mode; price: string };
type Saved = { item_code: string; item_id: string; quantity: string; mode: Mode; price: string };
let lineKey = 0;
// Build 102b: the catalogue stays as it was while the app is open — moving to Clients / Orders and back
// shows the same list, basket, open product and scroll at once, with no reload (refreshed after 10 minutes)
type Memory = { rows: CatalogRow[]; lines: Line[]; q: string; category: string; inStock: boolean; clientId: string; detailId: string | null; notes: string; scroll: number; t: number };
const memory = new Map<string, Memory>();
const FRESH = 10 * 60000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const PAGE = 40;

const tierPrice = (row: { list_price: number | null; tier2: number | null; tier3: number | null; tier4: number | null }, t: number) =>
  (t <= 1 ? row.list_price : t === 2 ? row.tier2 : t === 3 ? row.tier3 : row.tier4);
const bottom = (row: CatalogRow) => Math.min(Number(row.tier4 ?? row.list_price ?? 0), Number(row.client_price ?? row.tier4 ?? row.list_price ?? 0));
const linePrice = (l: Line): number | null => {
  if (l.mode === 'custom') { const n = Number(l.price); return l.price.trim() !== '' && Number.isFinite(n) ? r2(n) : null; }
  if (l.mode === 'client') return l.row.client_price ?? l.row.list_price;
  return tierPrice(l.row, Number(l.mode));
};
const range = (r: { list_price: number | null; tier4: number | null }) =>
  r.list_price == null ? 'No price yet' : r.tier4 == null || Number(r.tier4) === Number(r.list_price) ? peso(r.list_price) : `${peso(r.tier4)} – ${peso(r.list_price)}`;

function stockBadge(r: { item_type: string; stock_type: string | null; available: number | null; unit: string }) {
  if (r.item_type === 'service') return { t: 'Service', c: 'bg-slate-100 text-slate-700' };
  const a = Number(r.available ?? 0);
  if (a > 0) return { t: `${qty(a)} ${r.unit} available`, c: 'bg-emerald-50 text-emerald-700' };
  if (r.stock_type === 'order_only') return { t: 'Order only', c: 'bg-sky-50 text-sky-800' };
  return { t: 'No stock — can be ordered', c: 'bg-amber-50 text-amber-800' };
}

export function AgentCatalog({ businessId, clients, categories, initialClient, order, share }: {
  businessId: string; clients: AgentClient[]; categories: string[]; tiers?: number[]; initialClient: string; order: any | null;
  share?: { brand: ShareBrand; agent: ShareAgent };
}) {
  const router = useRouter();
  const storeKey = `ibx-agent-basket:${businessId}`;
  // Build 102a: the catalogue remembers its view per store (search, filters, client, open product, scroll) for 12 hours,
  // so leaving for another screen or another app and coming back shows the same list
  const viewKey = `ibx-agent-catalog-view:${businessId}`;
  const [view] = useState<{ q?: string; category?: string; inStock?: boolean; clientId?: string; detailId?: string | null; scroll?: number } | null>(() => {
    if (typeof window === 'undefined' || order) return null;
    try { const v = JSON.parse(localStorage.getItem(viewKey) || 'null'); return v && Date.now() - v.t < 12 * 3600000 ? v : null; } catch { return null; }
  });
  const mem = !order ? memory.get(businessId) ?? null : null;
  const warm = !!mem && Date.now() - mem.t < FRESH;
  const viewClient = view?.clientId && clients.some((c) => c.customer_id === view.clientId) ? view.clientId : '';
  const [clientId, setClientId] = useState(initialClient && clients.some((c) => c.customer_id === initialClient) ? initialClient : mem ? mem.clientId : viewClient);
  const [q, setQ] = useState(mem?.q ?? view?.q ?? '');
  const [category, setCategory] = useState(mem?.category ?? view?.category ?? '');
  const [inStock, setInStock] = useState(mem?.inStock ?? view?.inStock ?? false);
  const [rows, setRows] = useState<CatalogRow[]>(warm ? mem!.rows : []);
  const [lines, setLines] = useState<Line[]>(warm ? mem!.lines : []);
  const [notes, setNotes] = useState(order?.notes ?? mem?.notes ?? '');
  const [terms, setTerms] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [kind, setKind] = useState<'order' | 'quote'>('order');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(mem ? mem.detailId : view?.detailId ?? null);
  const [toast, setToast] = useState('');
  const [pending, start] = useTransition();
  const restored = useRef(false);
  const client = clients.find((c) => c.customer_id === clientId);
  const total = r2(lines.reduce((s, l) => s + (linePrice(l) ?? 0) * (Number(l.quantity) || 0), 0));
  const count = lines.length;

  const fetchedAt = useRef(warm ? mem!.t : Date.now());
  const search = useCallback(async (append = false) => {
    setError(''); setLoading(true); fetchedAt.current = Date.now();
    try {
      const got = await catalogAction({ business_id: businessId, customer_id: clientId || null, q, category, in_stock: inStock, offset: append ? rows.length : 0 });
      setRows(append ? [...rows, ...got] : got);
    } catch (e) { setError(errorText(e)); }
    setLoading(false);
  }, [businessId, clientId, q, category, inStock, rows]);

  // reprice the basket for the chosen client (and load a draft order's / a saved basket's lines)
  async function reprice(base: Saved[]) {
    const out: Line[] = [];
    for (const b of base) {
      const found = (await catalogAction({ business_id: businessId, customer_id: clientId || null, q: b.item_code })).find((r) => r.item_id === b.item_id);
      if (found) out.push({ key: ++lineKey, row: found, quantity: b.quantity, mode: b.mode === 'client' && !clientId ? '1' : b.mode, price: b.price });
    }
    setLines(out);
  }
  const toSaved = (ls: Line[]): Saved[] => ls.map((l) => ({ item_code: l.row.item_code, item_id: l.row.item_id, quantity: l.quantity, mode: l.mode, price: l.price }));

  // Build 102a: keep the view; put the scroll back once the list is loaded again
  useEffect(() => {
    if (order) return;
    const keep = () => { try { localStorage.setItem(viewKey, JSON.stringify({ q, category, inStock, clientId, detailId, scroll: window.scrollY, t: Date.now() })); } catch { /* */ } };
    keep();
    window.addEventListener('scroll', keep, { passive: true }); window.addEventListener('pagehide', keep);
    document.addEventListener('visibilitychange', keep);
    return () => { window.removeEventListener('scroll', keep); window.removeEventListener('pagehide', keep); document.removeEventListener('visibilitychange', keep); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, inStock, clientId, detailId]);
  const latest = useRef<Omit<Memory, 'scroll' | 't'> | null>(null);
  const scrollY = useRef(mem?.scroll ?? 0);
  latest.current = { rows, lines, q, category, inStock, clientId, detailId, notes };
  useEffect(() => {
    if (order) return;
    const onScroll = () => { scrollY.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (latest.current) memory.set(businessId, { ...latest.current, scroll: scrollY.current, t: fetchedAt.current }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !rows.length) return;
    scrolled.current = true;
    const y = mem ? mem.scroll : view?.scroll;
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  // search as the agent types (short pause), and when the filters change
  const skipFirst = useRef(warm);
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }   // list kept from before: no reload
    const t = setTimeout(() => search(false), q ? 400 : 0); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId, q, category, inStock]);
  // first load: a draft order being edited, or this store's saved basket
  const pendingRestore = useRef<Saved[] | null>(null);
  useEffect(() => {
    if (order?.lines?.length) {
      reprice(order.lines.map((l: any) => ({ item_code: l.item_code, item_id: l.item_id, quantity: String(l.quantity), mode: (l.tier ? String(l.tier) : 'custom') as Mode, price: String(l.unit_price) })))
        .then(() => setBasketOpen(true));
      return;
    }
    if (warm) { restored.current = true; return; }   // Build 102b: basket kept in memory, already priced
    let saved: any = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch { /* storage unavailable */ }
    if (!saved?.lines?.length) { restored.current = true; return; }
    if (saved.notes) setNotes(saved.notes);
    if (!initialClient && saved.clientId && saved.clientId !== clientId && clients.some((c) => c.customer_id === saved.clientId)) {
      pendingRestore.current = saved.lines;   // the client effect below reprices for him
      setClientId(saved.clientId);
    } else reprice(saved.lines).finally(() => { restored.current = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // client changed: reprice what is in the basket
  const firstClient = useRef(true);
  useEffect(() => {
    if (firstClient.current) { firstClient.current = false; return; }
    if (pendingRestore.current) {
      const base = pendingRestore.current; pendingRestore.current = null;
      reprice(base).finally(() => { restored.current = true; });
      return;
    }
    if (lines.length) reprice(toSaved(lines).map((l) => ({ ...l, mode: clientId ? 'client' : l.mode === 'client' ? '1' : l.mode })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  // keep the basket for this store (not for a draft order: that is saved on the server)
  useEffect(() => {
    if (!restored.current || order) return;
    try {
      if (lines.length) localStorage.setItem(storeKey, JSON.stringify({ clientId, notes, lines: toSaved(lines) }));
      else localStorage.removeItem(storeKey);
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, clientId, notes]);

  const add = (row: CatalogRow, quantity = 1, mode?: Mode, price = '') => {
    if (row.list_price == null) { setError(`${row.item_name} has no store price yet.`); return; }
    const m: Mode = mode ?? (clientId ? 'client' : '1');
    const i = lines.findIndex((l) => l.row.item_id === row.item_id);
    if (i >= 0) setLines(lines.map((l, j) => (j === i ? { ...l, quantity: String((Number(l.quantity) || 0) + quantity), ...(mode ? { mode: m, price } : {}) } : l)));
    else setLines([...lines, { key: ++lineKey, row, quantity: String(quantity), mode: m, price }]);
    setToast(`Added ${row.item_name}`);
    setTimeout(() => setToast(''), 1600);
  };
  const set = (k: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  function save(send: boolean) {
    setError('');
    if (!clientId) { setError('Choose the client first (top of the catalogue).'); return; }
    if (!lines.length) { setError('Add at least one item.'); return; }
    for (const l of lines) {
      if (!(Number(l.quantity) > 0)) { setError(`${l.row.item_name}: enter a quantity.`); return; }
      const p = linePrice(l);
      if (l.mode === 'custom' && (p == null || p < bottom(l.row))) { setError(`${l.row.item_name}: the lowest price you can give is ${peso(bottom(l.row))} (Tier 4).`); return; }
      if (l.mode === 'custom' && p != null && l.row.list_price != null && p > Number(l.row.list_price)) { setError(`${l.row.item_name}: the price cannot be above the store price.`); return; }
    }
    const lineInput = lines.map((l) => ({ item_id: l.row.item_id, quantity: Number(l.quantity), tier: ['1', '2', '3', '4'].includes(l.mode) ? Number(l.mode) : null,
      unit_price: l.mode === 'custom' ? Number(l.price) : null }));
    const done = (to: string) => { try { localStorage.removeItem(storeKey); } catch { /* */ } setLines([]); router.push(to); };
    start(async () => {
      try {
        if (kind === 'quote') {
          await saveQuoteAction({ business_id: businessId, customer_id: clientId, notes, payment_terms: terms, delivery_lead_time: leadTime, lines: lineInput });
          done(`/agent/quotations?b=${businessId}`);
        } else {
          await saveOrderAction({ id: order?.id ?? null, business_id: businessId, customer_id: clientId, notes, send, lines: lineInput });
          done(`/agent/orders?b=${businessId}`);
        }
      } catch (e) { setError(errorText(e)); }
    });
  }

  const detailRow = rows.find((r) => r.item_id === detailId) ?? lines.find((l) => l.row.item_id === detailId)?.row ?? null;

  return (
    <div className="space-y-3">
      {/* client first: it decides every price on the page */}
      <div className="space-y-2 rounded-xl border bg-white p-3">
        <label className="block text-xs font-medium text-slate-600">Client
          <select className="input mt-1" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— no client: show price ranges —</option>
            {clients.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.legal_name} · Tier {c.price_tier}</option>)}
          </select>
        </label>
        <input className="input" type="search" value={q} placeholder="Search item, code, brand" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(false); }} />
        <div className="flex items-center gap-2">
          <select className="input flex-1" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex flex-none items-center gap-1 text-sm"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock</label>
        </div>
        {order && <div className="rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">Editing draft order {order.order_number}. <button type="button" className="underline" onClick={() => setBasketOpen(true)}>Open it</button></div>}
      </div>

      {/* the order button — always at hand (top of the list; floating above the menu on a phone) */}
      <button type="button" onClick={() => setBasketOpen(true)}
        className="hidden w-full items-center justify-between rounded-xl bg-[rgb(var(--btn))] px-4 py-3 text-sm font-semibold text-[rgb(var(--on-btn))] shadow md:flex">
        <span>{order ? `Order ${order.order_number}` : kind === 'quote' ? 'Quotation' : 'Order'} · {count} item{count === 1 ? '' : 's'}{client ? ` · ${client.legal_name}` : ''}</span><span>{peso(total)} →</span>
      </button>
      {count > 0 && (
        <button type="button" onClick={() => setBasketOpen(true)}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between rounded-full bg-[rgb(var(--btn))] px-5 py-3 text-sm font-semibold text-[rgb(var(--on-btn))] shadow-lg md:hidden">
          <span>{count} item{count === 1 ? '' : 's'} · {client ? client.legal_name : 'pick a client'}</span><span>{peso(total)} →</span>
        </button>
      )}
      {toast && <div className="fixed inset-x-0 top-20 z-50 mx-auto w-fit rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow">{toast}</div>}
      {error && !basketOpen && <p className="text-sm text-red-700">{error}</p>}
      {client && <p className="text-xs text-slate-600">Showing <b>{client.legal_name}</b>&apos;s prices (Tier {client.price_tier}; his own item discounts apply when lower).</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const badge = stockBadge(r);
          const inBasket = lines.find((l) => l.row.item_id === r.item_id);
          return (
            <div key={r.item_id} className="flex gap-3 rounded-xl border bg-white p-3">
              <button type="button" className="h-24 w-24 flex-none overflow-hidden rounded-lg border bg-slate-50" onClick={() => setDetailId(r.item_id)} aria-label={`Open ${r.item_name}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.photo_url ? <img src={r.photo_url} alt={r.item_name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-slate-400">No photo</span>}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <button type="button" className="text-left font-medium leading-snug hover:underline" onClick={() => setDetailId(r.item_id)}>{r.item_name}</button>
                <div className="truncate text-xs text-slate-500">{r.item_code}{r.brand ? ` · ${r.brand}` : ''}</div>
                <span className={`w-fit rounded px-2 py-0.5 text-[11px] font-medium ${badge.c}`}>{badge.t}</span>
                <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                  <div>
                    <div className={`font-semibold ${clientId ? 'text-lg' : 'text-sm'}`}>{clientId ? peso(r.client_price ?? r.list_price) : range(r)}</div>
                    <div className="text-[11px] text-slate-500">per {r.unit}{!clientId && r.list_price != null ? ' · Tier 4 – Tier 1' : ''}</div>
                  </div>
                  <button type="button" className={inBasket ? 'button-secondary px-3 text-xs' : 'button px-3 text-xs'} disabled={r.list_price == null} onClick={() => add(r)}>
                    {inBasket ? `+1 (${qty(inBasket.quantity)})` : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!rows.length && <div className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">{loading ? 'Searching…' : 'No items found.'}</div>}
      {rows.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs text-slate-500">{rows.length} of {Number(rows[0].total_count).toLocaleString()} item(s)</span>
          {rows.length < Number(rows[0].total_count) && rows.length % PAGE === 0 && <button type="button" className="button-secondary" disabled={loading} onClick={() => search(true)}>{loading ? 'Loading…' : 'Show more'}</button>}
        </div>
      )}

      {detailId && detailRow && (
        <ProductSheet share={share} businessId={businessId} row={detailRow} clientId={clientId} clientName={client?.legal_name ?? null} onClose={() => setDetailId(null)}
          onAdd={(n, mode, price) => { add(detailRow, n, mode, price); setDetailId(null); }} />
      )}

      {basketOpen && (
        <Sheet title={order ? `Order ${order.order_number}` : kind === 'quote' ? 'New quotation' : 'New order'} onClose={() => setBasketOpen(false)}
          actions={
            <div className="space-y-2">
              {!order && (
                <div className="grid grid-cols-2 rounded-lg border p-0.5 text-sm">
                  {(['order', 'quote'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md py-1.5 ${kind === k ? 'bg-slate-900 font-semibold text-white' : 'text-slate-600'}`}>
                      {k === 'order' ? 'Order to store' : 'Quotation'}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                {kind === 'order' ? (
                  <>
                    <button type="button" className="button flex-1" disabled={pending || !count || !clientId} onClick={() => save(true)}>{pending ? 'Saving…' : 'Send to store'}</button>
                    <button type="button" className="button-secondary flex-1" disabled={pending || !count || !clientId} onClick={() => save(false)}>Save draft</button>
                  </>
                ) : (
                  <button type="button" className="button flex-1" disabled={pending || !count || !clientId} onClick={() => save(false)}>{pending ? 'Saving…' : 'Save quotation for approval'}</button>
                )}
              </div>
              <div className="flex items-center justify-between text-sm"><span className="text-slate-600">{count} item{count === 1 ? '' : 's'}</span><span className="text-base font-semibold">Total {peso(total)}</span></div>
              {error && <p className="text-sm text-red-700">{error}</p>}
            </div>
          }>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600">Client
              <select className="input mt-1" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— choose the client —</option>
                {clients.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.legal_name} · Tier {c.price_tier}</option>)}
              </select>
            </label>
            {order?.store_note && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Returned by the store: {order.store_note}</div>}
            {kind === 'quote' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="Payment terms (e.g. 30 days)" value={terms} onChange={(e) => setTerms(e.target.value)} />
                <input className="input" placeholder="Delivery lead time" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
                <p className="text-xs text-slate-500 sm:col-span-2">Goes to the Sales approver; print it for the client once approved. Valid 15 days.</p>
              </div>
            )}
            <textarea className="input" rows={2} placeholder={kind === 'quote' ? 'Notes / project name' : 'Notes for the store (delivery, terms…)'} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {!count && <p className="py-4 text-center text-sm text-slate-500">Nothing yet — add items from the catalogue.</p>}
            {lines.map((l) => {
              const p = linePrice(l);
              return (
                <div key={l.key} className="space-y-2 rounded-lg border p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => setDetailId(l.row.item_id)}>
                      <div className="font-medium leading-snug">{l.row.item_name}</div>
                      <div className="text-xs text-slate-500">{l.row.item_code} · {stockBadge(l.row).t}</div>
                    </button>
                    <button type="button" className="flex-none text-xs text-red-700" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-none items-center rounded-lg border">
                      <button type="button" className="px-3 py-1.5 text-lg leading-none" onClick={() => set(l.key, { quantity: String(Math.max(0, (Number(l.quantity) || 0) - 1)) })} aria-label="Less">−</button>
                      <input className="w-14 border-x py-1.5 text-center text-base outline-none" inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                      <button type="button" className="px-3 py-1.5 text-lg leading-none" onClick={() => set(l.key, { quantity: String((Number(l.quantity) || 0) + 1) })} aria-label="More">+</button>
                    </div>
                    <PriceSelect row={l.row} clientId={clientId} mode={l.mode} onChange={(m) => set(l.key, { mode: m, price: m === 'custom' ? String(p ?? '') : l.price })} />
                  </div>
                  {l.mode === 'custom' && (
                    <div className="flex items-center gap-2"><input className="input" inputMode="decimal" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} aria-label="Price" />
                      <span className="whitespace-nowrap text-xs text-slate-500">lowest {peso(bottom(l.row))}</span></div>
                  )}
                  <div className="flex justify-between text-xs text-slate-600"><span>{peso(p)} each</span><span className="text-sm font-semibold text-slate-900">{peso(r2((p ?? 0) * (Number(l.quantity) || 0)))}</span></div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">Everything here is recorded in this store. The store sees sent orders on the Storefront (Agent orders); prices are checked again when saved.</p>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function PriceSelect({ row, clientId, mode, onChange }: { row: CatalogRow | ProductDetail; clientId: string; mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <select className="input min-w-0 flex-1" value={mode} onChange={(e) => onChange(e.target.value as Mode)} aria-label="Price">
      {clientId && <option value="client">Client price · {peso(row.client_price ?? row.list_price)}</option>}
      <option value="1">Tier 1 · {peso(row.list_price)}</option>
      <option value="2">Tier 2 · {peso(row.tier2)}</option>
      <option value="3">Tier 3 · {peso(row.tier3)}</option>
      <option value="4">Tier 4 · {peso(row.tier4)}</option>
      <option value="custom">My price…</option>
    </select>
  );
}

function ProductSheet({ share, businessId, row, clientId, clientName, onClose, onAdd }: {
  share?: { brand: ShareBrand; agent: ShareAgent }; businessId: string; row: CatalogRow; clientId: string; clientName: string | null; onClose: () => void; onAdd: (n: number, mode: Mode, price: string) => void;
}) {
  const [d, setD] = useState<ProductDetail | null>(null);
  const [err, setErr] = useState('');
  const [capital, setCapital] = useState(false);
  const [n, setN] = useState('1');
  const [mode, setMode] = useState<Mode>(clientId ? 'client' : '1');
  const [price, setPrice] = useState('');
  useEffect(() => {
    let live = true;
    productDetailAction({ business_id: businessId, item_id: row.item_id, customer_id: clientId || null }).then((x) => { if (live) setD(x); }).catch((e) => live && setErr(errorText(e)));
    return () => { live = false; };
  }, [businessId, row.item_id, clientId]);
  const p = d ?? row;
  const badge = stockBadge(p);
  const low = Math.min(Number(p.tier4 ?? p.list_price ?? 0), Number(p.client_price ?? p.tier4 ?? p.list_price ?? 0));
  const priceOk = mode !== 'custom' || (Number(price) >= low && Number(price) <= Number(p.list_price ?? 0));
  const photos = d?.photo_urls?.length ? d.photo_urls : row.photo_url ? [row.photo_url] : [];
  return (
    <Sheet title={p.item_name} onClose={onClose}
      actions={
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex flex-none items-center rounded-lg border">
              <button type="button" className="px-3 py-1.5 text-lg leading-none" onClick={() => setN(String(Math.max(1, (Number(n) || 1) - 1)))} aria-label="Less">−</button>
              <input className="w-14 border-x py-1.5 text-center text-base outline-none" inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} aria-label="Quantity" />
              <button type="button" className="px-3 py-1.5 text-lg leading-none" onClick={() => setN(String((Number(n) || 0) + 1))} aria-label="More">+</button>
            </div>
            <PriceSelect row={p} clientId={clientId} mode={mode} onChange={(m) => { setMode(m); if (m === 'custom' && !price) setPrice(String(p.client_price ?? p.list_price ?? '')); }} />
          </div>
          {mode === 'custom' && <div className="flex items-center gap-2"><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Your price" />
            <span className="whitespace-nowrap text-xs text-slate-500">lowest {peso(low)}</span></div>}
          <button type="button" className="button w-full" disabled={p.list_price == null || !(Number(n) > 0) || !priceOk} onClick={() => onAdd(Number(n), mode, mode === 'custom' ? price : '')}>
            Add to order
          </button>
        </div>
      }>
      <div className="space-y-4">
        {photos.length > 0 ? (
          <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photos.map((u) => <img key={u} src={u} alt={p.item_name} className="h-64 w-full flex-none snap-center rounded-lg border bg-slate-50 object-contain sm:w-auto sm:max-w-full" />)}
          </div>
        ) : <div className="flex h-32 items-center justify-center rounded-lg border bg-slate-50 text-sm text-slate-400">No photo</div>}
        <div className="space-y-1">
          <div className="text-xs text-slate-500">{p.item_code}{d ? ` · ${[d.category, d.generic_item, d.brand].filter(Boolean).join(' · ')}` : ''}</div>
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${badge.c}`}>{badge.t}</span>
          {d && d.on_hand != null && Number(d.reserved) > 0 && <div className="text-xs text-slate-600">{qty(d.on_hand)} on hand, {qty(d.reserved)} reserved for sales orders.</div>}
        </div>
        <div className="rounded-lg border bg-slate-50 p-3">
          {clientId ? (
            <>
              <div className="text-xs text-slate-500">Price for {clientName}</div>
              <div className="text-2xl font-semibold">{peso(p.client_price ?? p.list_price)} <span className="text-sm font-normal text-slate-500">per {p.unit}</span></div>
              {p.client_discount != null && <div className="text-xs text-slate-500">His own discount on this item: {Number(Number(p.client_discount).toFixed(4))}%</div>}
            </>
          ) : (
            <>
              <div className="text-xs text-slate-500">Price range (Tier 4 – Tier 1)</div>
              <div className="text-2xl font-semibold">{range(p)} <span className="text-sm font-normal text-slate-500">per {p.unit}</span></div>
              <div className="text-xs text-slate-500">Pick a client to see his price.</div>
            </>
          )}
        </div>
        {share && (() => {
          // Build 102: the card shows the price picked below (the client's price, a tier, or "My price")
          const sp = mode === 'custom' ? (priceOk && price.trim() !== '' ? Number(price) : null) : mode === 'client' ? (p.client_price ?? p.list_price) : tierPrice(p, Number(mode));
          return <ShareImageButton brand={share.brand} agent={share.agent}
            item={sp == null ? null : { item_code: p.item_code, item_name: p.item_name, unit: p.unit, specification: d?.specification ?? null, photo: photos[0] ?? null, price: Number(sp) }} />;
        })()}
        {d?.description && <p className="whitespace-pre-line text-sm text-slate-700">{d.description}</p>}
        {d?.specification && <div><div className="text-xs font-medium uppercase text-slate-500">Specification</div><p className="whitespace-pre-line text-sm text-slate-700">{d.specification}</p></div>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capital} onChange={(e) => setCapital(e.target.checked)} /> Show capital</label>
        {capital && (
          <table className="w-full text-sm">
            <tbody className="divide-y">
              <tr><td className="py-1 text-slate-500">Capital (cost)</td><td className="py-1 text-right font-medium">{peso(p.acquisition_cost)}</td></tr>
              <tr><td className="py-1 text-slate-500">Markup</td><td className="py-1 text-right">{p.markup_percent == null ? '—' : `${Number(Number(p.markup_percent).toFixed(2))}%`}</td></tr>
              <tr><td className="py-1 text-slate-500">Floor price</td><td className="py-1 text-right">{peso(p.floor_price)}</td></tr>
              {[1, 2, 3, 4].map((t) => <tr key={t}><td className="py-1 text-slate-500">Tier {t}{t === 1 ? ' (store price)' : ''}</td><td className="py-1 text-right">{peso(tierPrice(p, t))}</td></tr>)}
            </tbody>
          </table>
        )}
        {err && <p className="text-sm text-red-700">{err}</p>}
      </div>
    </Sheet>
  );
}
