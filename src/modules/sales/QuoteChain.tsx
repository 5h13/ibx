'use client';

// Build 69 — Quote → Sales Order → PR (DOC-05/06/07/11/12/13), opened as
// pop-ups from Sales / Revenue Pipeline:
//   • QuoteView     — quotation detail, revision history, print, revise.
//   • GoSignalForm  — "Create order": the client's go-signal plus, per line,
//                     from stock or order from supplier.
//   • OrderView     — sales order detail with its chain (quote, PR, POs) and
//                     the confirmation screenshot.

import { useEffect, useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { createOrderFromGoSignalAction, orderChainAction, quotationDetailAction, quoteOrderLinesAction, reviseQuotationAction } from './revenueActions';

const money = (n: unknown) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
export const REVISABLE = ['draft', 'prepared', 'reviewed', 'approved', 'sent', 'accepted', 'rejected', 'expired'];
export const ORDERABLE = ['approved', 'sent', 'accepted'];
export const GO_SIGNAL_VIA = ['Client PO', 'Viber', 'Messenger', 'Email', 'SMS', 'Phone call', 'In person', 'Other'];

function ErrorBox({ text }: { text: string }) {
  return text ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{text}</div> : null;
}
function Chip({ s }: { s: string }) {
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize">{String(s).replaceAll('_', ' ')}</span>;
}

// ---------------------------------------------------------------- quote --
export function QuoteView({ quotationId, onRevised }: { quotationId: string; onRevised: (msg: string) => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof quotationDetailAction>> | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    quotationDetailAction(quotationId).then((r) => { if (live) setD(r); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [quotationId]);
  if (!d) return error ? <ErrorBox text={error} /> : <p className="text-sm text-slate-500">Loading…</p>;
  const q: any = d.quote;
  const canRevise = REVISABLE.includes(q.status) && d.orders.length === 0;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <div><div className="text-xs text-slate-500">Customer</div><div className="font-medium">{q.customer?.legal_name}</div></div>
        <div><div className="text-xs text-slate-500">Date / valid until</div><div className="font-medium">{q.quotation_date} / {q.valid_until || '—'}</div></div>
        <div><div className="text-xs text-slate-500">Payment terms / lead time</div><div className="font-medium">{q.payment_terms || '—'} / {q.delivery_lead_time || '—'}</div></div>
        <div><div className="text-xs text-slate-500">Status</div><Chip s={q.status} /></div>
      </div>
      <table className="w-full">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit price</th><th className="p-2 text-right">Amount</th></tr></thead>
        <tbody>{[...(q.items ?? [])].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at))).map((i: any) => (
          <tr key={i.id} className="border-b"><td className="p-2">{i.description}{!i.catalog_item_id && <span className="ml-1 text-xs text-slate-500">(custom)</span>}</td>
            <td className="p-2 text-right">{Number(i.quantity)} {i.unit}</td><td className="p-2 text-right">{money(i.unit_price)}</td><td className="p-2 text-right">{money(i.amount)}</td></tr>))}</tbody>
        <tfoot>
          <tr><td colSpan={3} className="p-2 text-right text-slate-500">Subtotal</td><td className="p-2 text-right">{money(q.subtotal)}</td></tr>
          {Number(q.discount_amount) > 0 && <tr><td colSpan={3} className="p-2 text-right text-slate-500">Discount</td><td className="p-2 text-right">−{money(q.discount_amount)}</td></tr>}
          {Number(q.tax_amount) > 0 && <tr><td colSpan={3} className="p-2 text-right text-slate-500">Tax</td><td className="p-2 text-right">{money(q.tax_amount)}</td></tr>}
          {Number(q.other_charges) > 0 && <tr><td colSpan={3} className="p-2 text-right text-slate-500">Other charges</td><td className="p-2 text-right">{money(q.other_charges)}</td></tr>}
          <tr><td colSpan={3} className="p-2 text-right font-semibold">Total</td><td className="p-2 text-right font-semibold">{money(q.total_amount)}</td></tr>
          {q.vat_applied && <tr><td colSpan={3} className="p-2 text-right text-slate-500">VAT 12% (included)</td><td className="p-2 text-right">{money(q.vat_amount)}</td></tr>}
        </tfoot>
      </table>
      {d.history.length > 1 && (
        <div><div className="mb-1 font-medium">Revisions</div>
          {d.history.map((h: any) => <div key={h.id} className={`flex justify-between border-b py-1 ${h.id === q.id ? 'font-medium' : ''}`}><span>{h.quotation_number} · {h.quotation_date}</span><span>{money(h.total_amount)} · <Chip s={h.status} /></span></div>)}
        </div>
      )}
      {d.orders.length > 0 && <div>Sales order: {d.orders.map((o: any) => `${o.order_number} (${o.status})`).join(', ')}</div>}
      <ErrorBox text={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <a className="button-secondary" href={`/sales/quotations/${q.id}`} target="_blank" rel="noreferrer">Print / PDF</a>
        {canRevise && <button type="button" className="button" disabled={pending} onClick={() => start(async () => {
          try { const r = await reviseQuotationAction(q.id); onRevised(`${r.quotation_number} created as a new draft at current prices (${money(r.old_subtotal)} → ${money(r.subtotal)} subtotal); ${q.quotation_number} is now superseded.`); }
          catch (e) { setError(errorText(e)); }
        })}>{pending ? 'Revising…' : 'Revise (new revision at current prices)'}</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ go-signal --
export function GoSignalForm({ quote, onDone }: { quote: any; onDone: (msg: string) => void }) {
  const [lines, setLines] = useState<Awaited<ReturnType<typeof quoteOrderLinesAction>> | null>(null);
  const [choice, setChoice] = useState<Record<string, 'stock' | 'source'>>({});
  const [po, setPo] = useState('');
  const [via, setVia] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    quoteOrderLinesAction(quote.id).then((r) => {
      if (!live) return;
      setLines(r);
      // default: order from the supplier when stock does not cover the quantity
      setChoice(Object.fromEntries(r.filter((l) => l.item_type === 'product').map((l) => [l.quotation_item_id, Number(l.on_hand ?? 0) >= Number(l.quantity) ? 'stock' : 'source'])));
    }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [quote.id]);
  const sourcing = Object.values(choice).filter((v) => v === 'source').length;

  return (
    <form className="space-y-4 text-sm" action={(fd) => {
      setError('');
      fd.set('quotation_id', quote.id);
      fd.set('lines', JSON.stringify(Object.entries(choice).map(([quotation_item_id, fulfilment]) => ({ quotation_item_id, fulfilment }))));
      start(async () => {
        try {
          const r = await createOrderFromGoSignalAction(fd);
          onDone(`${r.order_number} created and sent to the Sales final approver.${r.lines_to_source ? ` On approval, ${r.lines_to_source} line(s) go to Procurement as a PR.` : ''}`);
        } catch (e) { setError(errorText(e)); }
      });
    }}>
      <p className="text-slate-600">{quote.quotation_number} · {quote.customer?.legal_name} · {money(quote.total_amount)}</p>
      <section className="space-y-2">
        <h4 className="font-semibold">Client go-signal</h4>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">Received via *<select className="input mt-1" name="go_signal_via" value={via} onChange={(e) => setVia(e.target.value)} required>
            <option value="">Select</option>{GO_SIGNAL_VIA.map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="block">Date *<input className="input mt-1" type="date" name="go_signal_date" max={manilaToday()} defaultValue={manilaToday()} required /></label>
          <label className="block">Confirmed by (client) *<input className="input mt-1" name="confirmed_by" placeholder="Name / position" required /></label>
          <label className="block">Client PO no.<input className="input mt-1" name="client_po_number" value={po} onChange={(e) => setPo(e.target.value)} placeholder="If the client issued one" /></label>
        </div>
        <label className="block">Screenshot of the confirmation {po.trim() ? '(optional)' : <b className="text-amber-700">(required — no client PO)</b>}
          <input className="input mt-1" type="file" name="proof" accept="image/*,application/pdf" required={!po.trim()} /></label>
      </section>
      <section className="space-y-2">
        <h4 className="font-semibold">Delivery</h4>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">Requested delivery<input className="input mt-1" type="date" name="requested_delivery_date" /></label>
          <label className="block sm:col-span-3">Delivery address<input className="input mt-1" name="delivery_address" /></label>
          <label className="block">Contact person<input className="input mt-1" name="contact_name" /></label>
          <label className="block">Contact phone<input className="input mt-1" name="contact_phone" /></label>
          <label className="block sm:col-span-2">Notes<input className="input mt-1" name="notes" /></label>
        </div>
      </section>
      <section className="space-y-2">
        <h4 className="font-semibold">Lines — from stock or order from supplier</h4>
        {!lines && !error && <p className="text-slate-500">Loading lines and stock…</p>}
        {lines && (
          <table className="w-full">
            <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">On hand</th><th className="p-2">Fulfil</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.quotation_item_id} className="border-b">
                <td className="p-2">{l.description}{l.item_type === 'custom' && <span className="ml-1 text-xs text-slate-500">(custom)</span>}</td>
                <td className="p-2 text-right">{Number(l.quantity)} {l.unit}</td>
                <td className={`p-2 text-right ${l.on_hand !== null && Number(l.on_hand) < Number(l.quantity) ? 'text-amber-700' : ''}`}>{l.on_hand === null ? '—' : Number(l.on_hand).toLocaleString()}</td>
                <td className="p-2">{l.item_type === 'service' ? <span className="text-slate-500">Service</span> : (
                  <select className="input" value={choice[l.quotation_item_id] ?? 'stock'} onChange={(e) => setChoice({ ...choice, [l.quotation_item_id]: e.target.value as 'stock' | 'source' })}>
                    <option value="stock">From stock</option><option value="source">Order from supplier (PR)</option></select>)}</td>
              </tr>))}</tbody>
          </table>
        )}
        <p className="text-xs text-slate-500">{sourcing > 0 ? `${sourcing} line(s) will be sent to Procurement as one PR, linked to this order, once the Sales final approver approves it.` : 'No PR will be created — every line is from stock.'} Stock on hand counts every location of this business.</p>
      </section>
      <ErrorBox text={error} />
      <div className="flex justify-end"><button className="button" disabled={pending || !lines}>{pending ? 'Saving…' : 'Create sales order'}</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- order --
export function OrderView({ orderId }: { orderId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof orderChainAction>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    orderChainAction(orderId).then((r) => { if (live) setD(r); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [orderId]);
  if (!d) return error ? <ErrorBox text={error} /> : <p className="text-sm text-slate-500">Loading…</p>;
  const o: any = d.order; const c = d.chain;
  const FUL: Record<string, string> = { stock: 'From stock', source: 'Order from supplier', service: 'Service' };
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 rounded bg-slate-50 p-3">
        <span className="text-xs uppercase text-slate-500">Chain</span>
        <b>{c.quotation_number ?? 'No quotation'}</b><span>→</span><b>{o.order_number}</b> <Chip s={o.status} /><span>→</span>
        {c.pr_number ? <><b>{c.pr_number}</b> <Chip s={c.pr_status ?? ''} /> <span className="text-xs text-slate-500">{String(c.pr_fulfilment ?? '').replaceAll('_', ' ')}</span></>
          : <span className="text-slate-500">{o.items?.some((i: any) => i.fulfilment === 'source') ? 'PR is created when the order is approved' : 'No PR (all from stock)'}</span>}
        {c.po_numbers?.length > 0 && <><span>→</span><b>{c.po_numbers.join(', ')}</b></>}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><div className="text-xs text-slate-500">Customer</div><div className="font-medium">{o.customer?.legal_name}</div></div>
        <div><div className="text-xs text-slate-500">Go-signal</div><div className="font-medium">{o.go_signal_via ?? '—'} · {o.go_signal_date ?? '—'}</div><div className="text-xs">{o.go_signal_confirmed_by}</div></div>
        <div><div className="text-xs text-slate-500">Client PO</div><div className="font-medium">{o.client_po_number || 'None'}</div>
          {d.proofUrl && <a className="text-xs underline" href={d.proofUrl} target="_blank" rel="noreferrer">View confirmation screenshot</a>}</div>
        <div><div className="text-xs text-slate-500">Delivery</div><div className="font-medium">{o.requested_delivery_date || '—'}</div><div className="text-xs">{[o.delivery_address, o.contact_name, o.contact_phone].filter(Boolean).join(' · ')}</div></div>
      </div>
      <table className="w-full">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Amount</th><th className="p-2">Fulfil</th></tr></thead>
        <tbody>{(o.items ?? []).map((i: any) => <tr key={i.id} className="border-b"><td className="p-2">{i.description}</td><td className="p-2 text-right">{Number(i.quantity)} {i.unit}</td><td className="p-2 text-right">{money(i.amount)}</td><td className="p-2">{FUL[i.fulfilment] ?? i.fulfilment}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2} className="p-2 text-right font-semibold">Total</td><td className="p-2 text-right font-semibold">{money(o.total_amount)}</td><td /></tr>
          <tr><td colSpan={4} className="p-2 text-right text-xs text-slate-500">{o.vat_applied ? `With VAT (from the quotation): VAT 12% included ${money(o.vat_amount)}` : 'Without VAT (from the quotation)'}{o.payment_terms ? ` · terms ${o.payment_terms}` : ''} · DRs are issued at the Storefront (Orders tab)</td></tr></tfoot>
      </table>
      {o.notes && <p className="text-slate-600">Notes: {o.notes}</p>}
    </div>
  );
}
