'use client';

// Build 78 — quick price review (CAT-36). One row per item: supplier cost →
// category add-on → acquisition cost → markup → store price. Type a new markup
// or a new store price and save the row (the store price sets the markup);
// category add-ons on their own tab. Changes apply at once and are logged.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { itemPurchasesAction, setCategoryAddonAction, setItemPriceAction } from './actions';

type Row = { item_id: string; item_code: string; item_name: string; category: string | null; category_id: string | null; brand: string | null; unit: string; item_type: string;
  supplier: string | null; supplier_cost: number; cost_basis: number; cost_age_days: number | null; addon_percent: number; acquisition_cost: number; markup_percent: number; store_price: number;
  below_7: boolean; last_changed_at: string | null; last_changed_by: string | null; total_count: number };
type Category = { category_id: string; name: string; addon_percent: number; items: number };
type Change = { id: string; changed_at: string; changed_by: string | null; kind: string; item_code: string | null; item_name: string | null; category: string | null;
  old_percent: number | null; new_percent: number | null; old_store_price: number | null; new_store_price: number | null; items_affected: number | null };
type Filters = { q: string; category: string; brand: string; supplier: string };

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: unknown) => (v == null ? '—' : `${Number(Number(v).toFixed(2))}%`);
const r2 = (n: number) => Math.round(n * 100) / 100;
const KIND: Record<string, string> = { item_markup: 'Markup', store_price: 'Store price', category_addon: 'Category add-on' };

function ItemRow({ r, onMessage }: { r: Row; onMessage: (m: string, ok: boolean) => void }) {
  const [markup, setMarkup] = useState(String(Number(Number(r.markup_percent).toFixed(4))));
  const [price, setPrice] = useState(String(Number(r.store_price).toFixed(2)));
  const [pending, start] = useTransition();
  const [buys, setBuys] = useState<Awaited<ReturnType<typeof itemPurchasesAction>> | null>(null);
  const [showBuys, setShowBuys] = useState(false);
  const toggleBuys = () => { setShowBuys(!showBuys); if (!buys) itemPurchasesAction(r.item_id).then(setBuys).catch((e) => onMessage(errorText(e), false)); };
  const acq = Number(r.acquisition_cost);
  const m = Number(markup), p = Number(price);
  const markupChanged = markup.trim() !== '' && Number.isFinite(m) && Math.abs(m - Number(r.markup_percent)) > 0.00005;
  const priceChanged = price.trim() !== '' && Number.isFinite(p) && Math.abs(p - Number(r.store_price)) >= 0.005;
  // live preview of the other field
  const previewPrice = markupChanged ? r2(acq * (1 + m / 100)) : null;
  const previewMarkup = priceChanged && acq > 0 ? (p / acq - 1) * 100 : null;
  const save = (by: 'markup' | 'price') => start(async () => {
    try {
      const res = await setItemPriceAction(r.item_id, by === 'markup' ? { markup: m } : { store_price: p });
      onMessage(`${r.item_name}: store price ${peso(res.old_store_price)} → ${peso(res.store_price)} (markup ${pct(res.markup_percent)}).`, true);
      setMarkup(String(Number(Number(res.markup_percent).toFixed(4)))); setPrice(String(Number(res.store_price).toFixed(2)));
    } catch (e) { onMessage(errorText(e), false); }
  });
  return (
    <>
    <tr className="border-b align-top">
      <td className="p-2"><div className="font-medium">{r.item_name}</div><div className="text-xs text-slate-500">{r.item_code} · {[r.category, r.brand].filter(Boolean).join(' · ')}</div>
        {r.last_changed_at && <div className="text-xs text-slate-400">changed {new Date(r.last_changed_at).toLocaleDateString()} by {r.last_changed_by ?? '—'}</div>}
        <button type="button" className="text-xs text-blue-700 underline" onClick={toggleBuys}>{showBuys ? 'Hide purchase prices' : 'Purchase prices'}</button></td>
      <td className="p-2 text-xs">{r.supplier ?? '—'}</td>
      <td className="p-2 text-right">{peso(r.supplier_cost)}{r.cost_age_days != null && <div className="text-xs text-slate-500">{r.cost_age_days} d old</div>}
        {Math.abs(Number(r.cost_basis) - Number(r.supplier_cost)) >= 0.005 && <div className="text-xs font-medium text-sky-800">priced from oldest lot {peso(r.cost_basis)}</div>}</td>
      <td className="p-2 text-right">{pct(r.addon_percent)}</td>
      <td className="p-2 text-right">{peso(acq)}</td>
      <td className="p-2"><div className="flex w-32 items-center gap-1"><input className={`input text-right ${markupChanged ? 'border-blue-500' : ''}`} type="number" step="0.01" min="0" value={markup} onChange={(e) => setMarkup(e.target.value)} disabled={priceChanged} /><span>%</span></div>
        {previewPrice != null && <div className="text-xs text-slate-600">→ {peso(previewPrice)}</div>}
        {markupChanged && <button type="button" className="button mt-1" disabled={pending} onClick={() => save('markup')}>{pending ? '…' : 'Save'}</button>}
        {!markupChanged && r.below_7 && <div className="text-xs text-amber-700">under 7%</div>}</td>
      <td className="p-2"><div className="w-32"><input className={`input text-right ${priceChanged ? 'border-blue-500' : ''}`} type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} disabled={markupChanged || acq <= 0}
          title={acq <= 0 ? 'No supplier cost: set the cost first' : undefined} />
        {previewMarkup != null && <div className={`text-xs ${previewMarkup < 0 ? 'text-red-700' : 'text-slate-600'}`}>markup {pct(previewMarkup)}{previewMarkup < 0 ? ' — below cost' : ''}</div>}
        {priceChanged && <button type="button" className="button mt-1" disabled={pending || (previewMarkup ?? 0) < 0} onClick={() => save('price')}>{pending ? '…' : 'Save'}</button>}</div></td>
    </tr>
    {showBuys && <tr className="border-b bg-slate-50"><td colSpan={7} className="p-2">
      {!buys ? <span className="text-xs text-slate-500">Loading…</span> : buys.length === 0 ? <span className="text-xs text-slate-500">No purchases recorded for this item in this store yet.</span> :
        <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="p-1">Supplier</th><th className="p-1">Date</th><th className="p-1 text-right">Price paid</th><th className="p-1 text-right">Qty</th><th className="p-1">From</th><th className="p-1 text-right">Left</th><th className="p-1 text-right">Sells at (this markup)</th></tr></thead>
          <tbody>{buys.map((b, k) => <tr key={k} className="border-t"><td className="p-1">{b.supplier ?? '—'}</td><td className="p-1">{b.purchase_date}</td><td className="p-1 text-right font-medium">{peso(b.unit_cost)}</td>
            <td className="p-1 text-right">{Number(b.quantity).toLocaleString()}</td><td className="p-1">{b.source}{b.reference ? ` ${b.reference}` : ''}{b.lot_code ? ` · ${b.lot_code}` : ''}</td>
            <td className="p-1 text-right">{b.on_hand == null ? '—' : Number(b.on_hand).toLocaleString()}</td>
            <td className="p-1 text-right">{peso(r2(Number(b.unit_cost) * (1 + Number(r.addon_percent) / 100) * (1 + Number(r.markup_percent) / 100)))}</td></tr>)}</tbody></table>}
    </td></tr>}
    </>
  );
}

