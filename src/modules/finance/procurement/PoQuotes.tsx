'use client';
// Build 103 — purchase price control on the Purchase Orders tab:
//   <OpenQuotes>  every "To be quoted" PO line still without a confirmed price: Enter quote (Finance preparer /
//                 reviewer / approver) → Approve or Reject (Finance approver or Business Admin, not the person who
//                 entered it). Goods may already be received; confirming costs what was received.
//   <PriceControlSettings>  the store's flag level (PO price above the last purchase price) and bill tolerance.
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { poOpenQuotesAction, poQuoteEnterAction, poQuoteDecideAction, priceControlSettingsAction, savePriceControlSettingsAction } from './actions';

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Quote = { id: string; po_id: string; po_number: string; supplier: string | null; description: string; quantity: number; unit: string; received: number;
  quote_price: number | null; quote_reference: string | null; entered_by: string | null; entered_by_id: string | null; entered_at: string | null; note: string | null;
  days_open: number; state: 'waiting' | 'to_approve' };

export function OpenQuotes({ userId, canEnter, canApprove }: { userId: string; canEnter: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [open, setOpen] = useState<{ row: Quote; mode: 'enter' | 'decide' } | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { poOpenQuotesAction().then((r) => setRows(r as Quote[])).catch((e) => setMsg(errorText(e))); }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return null;
  if (!rows.length && !msg) return null;
  const done = (m: string) => { setOpen(null); setMsg(m); load(); router.refresh(); };
  return (
    <section className="rounded-xl border border-amber-200 bg-white overflow-hidden">
      <div className="border-b border-amber-200 bg-amber-50 p-4">
        <h3 className="font-semibold">Waiting for supplier quotes ({rows.length})</h3>
        <p className="text-xs text-slate-600">PO lines ordered “To be quoted”. Enter the supplier’s price when it comes in; the approver confirms it. Their supplier bills cannot be approved until then.</p>
      </div>
      {msg && <div className="border-b px-4 py-2 text-sm text-slate-700">{msg}</div>}
      <div className="overflow-x-auto">
        <table className="m-cards w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-slate-500"><th className="p-2">PO</th><th className="p-2">Supplier</th><th className="p-2">Item</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Received</th><th className="p-2">Quote</th><th className="p-2 text-right">Days open</th><th className="p-2"></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td className="p-2 font-medium"><a className="underline" href={`/finance/procurement/po/${r.po_id}`} target="_blank" rel="noreferrer">{r.po_number}</a></td>
              <td className="p-2">{r.supplier || '—'}</td>
              <td className="p-2">{r.description}{r.note && <div className="text-xs text-red-700">{r.note}</div>}</td>
              <td className="p-2 text-right">{Number(r.quantity)} {r.unit}</td>
              <td className="p-2 text-right">{Number(r.received) > 0 ? `${Number(r.received)} ${r.unit}` : '—'}</td>
              <td className="p-2">{r.state === 'waiting' ? <span className="text-amber-700">Waiting for quote</span>
                : <span><b>{peso(r.quote_price)}</b> / {r.unit}<div className="text-xs text-slate-500">{r.quote_reference} · by {r.entered_by || '—'}</div></span>}</td>
              <td className={`p-2 text-right ${r.days_open > 7 ? 'font-semibold text-red-700' : ''}`}>{r.days_open}</td>
              <td className="p-2 whitespace-nowrap">
                {r.state === 'waiting' && canEnter && <button className="button-secondary" onClick={() => setOpen({ row: r, mode: 'enter' })}>Enter quote</button>}
                {r.state === 'to_approve' && canApprove && <button className="button" onClick={() => setOpen({ row: r, mode: 'decide' })}>Approve / reject</button>}
                {r.state === 'to_approve' && canEnter && <button className="ml-1 text-xs underline" onClick={() => setOpen({ row: r, mode: 'enter' })}>Change</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            {open.mode === 'enter' ? <EnterQuote row={open.row} onDone={done} onCancel={() => setOpen(null)} />
              : <DecideQuote row={open.row} self={open.row.entered_by_id === userId} onDone={done} onCancel={() => setOpen(null)} />}
          </div>
        </div>
      )}
    </section>
  );
}

