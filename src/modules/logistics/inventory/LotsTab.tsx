'use client';

import { Form } from '@/core/ui/Form';
// Build 78 — lots on every item (U062 / LOG-23).
//   • TransferForm: each transfer line can name the lot to move; left on
//     "Oldest first", the posting takes the oldest lots with stock.
//   • LotsTab: lot register with balances per location, aging buckets and a
//     trace of where each lot came from and went (customers included).
// Logistics never sees a lot's purchase price; Finance / admins do.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { PopupAction } from '@/core/ui/PopupAction';
import * as A from '../inventoryActions';

const qty = (n: unknown) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const peso = (n: unknown) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SOURCE: Record<string, string> = { receipt: 'Receipt', opening: 'Opening stock', count: 'Stock count', legacy: 'Earlier stock' };
const TYPE: Record<string, string> = { receipt: 'Received', issue: 'Out', transfer_in: 'Transfer in', transfer_out: 'Transfer out', adjustment: 'In (adjustment / return)' };

type TLine = { inventory_item_id: string; quantity: number; lot_id: string; lots: A.LotRow[] };
const blank = (): TLine => ({ inventory_item_id: '', quantity: 1, lot_id: '', lots: [] });

export function TransferForm({ locations, items, pending, run, onSaved }: { locations: any[]; items: any[]; pending: boolean; run: (f: () => Promise<void>) => void; onSaved: () => void }) {
  const [from, setFrom] = useState('');
  const [lines, setLines] = useState<TLine[]>([blank()]);
  const [err, setErr] = useState('');
  const active = locations.filter((l) => l.active);
  async function loadLots(i: number, itemId: string, loc: string, current: TLine[]) {
    let lots: A.LotRow[] = [];
    if (itemId && loc) { try { lots = (await A.lotsForInventoryItemAction(itemId, loc)).filter((x) => Number(x.on_hand_here) > 0); } catch (e) { setErr(errorText(e)); } }
    setLines(current.map((x, j) => (j === i ? { ...x, inventory_item_id: itemId, lots, lot_id: lots.some((o) => o.lot_id === x.lot_id) ? x.lot_id : '' } : x)));
  }
  async function changeFrom(loc: string) {
    setFrom(loc);
    const next = [...lines];
    for (let i = 0; i < next.length; i++) {
      const l = next[i];
      let lots: A.LotRow[] = [];
      if (l.inventory_item_id && loc) { try { lots = (await A.lotsForInventoryItemAction(l.inventory_item_id, loc)).filter((x) => Number(x.on_hand_here) > 0); } catch { lots = []; } }
      next[i] = { ...l, lots, lot_id: '' };
    }
    setLines(next);
  }
  return (
    <Form action={(fd) => run(async () => {
      fd.set('lines', JSON.stringify(lines.map(({ inventory_item_id, quantity, lot_id }) => ({ inventory_item_id, quantity, lot_id: lot_id || null }))));
      await A.createTransferAction(fd); setLines([blank()]); setFrom(''); onSaved();
    })} className="grid gap-3 md:grid-cols-4">
      <div><label className="label">From</label><select className="input" name="from_location_id" required value={from} onChange={(e) => changeFrom(e.target.value)}>
        <option value="">Source</option>{active.map((l) => <option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}</select></div>
      <div><label className="label">To</label><select className="input" name="to_location_id" required>
        <option value="">Destination</option>{active.map((l) => <option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}</select></div>
      <div><label className="label">Date</label><input className="input" name="transfer_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
      <div className="space-y-2 rounded-lg border p-3 md:col-span-4">
        <div className="flex justify-between"><b>Transfer lines</b><button type="button" className="button-secondary" onClick={() => setLines([...lines, blank()])}>Add line</button></div>
        <p className="text-xs text-slate-500">Choose the lot to move, or leave "Oldest first": the oldest lots with stock at the source are moved first.</p>
        {lines.map((l, i) => {
          const lot = l.lots.find((o) => o.lot_id === l.lot_id);
          return (
            <div key={i} className="grid gap-2 md:grid-cols-12">
              <select className="input md:col-span-5" value={l.inventory_item_id} required onChange={(e) => loadLots(i, e.target.value, from, lines)}>
                <option value="">Item</option>{items.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.item_code} — {x.item_name}</option>)}
              </select>
              <select className="input md:col-span-5" value={l.lot_id} disabled={!from || !l.inventory_item_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, lot_id: e.target.value } : x)))}>
                <option value="">{!from ? 'Choose the source first' : l.lots.length ? 'Oldest first (automatic)' : 'No lot with stock at the source'}</option>
                {l.lots.map((o) => <option key={o.lot_id} value={o.lot_id}>{o.lot_code} · received {o.received_date} · {qty(o.on_hand_here)} here{o.supplier_lot_no ? ` · batch ${o.supplier_lot_no}` : ''}</option>)}
              </select>
              <input className="input md:col-span-2" type="number" min=".001" step=".001" value={l.quantity} required onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
              {lot && l.quantity > Number(lot.on_hand_here) && <p className="text-xs text-red-700 md:col-span-12">Lot {lot.lot_code} holds {qty(lot.on_hand_here)} at the source; posting will refuse more.</p>}
            </div>
          );
        })}
      </div>
      {err && <p className="text-sm text-red-700 md:col-span-4">{err}</p>}
      <div className="md:col-span-4"><button disabled={pending} className="button">Save draft transfer</button></div>
    </Form>
  );
}