function CategoryRow({ c, onMessage }: { c: Category; onMessage: (m: string, ok: boolean) => void }) {
  const [v, setV] = useState(String(Number(Number(c.addon_percent).toFixed(4))));
  const [pending, start] = useTransition();
  const n = Number(v);
  const changed = v.trim() !== '' && Number.isFinite(n) && Math.abs(n - Number(c.addon_percent)) > 0.00005;
  return (
    <tr className="border-b">
      <td className="p-2 font-medium">{c.name}</td>
      <td className="p-2 text-right">{Number(c.items).toLocaleString()}</td>
      <td className="p-2"><div className="flex items-center gap-1"><div className="w-28"><input className={`input text-right ${changed ? 'border-blue-500' : ''}`} type="number" step="0.01" min="0" value={v} onChange={(e) => setV(e.target.value)} /></div><span>%</span>
        {changed && <button type="button" className="button ml-2" disabled={pending} onClick={() => start(async () => {
          try { const r = await setCategoryAddonAction(c.category_id, n); onMessage(`${r.category}: add-on ${pct(r.old_addon_percent)} → ${pct(r.addon_percent)}; the acquisition cost and store price of ${r.items_affected} item(s) follow.`, true); }
          catch (e) { onMessage(errorText(e), false); }
        })}>{pending ? '…' : 'Save'}</button>}</div></td>
    </tr>
  );
}

