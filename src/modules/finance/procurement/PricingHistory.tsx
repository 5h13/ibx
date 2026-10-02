'use client';
// CAT-11 (Build 77) — an item's price-rule history for the current store:
// its markup, its category's add-on and its customer discounts, each change
// with the value before it, when it took effect and who made it. Read from
// finance_catalog_pricing_history through catalog_item_pricing_history()
// (store-scoped; the Super Admin sees the "Acting as" store, or all stores).

import { useEffect, useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { getItemLotsAction, getItemPricingHistoryAction } from './actions';

type Row = Awaited<ReturnType<typeof getItemPricingHistoryAction>>[number];
const pct = (v: unknown) => (v == null ? '—' : `${Number(Number(v).toFixed(2))}%`);

export function ItemPricingHistory({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setRows(null); setError('');
    getItemPricingHistoryAction(itemId).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) setError(errorText(e) || 'Unable to load pricing history.'); });
    return () => { alive = false; };
  }, [itemId]);
  if (error) return <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>;
  if (!rows) return <div className="text-slate-400">Loading pricing history…</div>;
  if (!rows.length) return <p className="text-slate-500">No markup, add-on or discount changes recorded for this store yet.</p>;
  const multi = new Set(rows.map((r) => r.business_code)).size > 1;
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">When</th>{multi && <th className="p-2">Store</th>}<th className="p-2">Rule</th><th className="p-2 text-right">From</th><th className="p-2 text-right">To</th><th className="p-2">Effective</th><th className="p-2">By</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="p-2 whitespace-nowrap">{new Date(r.captured_at).toLocaleString()}</td>
              {multi && <td className="p-2">{r.business_code ?? '—'}</td>}
              <td className="p-2">{r.subject}</td>
              <td className="p-2 text-right">{pct(r.previous_percent)}</td>
              <td className="p-2 text-right font-medium">{pct(r.value_percent)}</td>
              <td className="p-2 whitespace-nowrap">{r.effective_from ?? '—'}</td>
              <td className="p-2">{r.captured_by_name ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-2 text-xs text-slate-500">Markups and add-ons are set per store; this list shows {multi ? 'the stores you can see' : 'this store only'}. Supplier Cost changes are in “Current cost” above.</p>
    </div>
  );
}

// Build 78 — purchases received for this item in this store, one lot each
// (supplier, date, price paid, what is left). Cost of sales stays at the
// weighted average; this list is for tracing and comparing purchase prices.
type LotRow = Awaited<ReturnType<typeof getItemLotsAction>>[number];
const LOT_SOURCE: Record<string, string> = { receipt: 'Receipt', opening: 'Opening stock', count: 'Stock count', legacy: 'Earlier stock' };
export function ItemLots({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<LotRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setRows(null); setError('');
    getItemLotsAction(itemId).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) setError(errorText(e) || 'Unable to load the lots.'); });
    return () => { alive = false; };
  }, [itemId]);
  if (error) return <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>;
  if (!rows) return <div className="text-slate-400">Loading lots…</div>;
  if (!rows.length) return <p className="text-slate-500">Nothing received for this item in this store yet.</p>;
  const q = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const peso = (n: unknown) => `₱${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Received</th><th className="p-2">Lot</th><th className="p-2">Supplier</th><th className="p-2">From</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">Left</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lot_id} className="border-b last:border-0">
              <td className="p-2 whitespace-nowrap">{r.received_date}</td>
              <td className="p-2">{r.lot_code}{r.supplier_lot_no ? <div className="text-xs text-slate-500">batch {r.supplier_lot_no}</div> : null}</td>
              <td className="p-2">{r.supplier ?? '—'}</td>
              <td className="p-2">{LOT_SOURCE[r.source] ?? r.source}{r.receipt_number ? ` ${r.receipt_number}` : ''}{r.po_number ? <div className="text-xs text-slate-500">PO {r.po_number}</div> : null}</td>
              <td className="p-2 text-right">{q(r.received_qty)}</td>
              <td className="p-2 text-right font-medium">{peso(r.unit_cost)}</td>
              <td className="p-2 text-right">{q(r.on_hand)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
