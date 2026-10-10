'use client';
// Build 91 — agent catalogue: search the store's catalogue, see stock, cost,
// markup, store price, Tier 2–4 and the chosen client's price; put items in an
// order basket (client price, a tier, or a price of your own down to Tier 4)
// and save it as a draft or send it to the store.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { catalogAction, saveOrderAction, type CatalogRow } from './agentActions';
import { peso, qty } from './AgentHeader';
import type { AgentClient } from './AgentClients';

type Mode = 'client' | '1' | '2' | '3' | '4' | 'custom';
type Line = { key: number; row: CatalogRow; quantity: string; mode: Mode; price: string };
let lineKey = 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

const tierPrice = (row: CatalogRow, t: number) => (t <= 1 ? row.list_price : t === 2 ? row.tier2 : t === 3 ? row.tier3 : row.tier4);
const bottom = (row: CatalogRow) => Math.min(Number(row.tier4 ?? row.list_price ?? 0), Number(row.client_price ?? row.tier4 ?? row.list_price ?? 0));
const linePrice = (l: Line): number | null => {
  if (l.mode === 'custom') { const n = Number(l.price); return l.price.trim() !== '' && Number.isFinite(n) ? r2(n) : null; }
  if (l.mode === 'client') return l.row.client_price ?? l.row.list_price;
  return tierPrice(l.row, Number(l.mode));
};
const giveText = (row: CatalogRow, price: number | null) => {
  if (price == null || row.list_price == null || row.acquisition_cost == null) return '';
  const markup = Number(row.list_price) - Number(row.acquisition_cost);
  if (markup <= 0) return '';
  return `${Math.round(((Number(row.list_price) - price) / markup) * 10000) / 100}% of markup off`;
};

