'use client';
// CAT-11 (Build 77) — an item's price-rule history for the current store:
// its markup, its category's add-on and its customer discounts, each change
// with the value before it, when it took effect and who made it. Read from
// finance_catalog_pricing_history through catalog_item_pricing_history()
// (store-scoped; the Super Admin sees the "Acting as" store, or all stores).

import { useEffect, useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { getItemPricingHistoryAction } from './actions';

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
