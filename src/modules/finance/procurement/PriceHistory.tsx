'use client';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';

// Build 55 — item ↔ supplier purchase price history (UI).
//   <ItemPriceHistory itemId>  — the catalog item detail section: grouped by
//     supplier (with that supplier's item code), one row per purchase with
//     date, PO, quantity, PO price, invoice price and the effective price.
//     PO price by default; invoice price when AP recorded it; a Finance user
//     can correct it (with a reason) when the supplier billed differently.
//   <LastPriceHint itemId supplierId onUse> — under a PR/PO line: the last
//     price paid to the chosen supplier and the lowest recent price from any
//     supplier, with a one-click "Use".

import { useEffect, useState, useTransition } from 'react';
import { getItemPriceHistoryAction, getLastPurchasePricesAction, adjustPurchasePriceAction, revertPurchasePriceAction } from './actions';

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SOURCE_LABEL: Record<string, string> = { po: 'PO price', invoice: 'Invoice price', manual: 'Corrected' };
const SOURCE_CLASS: Record<string, string> = { po: 'bg-slate-100 text-slate-700', invoice: 'bg-blue-50 text-blue-700', manual: 'bg-amber-50 text-amber-800' };

type HistoryRow = {
  id: string; supplier_id: string; supplier_item_code: string | null; purchase_order_id: string; purchase_date: string;
  quantity: number | null; unit: string | null; po_unit_price: number; invoice_unit_price: number | null; effective_unit_price: number;
  price_source: 'po' | 'invoice' | 'manual'; invoice_reference: string | null; adjustment_note: string | null; adjusted_at: string | null;
  supplier?: { supplier_code: string; legal_name: string } | null; po?: { po_number: string } | null;
};