export type LotRegisterRow = { lot_id: string; lot_code: string; inventory_item_id: string; item_code: string; item_name: string; unit: string; source: string; received_date: string; age_days: number;
  age_bucket: string; supplier: string | null; supplier_lot_no: string | null; expiry_date: string | null; receipt_number: string | null; received_qty: number; on_hand: number;
  by_location: { location: string; on_hand: number }[]; unit_cost: number | null; total_count: number };
export type AgingRow = { age_bucket: string; bucket_order: number; lots: number; on_hand: number; value: number | null };

function LotTrace({ lotId, showCost }: { lotId: string; showCost: boolean }) {
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { A.lotTraceAction(lotId).then(setT).catch((e) => setErr(errorText(e))); }, [lotId]);
  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!t) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <div><span className="text-slate-500">Item</span><div className="font-medium">{t.item_code} — {t.item_name}</div></div>
        <div><span className="text-slate-500">Came from</span><div className="font-medium">{SOURCE[t.source] ?? t.source}{t.receipt_number ? ` ${t.receipt_number}` : ''}{t.po_number ? ` (PO ${t.po_number})` : ''}{t.count_number ? ` ${t.count_number}` : ''}</div></div>
        <div><span className="text-slate-500">Supplier</span><div className="font-medium">{t.supplier ?? '—'}{t.supplier_lot_no ? ` · batch ${t.supplier_lot_no}` : ''}</div></div>
        <div><span className="text-slate-500">Received</span><div className="font-medium">{t.received_date} · {qty(t.received_qty)} {t.unit}</div></div>
        <div><span className="text-slate-500">On hand now</span><div className="font-medium">{qty(t.on_hand)} {t.unit}</div></div>
        {showCost && t.unit_cost != null && <div><span className="text-slate-500">Purchase price</span><div className="font-medium">{peso(t.unit_cost)}</div></div>}
      </div>
      <div>
        <div className="mb-1 font-medium">Customers</div>
        {(t.customers ?? []).length === 0 ? <p className="text-slate-500">Not sold to anyone yet.</p>
          : <table className="w-full"><tbody>{t.customers.map((c: any) => <tr key={c.customer} className="border-b"><td className="p-1">{c.customer}</td><td className="p-1 text-right">{qty(c.quantity)} {t.unit}</td><td className="p-1 text-xs text-slate-500">{(c.sales ?? []).join(', ')}</td></tr>)}</tbody></table>}
      </div>
      <div>
        <div className="mb-1 font-medium">Every movement</div>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="border-b text-left uppercase text-slate-500"><th className="p-1">Date</th><th className="p-1">Movement</th><th className="p-1">Location</th><th className="p-1 text-right">Qty</th><th className="p-1">Document</th><th className="p-1">Customer</th></tr></thead>
          <tbody>{(t.movements ?? []).map((m: any, i: number) => (
            <tr key={i} className="border-b"><td className="p-1">{m.date}</td><td className="p-1">{TYPE[m.type] ?? m.type}</td><td className="p-1">{m.location}</td>
              <td className={`p-1 text-right ${Number(m.signed) < 0 ? 'text-red-700' : ''}`}>{Number(m.signed) > 0 ? '+' : ''}{qty(m.signed)}</td>
              <td className="p-1">{m.dr_number ?? m.reference ?? '—'}{m.hardcopy_dr_no ? ` · hardcopy ${m.hardcopy_dr_no}` : ''}</td><td className="p-1">{m.customer ?? ''}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}

export function LotsTab({ rows, aging, filters, locations, showCost, base }: { rows: LotRegisterRow[]; aging: AgingRow[]; filters: { q?: string; loc?: string; all?: boolean; page: number };
  locations: any[]; showCost: boolean; base: string }) {
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / 100));
  const link = (page: number) => {
    const p = new URLSearchParams({ tab: 'lots' });
    if (filters.q) p.set('lot_q', filters.q); if (filters.loc) p.set('lot_loc', filters.loc); if (filters.all) p.set('lot_all', '1'); if (page > 1) p.set('lot_page', String(page));
    return `${base}?${p.toString()}`;
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">Each received line is a lot with its supplier and date; the opening count is the first lot of an item. Balances come from the stock movements. Stock that left before lots existed, or while no lot had stock, shows as "No lot" in the ledger until the next stock count.</p>
      <div className="grid gap-3 md:grid-cols-5">{['0-30 days', '31-90 days', '91-180 days', '181-365 days', 'Over 1 year'].map((b) => {
        const a = aging.find((x) => x.age_bucket === b);
        return <div key={b} className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500">{b}</div><div className="mt-1 text-xl font-semibold">{qty(a?.on_hand ?? 0)}</div>
          <div className="text-xs text-slate-500">{Number(a?.lots ?? 0)} lot(s){showCost && a?.value != null ? ` · ${peso(a.value)}` : ''}</div></div>;
      })}</div>
      <Form method="get" action={base} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="lots" />
        <div><label className="label">Search</label><input className="input w-64" name="lot_q" defaultValue={filters.q ?? ''} placeholder="Lot, item, supplier, batch or receipt" /></div>
        <div><label className="label">Location</label><select className="input" name="lot_loc" defaultValue={filters.loc ?? ''}><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lot_all" value="1" defaultChecked={!!filters.all} /> Include lots with no stock left</label>
        <button className="button-secondary">Filter</button>
      </Form>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Lot</th><th className="p-3">Item</th><th className="p-3">Received</th><th className="p-3">Age</th><th className="p-3">Supplier</th><th className="p-3">From</th><th className="p-3 text-right">Received qty</th><th className="p-3 text-right">On hand</th>{showCost && <th className="p-3 text-right">Price</th>}<th className="p-3" /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={showCost ? 10 : 9} className="p-4 text-center text-slate-500">No lots match.</td></tr>}
            {rows.map((r) => (
              <tr key={r.lot_id} className="border-b align-top">
                <td className="p-3 font-medium"><span className="whitespace-nowrap">{r.lot_code}</span>{r.supplier_lot_no && <div className="text-xs font-normal text-slate-500">batch {r.supplier_lot_no}</div>}{r.expiry_date && <div className="text-xs font-normal text-slate-500">expires {r.expiry_date}</div>}</td>
                <td className="p-3">{r.item_code} — {r.item_name}</td>
                <td className="p-3 whitespace-nowrap">{r.received_date}</td>
                <td className="p-3">{r.age_days} d<div className="text-xs text-slate-500">{r.age_bucket}</div></td>
                <td className="p-3">{r.supplier ?? '—'}</td>
                <td className="p-3">{SOURCE[r.source] ?? r.source}{r.receipt_number ? <div className="text-xs text-slate-500">{r.receipt_number}</div> : null}</td>
                <td className="p-3 text-right">{qty(r.received_qty)}</td>
                <td className="p-3 text-right font-medium">{qty(r.on_hand)} {r.unit}{(r.by_location ?? []).length > 0 && <div className="text-xs font-normal text-slate-500">{r.by_location.map((b) => `${b.location} ${qty(b.on_hand)}`).join(' · ')}</div>}</td>
                {showCost && <td className="p-3 text-right">{r.unit_cost != null ? peso(r.unit_cost) : '—'}</td>}
                <td className="p-3"><PopupAction label="Trace" title={`Lot ${r.lot_code}`} variant="secondary" wide><LotTrace lotId={r.lot_id} showCost={showCost} /></PopupAction></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && <div className="flex items-center gap-2 text-sm">{filters.page > 1 && <Link className="button-secondary" href={link(filters.page - 1)}>Previous</Link>}<span>Page {filters.page} of {pages} · {total} lots</span>{filters.page < pages && <Link className="button-secondary" href={link(filters.page + 1)}>Next</Link>}</div>}
    </section>
  );
}