export function PriceReview({ rows, categories, suppliers, brands, changes, filters, page, pageSize, tab }: { rows: Row[]; categories: Category[]; suppliers: { supplier_id: string; name: string }[];
  brands: string[]; changes: Change[]; filters: Filters; page: number; pageSize: number; tab: string }) {
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const onMessage = (t: string, ok: boolean) => setMsg({ t, ok });
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (patch: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const all = { ...filters, tab, page, ...patch } as Record<string, string | number | undefined>;
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== '' && !(k === 'page' && Number(v) === 1) && !(k === 'tab' && v === 'items')) u.set(k, String(v));
    const s = u.toString(); return s ? `?${s}` : '?';
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Price Review</h2>
        <p className="mt-1 text-sm text-slate-500">This store&apos;s prices: supplier cost × (1 + category add-on) = acquisition cost; × (1 + markup) = store price. The store price shown is worked out from the oldest lot with stock (or the current Supplier Cost when no lot has stock); at the Storefront each lot sells at its own price. Change a markup or type the store price you want; changes apply at once and are logged.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {[['items', 'Items'], ['categories', 'Category add-ons'], ['log', `Change log (${changes.length})`]].map(([k, l]) => <Link key={k} href={link({ tab: k, page: 1 })} className={tab === k ? 'button' : 'button-secondary'}>{l}</Link>)}
      </div>
      {msg && <div className={`rounded border p-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.t}</div>}

      {tab === 'items' && <>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div><label className="label">Search</label><input className="input w-56" name="q" defaultValue={filters.q} placeholder="Item name or code" /></div>
          <div><label className="label">Category</label><select className="input" name="category" defaultValue={filters.category}><option value="">All</option>{categories.map((c) => <option key={c.category_id} value={c.name}>{c.name}</option>)}</select></div>
          <div><label className="label">Brand</label><select className="input" name="brand" defaultValue={filters.brand}><option value="">All</option>{brands.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          <div><label className="label">Supplier</label><select className="input" name="supplier" defaultValue={filters.supplier}><option value="">All</option>{suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>)}</select></div>
          <button className="button-secondary">Filter</button>
          {(filters.q || filters.category || filters.brand || filters.supplier) && <Link className="button-secondary" href="?">Clear</Link>}
        </form>
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50"><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2">Supplier</th><th className="p-2 text-right">Supplier cost</th><th className="p-2 text-right">Add-on</th><th className="p-2 text-right">Acquisition</th><th className="p-2">Markup</th><th className="p-2">Store price</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No item matches.</td></tr>}
              {rows.map((r) => <ItemRow key={`${r.item_id}-${r.markup_percent}-${r.store_price}`} r={r} onMessage={onMessage} />)}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 text-sm">{page > 1 && <Link className="button-secondary" href={link({ page: page - 1 })}>Previous</Link>}<span>Page {page} of {pages} · {total.toLocaleString()} items</span>{page < pages && <Link className="button-secondary" href={link({ page: page + 1 })}>Next</Link>}</div>
      </>}

      {tab === 'categories' && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <p className="p-3 text-sm text-slate-600">The add-on recovers operating costs; it is part of every item&apos;s acquisition cost in the category, so its store prices move with it (markups stay).</p>
          <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Category</th><th className="p-2 text-right">Items</th><th className="p-2">Add-on</th></tr></thead>
            <tbody>{categories.map((c) => <CategoryRow key={`${c.category_id}-${c.addon_percent}`} c={c} onMessage={onMessage} />)}</tbody></table>
        </div>
      )}

      {tab === 'log' && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">When</th><th className="p-2">Who</th><th className="p-2">What</th><th className="p-2">Item / category</th><th className="p-2 text-right">From</th><th className="p-2 text-right">To</th></tr></thead>
            <tbody>
              {changes.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No price changes recorded yet.</td></tr>}
              {changes.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="p-2 whitespace-nowrap">{new Date(c.changed_at).toLocaleString()}</td>
                  <td className="p-2">{c.changed_by ?? '—'}</td>
                  <td className="p-2">{KIND[c.kind] ?? c.kind}</td>
                  <td className="p-2">{c.kind === 'category_addon' ? `${c.category} (${c.items_affected ?? 0} items)` : `${c.item_code} — ${c.item_name}`}</td>
                  <td className="p-2 text-right">{c.kind === 'category_addon' ? pct(c.old_percent) : <>{peso(c.old_store_price)}<div className="text-xs text-slate-500">{pct(c.old_percent)}</div></>}</td>
                  <td className="p-2 text-right font-medium">{c.kind === 'category_addon' ? pct(c.new_percent) : <>{peso(c.new_store_price)}<div className="text-xs font-normal text-slate-500">{pct(c.new_percent)}</div></>}</td>
                </tr>
              ))}
            </tbody></table>
        </div>
      )}
    </div>
  );
}