export function AgentCatalog({ businessId, clients, categories, tiers, initialClient, order }: {
  businessId: string; clients: AgentClient[]; categories: string[]; tiers: number[]; initialClient: string; order: any | null;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initialClient && clients.some((c) => c.customer_id === initialClient) ? initialClient : '');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [inStock, setInStock] = useState(false);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();
  const client = clients.find((c) => c.customer_id === clientId);
  const total = r2(lines.reduce((s, l) => s + (linePrice(l) ?? 0) * (Number(l.quantity) || 0), 0));

  async function search(nextOffset = 0) {
    setError(''); setLoading(true);
    try { setRows(await catalogAction({ business_id: businessId, customer_id: clientId || null, q, category, in_stock: inStock, offset: nextOffset })); setOffset(nextOffset); }
    catch (e) { setError(errorText(e)); }
    setLoading(false);
  }
  // reprice the basket for the chosen client (and load a draft order's lines)
  async function reprice(base: { item_code: string; item_id: string; quantity: string; mode: Mode; price: string }[]) {
    const out: Line[] = [];
    for (const b of base) {
      const found = (await catalogAction({ business_id: businessId, customer_id: clientId || null, q: b.item_code })).find((r) => r.item_id === b.item_id);
      if (found) out.push({ key: ++lineKey, row: found, quantity: b.quantity, mode: b.mode, price: b.price });
    }
    setLines(out);
  }
  useEffect(() => { search(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);
  useEffect(() => {
    if (order?.lines?.length) reprice(order.lines.map((l: any) => ({ item_code: l.item_code, item_id: l.item_id, quantity: String(l.quantity), mode: (l.tier ? String(l.tier) : 'custom') as Mode, price: String(l.unit_price) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (lines.length) reprice(lines.map((l) => ({ item_code: l.row.item_code, item_id: l.row.item_id, quantity: l.quantity, mode: l.mode, price: l.price })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const add = (row: CatalogRow) => {
    if (row.list_price == null) { setError(`${row.item_name} has no store price yet.`); return; }
    const i = lines.findIndex((l) => l.row.item_id === row.item_id);
    if (i >= 0) setLines(lines.map((l, j) => (j === i ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l)));
    else setLines([...lines, { key: ++lineKey, row, quantity: '1', mode: clientId ? 'client' : '1', price: '' }]);
  };
  const set = (k: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  function save(send: boolean) {
    setError('');
    if (!clientId) { setError('Choose the client.'); return; }
    if (!lines.length) { setError('Add at least one item.'); return; }
    for (const l of lines) {
      if (!(Number(l.quantity) > 0)) { setError(`${l.row.item_name}: enter a quantity.`); return; }
      const p = linePrice(l);
      if (l.mode === 'custom' && (p == null || p < bottom(l.row))) { setError(`${l.row.item_name}: the lowest price you can give is ${peso(bottom(l.row))} (Tier 4).`); return; }
      if (l.mode === 'custom' && p != null && l.row.list_price != null && p > Number(l.row.list_price)) { setError(`${l.row.item_name}: the price cannot be above the store price.`); return; }
    }
    start(async () => {
      try {
        await saveOrderAction({
          id: order?.id ?? null, business_id: businessId, customer_id: clientId, notes, send,
          lines: lines.map((l) => ({ item_id: l.row.item_id, quantity: Number(l.quantity), tier: ['1', '2', '3', '4'].includes(l.mode) ? Number(l.mode) : null,
            unit_price: l.mode === 'custom' ? Number(l.price) : null })),
        });
        router.push(`/agent/orders?b=${businessId}`);
      } catch (e) { setError(errorText(e)); }
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3 text-sm">
          <label className="block">Client
            <select className="input mt-1 min-w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— store prices only —</option>
              {clients.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.legal_name} (Tier {c.price_tier})</option>)}
            </select>
          </label>
          <label className="block">Search<input className="input mt-1 w-56" value={q} placeholder="Item, code, brand" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(0); }} /></label>
          <label className="block">Category
            <select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 pb-2"><input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} /> In stock</label>
          <button type="button" className="button" disabled={loading} onClick={() => search(0)}>{loading ? 'Searching…' : 'Search'}</button>
        </div>
        {client && <div className="text-xs text-slate-600">Prices for <b>{client.legal_name}</b>: usual tier {client.price_tier} ({client.price_tier <= 1 ? 'store price' : `−${Number(tiers[client.price_tier - 1].toFixed(2))}% of markup`}); the client&apos;s own item discounts apply when lower.</div>}
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Item</th><th className="p-2 text-right">Available</th><th className="p-2 text-right">Cost</th><th className="p-2 text-right">Markup</th>
                <th className="p-2 text-right">Store (T1)</th><th className="p-2 text-right">T2</th><th className="p-2 text-right">T3</th><th className="p-2 text-right">T4</th>
                {clientId && <th className="p-2 text-right">Client price</th>}<th className="p-2"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id} className="border-t align-top">
                  <td className="p-2"><div className="flex gap-2">{r.photo_url ? <img src={r.photo_url} alt="" className="h-10 w-10 rounded border object-contain" /> : <div className="h-10 w-10 rounded border bg-slate-50" />}
                    <div><div className="font-medium">{r.item_name}</div><div className="text-xs text-slate-500">{r.item_code}{r.brand ? ` · ${r.brand}` : ''}{r.stock_type === 'order_only' ? ' · order only' : ''}</div></div></div></td>
                  <td className="p-2 text-right">{r.item_type === 'service' ? '—' : qty(r.available)}</td>
                  <td className="p-2 text-right text-xs">{peso(r.acquisition_cost)}</td>
                  <td className="p-2 text-right text-xs">{r.markup_percent == null ? '—' : `${Number(Number(r.markup_percent).toFixed(2))}%`}</td>
                  <td className="p-2 text-right">{peso(r.list_price)}</td>
                  <td className="p-2 text-right text-xs">{peso(r.tier2)}</td>
                  <td className="p-2 text-right text-xs">{peso(r.tier3)}</td>
                  <td className="p-2 text-right text-xs">{peso(r.tier4)}{r.tier4 != null && r.floor_price != null && Number(r.tier4) <= Number(r.floor_price) && <div className="text-[10px] text-amber-700">floor reached</div>}</td>
                  {clientId && <td className="p-2 text-right font-semibold">{peso(r.client_price)}{r.client_discount != null && <div className="text-[10px] font-normal text-slate-500">own discount {Number(Number(r.client_discount).toFixed(4))}%</div>}</td>}
                  <td className="p-2"><button type="button" className="button-secondary text-xs" onClick={() => add(r)} disabled={r.list_price == null}>Add</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="p-6 text-center text-slate-500">{loading ? 'Searching…' : 'No items found.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {offset > 0 && <button type="button" className="button-secondary" onClick={() => search(Math.max(0, offset - 40))}>← Previous</button>}
          {rows.length === 40 && <button type="button" className="button-secondary" onClick={() => search(offset + 40)}>Next →</button>}
          {rows[0] && <span className="text-xs text-slate-500">{Number(rows[0].total_count).toLocaleString()} item(s)</span>}
        </div>
      </section>

      <aside className="h-fit space-y-3 rounded-xl border bg-white p-4 xl:sticky xl:top-4">
        <h3 className="font-semibold">{order ? `Order ${order.order_number}` : 'New order'}{client ? ` · ${client.legal_name}` : ''}</h3>
        {order?.store_note && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Returned by the store: {order.store_note}</div>}
        {!lines.length && <p className="text-sm text-slate-500">Add items from the catalogue.</p>}
        {lines.map((l) => {
          const p = linePrice(l);
          return (
            <div key={l.key} className="space-y-1 rounded border p-2 text-sm">
              <div className="flex justify-between gap-2"><div><div className="font-medium">{l.row.item_name}</div><div className="text-xs text-slate-500">{l.row.item_code} · {peso(l.row.list_price)} store</div></div>
                <button type="button" className="text-xs text-red-700" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button></div>
              <div className="grid grid-cols-3 gap-2">
                <input className="input" type="number" min="0" step="any" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                <select className="input col-span-2" value={l.mode} onChange={(e) => set(l.key, { mode: e.target.value as Mode, price: e.target.value === 'custom' ? String(p ?? '') : l.price })}>
                  {clientId && <option value="client">Client price {peso(l.row.client_price)}</option>}
                  <option value="1">Tier 1 · {peso(l.row.list_price)}</option>
                  <option value="2">Tier 2 · {peso(l.row.tier2)}</option>
                  <option value="3">Tier 3 · {peso(l.row.tier3)}</option>
                  <option value="4">Tier 4 · {peso(l.row.tier4)}</option>
                  <option value="custom">My price…</option>
                </select>
              </div>
              {l.mode === 'custom' && <div className="flex items-center gap-2"><input className="input" type="number" min={bottom(l.row)} step="0.01" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} aria-label="Price" />
                <span className="whitespace-nowrap text-xs text-slate-500">lowest {peso(bottom(l.row))}</span></div>}
              <div className="flex justify-between text-xs text-slate-600"><span>{giveText(l.row, p)}</span><span className="font-medium text-slate-900">{peso(r2((p ?? 0) * (Number(l.quantity) || 0)))}</span></div>
            </div>
          );
        })}
        <textarea className="input" rows={2} placeholder="Notes for the store (delivery, terms…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-between text-sm font-semibold"><span>Total</span><span>{peso(total)}</span></div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button" disabled={pending || !lines.length || !clientId} onClick={() => save(true)}>{pending ? 'Saving…' : 'Send to store'}</button>
          <button type="button" className="button-secondary" disabled={pending || !lines.length || !clientId} onClick={() => save(false)}>Save draft</button>
        </div>
        <p className="text-xs text-slate-500">The store sees sent orders on the Storefront (Agent orders) and makes the sale. Prices are checked again when saved.</p>
      </aside>
    </div>
  );
}