export function ItemPriceHistory({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [data, setData] = useState<{ rows: HistoryRow[]; links: any[] } | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [pending, start] = useTransition();
  const load = () => getItemPriceHistoryAction(itemId).then((d) => { setData(d as any); setError(''); }).catch((e) => setError(errorText(e) || 'Unable to load price history.'));
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [itemId]);

  if (error) return <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>;
  if (!data) return <div className="text-slate-400">Loading purchase price history…</div>;

  // Group by supplier: every supplier this business bought from, plus linked
  // suppliers not yet bought from (so the supplier's code still shows).
  const groups = new Map<string, { name: string; code: string | null; rows: HistoryRow[] }>();
  for (const l of data.links) groups.set(l.supplier_id, { name: `${l.supplier?.supplier_code ?? ''} — ${l.supplier?.legal_name ?? ''}`, code: l.supplier_item_code, rows: [] });
  for (const r of data.rows) {
    const g = groups.get(r.supplier_id) ?? { name: `${r.supplier?.supplier_code ?? ''} — ${r.supplier?.legal_name ?? ''}`, code: r.supplier_item_code, rows: [] };
    g.rows.push(r);
    groups.set(r.supplier_id, g);
  }
  const ordered = [...groups.entries()].sort((a, b) => (b[1].rows[0]?.purchase_date ?? '').localeCompare(a[1].rows[0]?.purchase_date ?? ''));

  const act = (fn: () => Promise<any>) => start(async () => { try { await fn(); setEditing(null); await load(); } catch (e: any) { setError(errorText(e) || 'Action failed.'); } });

  return (
    <div className="space-y-4">
      {ordered.length === 0 && <p className="text-slate-500">No suppliers or purchases recorded for this item yet.</p>}
      {ordered.map(([supplierId, g]) => (
        <div key={supplierId} className="rounded-lg border">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-slate-50 px-3 py-2">
            <div><span className="font-medium">{g.name}</span><span className="ml-2 text-xs text-slate-500">Supplier item code: <b>{g.code || '—'}</b></span></div>
            {g.rows[0] ? <div className="text-xs text-slate-600">Last: <b>{peso(g.rows[0].effective_unit_price)}</b> on {g.rows[0].purchase_date}</div> : <div className="text-xs text-slate-400">No purchases yet</div>}
          </div>
          {g.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Date</th><th className="p-2">PO</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">PO price</th><th className="p-2 text-right">Invoice price</th><th className="p-2 text-right">Price</th><th className="p-2">Source</th>{canEdit && <th className="p-2" />}</tr></thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="p-2 whitespace-nowrap">{r.purchase_date}</td>
                      <td className="p-2">{r.po?.po_number ?? '—'}{r.supplier_item_code && r.supplier_item_code !== g.code && <div className="text-xs text-slate-400">code then: {r.supplier_item_code}</div>}</td>
                      <td className="p-2 text-right">{r.quantity ?? '—'} {r.unit ?? ''}</td>
                      <td className="p-2 text-right">{peso(r.po_unit_price)}</td>
                      <td className="p-2 text-right">{r.invoice_unit_price == null ? '—' : peso(r.invoice_unit_price)}{r.invoice_reference && <div className="text-xs text-slate-400">{r.invoice_reference}</div>}</td>
                      <td className="p-2 text-right font-semibold">{peso(r.effective_unit_price)}</td>
                      <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${SOURCE_CLASS[r.price_source]}`}>{SOURCE_LABEL[r.price_source]}</span>{r.price_source === 'manual' && r.adjustment_note && <div className="mt-1 max-w-[14rem] text-xs text-slate-500">{r.adjustment_note}</div>}</td>
                      {canEdit && <td className="p-2 whitespace-nowrap"><button type="button" className="button-secondary" disabled={pending} onClick={() => setEditing(r)}>Edit price</button>{r.price_source === 'manual' && <button type="button" className="ml-1 text-xs text-slate-500 underline" disabled={pending} onClick={() => act(() => revertPurchasePriceAction(r.id))}>Undo correction</button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-slate-500">Recorded automatically when a PO is approved (PO price). It switches to the supplier invoice price when AP records the invoice against the PO line, or you can correct it here with a reason. A correction is kept even if an invoice is recorded later.</p>

      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b p-4"><div><h3 className="font-semibold">Correct purchase price</h3><p className="text-xs text-slate-500">{editing.po?.po_number} · {editing.purchase_date} · PO price {peso(editing.po_unit_price)}</p></div><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Close</button></div>
            <Form action={(fd) => act(() => adjustPurchasePriceAction(fd))} className="grid gap-3 p-4">
              <input type="hidden" name="history_id" value={editing.id} />
              <label className="text-sm">Invoice price (per unit)<input className="input mt-1 w-full" name="invoice_unit_price" type="number" min="0" step="0.01" defaultValue={editing.invoice_unit_price ?? editing.po_unit_price} required /></label>
              <label className="text-sm">Supplier invoice / reference<input className="input mt-1 w-full" name="invoice_reference" defaultValue={editing.invoice_reference ?? ''} placeholder="e.g. SI-12345" /></label>
              <label className="text-sm">Reason (required)<textarea className="input mt-1 w-full" name="adjustment_note" required defaultValue={editing.adjustment_note ?? ''} placeholder="Why the billed price differs from the PO" /></label>
              <button className="button" disabled={pending}>Save price</button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

const hintCache = new Map<string, Promise<any[]>>();

export function LastPriceHint({ itemId, supplierId, onUse }: { itemId: string; supplierId?: string; onUse?: (price: number) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!hintCache.has(itemId)) hintCache.set(itemId, getLastPurchasePricesAction([itemId]).catch(() => []));
    hintCache.get(itemId)!.then((r) => { if (alive) setRows(r as any[]); });
    return () => { alive = false; };
  }, [itemId]);
  if (!rows || rows.length === 0) return rows ? <div className="text-xs text-slate-400">No purchase history for this item yet.</div> : null;
  const fromSupplier = supplierId ? rows.find((r) => r.supplier_id === supplierId) : null;
  const lowest = [...rows].sort((a, b) => Number(a.last_unit_price) - Number(b.last_unit_price))[0];
  const use = (p: number) => onUse && <button type="button" className="ml-1 text-blue-700 underline" onClick={() => onUse(Number(p))}>Use</button>;
  return (
    <div className="text-xs text-slate-600">
      {fromSupplier ? <span>Last from this supplier: <b>{peso(fromSupplier.last_unit_price)}</b> ({fromSupplier.last_purchase_date}{fromSupplier.supplier_item_code ? `, code ${fromSupplier.supplier_item_code}` : ''}){use(fromSupplier.last_unit_price)}</span>
        : supplierId ? <span className="text-slate-400">Never bought from this supplier.</span> : null}
      {lowest && (!fromSupplier || lowest.supplier_id !== fromSupplier.supplier_id) && <span className={fromSupplier || supplierId ? 'ml-3' : ''}>Lowest last price: <b>{peso(lowest.last_unit_price)}</b> from {lowest.supplier?.legal_name} ({lowest.last_purchase_date}){use(lowest.last_unit_price)}</span>}
    </div>
  );
}