function EnterQuote({ row, onDone, onCancel }: { row: Quote; onDone: (m: string) => void; onCancel: () => void }) {
  const [price, setPrice] = useState(row.quote_price != null ? String(row.quote_price) : '');
  const [ref, setRef] = useState(row.quote_reference ?? '');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-lg font-semibold">Enter supplier quote</h3>
      <p>{row.po_number} · {row.supplier}<br /><b>{row.description}</b> — {Number(row.quantity)} {row.unit}</p>
      <label className="block">Quoted unit price (per {row.unit})<input className="input mt-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="block">Quote reference<input className="input mt-1" placeholder="Quotation no., or “Viber 11 Oct”" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
      {Number(price) > 0 && <p className="text-slate-600">Line total {peso(Number(price) * Number(row.quantity))}</p>}
      {err && <p className="text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button className="button" disabled={pending} onClick={() => start(async () => {
          setErr('');
          try { await poQuoteEnterAction(row.id, Number(price), ref); onDone(`${row.description}: quote ${peso(Number(price))} sent for approval.`); } catch (e) { setErr(errorText(e)); }
        })}>{pending ? 'Saving…' : 'Send for approval'}</button>
        <button className="button-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function DecideQuote({ row, self, onDone, onCancel }: { row: Quote; self: boolean; onDone: (m: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const go = (approve: boolean) => start(async () => {
    setErr('');
    try {
      const r = await poQuoteDecideAction(row.id, approve, reason);
      onDone(approve ? `${row.description}: ${peso(row.quote_price)} confirmed${Number(r.received_costed) > 0 ? ` — ${Number(r.received_costed)} ${row.unit} already received now costed (${peso(r.inventory_value)})` : ''}.`
        : `${row.description}: quote rejected; back to waiting for a quote.`);
    } catch (e) { setErr(errorText(e)); }
  });
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-lg font-semibold">Confirm quoted price</h3>
      <p>{row.po_number} · {row.supplier}<br /><b>{row.description}</b> — {Number(row.quantity)} {row.unit}</p>
      <div className="rounded border bg-slate-50 p-3"><div className="text-2xl font-semibold">{peso(row.quote_price)} <span className="text-sm font-normal">per {row.unit}</span></div>
        <div className="text-xs text-slate-600">Line total {peso(Number(row.quote_price) * Number(row.quantity))} · {row.quote_reference} · entered by {row.entered_by}</div>
        {Number(row.received) > 0 && <div className="mt-1 text-xs text-slate-600">{Number(row.received)} {row.unit} already received — confirming books them into inventory at this price.</div>}</div>
      {self && <p className="text-amber-700">You entered this quote. Only the Business Admin can confirm their own entry.</p>}
      <label className="block">Reason (needed to reject)<input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <p className="text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button className="button" disabled={pending} onClick={() => go(true)}>Approve price</button>
        <button className="button-secondary" disabled={pending} onClick={() => go(false)}>Reject</button>
        <button className="button-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function PriceControlSettings({ onDone }: { onDone: (m: string) => void }) {
  const [v, setV] = useState<{ flag: string; tol: string } | null>(null);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => { priceControlSettingsAction().then((s) => { if (!s) setErr('Select a business in "Acting as" first.'); else setV({ flag: String(Number(s.po_increase_flag_pct)), tol: String(Number(s.bill_tolerance_pct)) }); }).catch((e) => setErr(errorText(e))); }, []);
  if (!v) return <p className="text-sm">{err || 'Loading…'}</p>;
  return (
    <div className="space-y-3 text-sm">
      <label className="block">Flag a PO price that is more than this % above the last purchase price from the supplier
        <input className="input mt-1" inputMode="decimal" value={v.flag} onChange={(e) => setV({ ...v, flag: e.target.value })} /></label>
      <label className="block">A supplier bill may be up to this % above the PO price (above it, the Business Admin approves the bill)
        <input className="input mt-1" inputMode="decimal" value={v.tol} onChange={(e) => setV({ ...v, tol: e.target.value })} /></label>
      {err && <p className="text-red-700">{err}</p>}
      <button className="button" disabled={pending} onClick={() => start(async () => {
        setErr('');
        try { await savePriceControlSettingsAction(Number(v.flag), Number(v.tol)); onDone('Price-control levels saved.'); } catch (e) { setErr(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Save'}</button>
    </div>
  );
}
