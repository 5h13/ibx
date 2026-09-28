'use client';
import { errorText } from '@/core/errors/appError';

// Build 56 — an item's current cost (shared by all businesses), how long ago
// it was last updated, and every change (from a supplier quote or a manual
// catalog edit). Shown in the catalog item detail.

import { useEffect, useState } from 'react';
import { getItemCostHistoryAction } from './supplierQuoteActions';
import { costAgeLabel } from './supplierQuoteAccess';

const peso = (v: unknown) => (v == null ? '—' : `₱${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function ItemCostHistory({ itemId }: { itemId: string }) {
  const [data, setData] = useState<{ item: any; rows: any[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setData(null);
    getItemCostHistoryAction(itemId).then((d) => { if (alive) setData(d as any); }).catch((e) => { if (alive) setError(errorText(e) || 'Unable to load cost history.'); });
    return () => { alive = false; };
  }, [itemId]);
  if (error) return <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>;
  if (!data) return <div className="text-slate-400">Loading cost…</div>;
  const current = data.item?.item_type === 'service' ? data.item?.service_cost_basis : data.item?.standard_cost;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-lg font-semibold">{peso(current)}</span>
        <span className="text-xs text-slate-500">{costAgeLabel(data.item?.cost_updated_at)} · shared by all businesses · set from <a className="text-blue-700 underline" href="/finance/procurement/supplier-quotes">Supplier Quotes</a></span>
      </div>
      {data.rows.length > 0 ? (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">When</th><th className="p-2 text-right">From</th><th className="p-2 text-right">To</th><th className="p-2">Source</th><th className="p-2">Supplier</th><th className="p-2">Set for</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{new Date(r.set_at).toLocaleDateString()}</td>
                  <td className="p-2 text-right">{peso(r.previous_cost)}</td>
                  <td className="p-2 text-right font-medium">{peso(r.new_cost)}</td>
                  <td className="p-2">{r.source === 'supplier_quote' ? 'Supplier quote' : 'Manual edit'}</td>
                  <td className="p-2">{r.supplier?.legal_name ?? '—'}</td>
                  <td className="p-2">{r.business?.code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-slate-500">No cost changes recorded yet.</p>}
    </div>
  );
}
