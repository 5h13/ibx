'use client';

// Build 74 — SF-01: the Storefront issues the DRs of sales orders.
//   • Lines come from the APPROVED sales order at the order's prices (no 7%
//     floor check); VAT follows the order (from its quotation).
//   • Partial deliveries: each DR covers what is still undelivered; lines
//     ordered from a supplier only up to what their PO has received.
//   • Payment: COD at the counter (now, or later with Receive AR payment) or
//     on credit per the order's terms — every order DR is billed in AR, so
//     its payment status shows here.
//   • The Warehouse confirms the physical release (Logistics → Warehouse /
//     Delivery); stock leaves at that point. An order is fulfilled when every
//     line is delivered and released.

import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { PopupAction } from '@/core/ui/PopupAction';
import { cancelOrderAction, combinedSiAction, orderDrAction, releaseDrAction, type StoreOrder } from './actions';
import { PaymentBlock } from './StorefrontManagement';
import { lotLabel, num, paysToInput, peso, r2, type Pay } from './storefrontShared';

const AR_LABEL: Record<string, string> = { approved: 'Unpaid', partially_paid: 'Partly paid', paid: 'Paid', voided: 'Voided' };
const q = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

function payStatus(o: StoreOrder) {
  if (!o.drs.length) return 'No DR yet';
  const open = o.drs.reduce((s, d) => s + Number(d.balance_due ?? 0), 0);
  if (open <= 0) return 'Paid';
  return o.drs.some((d) => d.invoice_status === 'paid' || d.invoice_status === 'partially_paid') ? `Partly paid · ${peso(open)} open` : `Unpaid · ${peso(open)}`;
}

// Build 78: each DR row carries a lot (the PO's lot for supplier lines, else the
// oldest with stock, filled in); a line can be split across lots; optional
// hardcopy DR no.
type DrRow = { key: number; lineId: string; qty: string; lot: string };
let drRowKey = 0;

function IssueDrForm({ order, vatBooklet, onDone }: { order: StoreOrder; vatBooklet: boolean; onDone: (m: string) => void }) {
  const canDeliver = (l: StoreOrder['lines'][number]) => {
    const left = Number(l.ordered) - Number(l.delivered);
    return l.fulfilment === 'source' ? Math.max(0, Math.min(left, Number(l.received ?? 0) - Number(l.delivered))) : Math.max(0, left);
  };
  // start with the quantity spread over the lots, the filled-in lot first, then oldest first
  const [rows, setRows] = useState<DrRow[]>(() => order.lines.flatMap((l) => {
    const want = canDeliver(l);
    const lots = l.lots ?? [];
    if (want <= 0 || lots.length === 0) return [{ key: ++drRowKey, lineId: l.id, qty: want > 0 ? String(want) : '', lot: l.default_lot_id ?? '' }];
    const order_ = [...lots.filter((o) => o.lot_id === l.default_lot_id), ...lots.filter((o) => o.lot_id !== l.default_lot_id)];
    const out: DrRow[] = []; let left = want;
    for (const o of order_) { if (left <= 0) break; const take = Math.min(left, Number(o.on_hand)); if (take > 0) { out.push({ key: ++drRowKey, lineId: l.id, qty: String(take), lot: o.lot_id }); left -= take; } }
    if (left > 0) { if (out.length) out[0] = { ...out[0], qty: String(Number(out[0].qty) + left) }; else out.push({ key: ++drRowKey, lineId: l.id, qty: String(left), lot: l.default_lot_id ?? '' }); }
    return out;
  }));
  const [pays, setPays] = useState<Pay[]>([]);
  const [si, setSi] = useState('');
  const [dr, setDr] = useState(true);
  const [notes, setNotes] = useState('');
  const [hardcopy, setHardcopy] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const lineOf = (id: string) => order.lines.find((l) => l.id === id)!;
  const lineQty = (id: string) => rows.filter((r) => r.lineId === id).reduce((s, r) => s + (num(r.qty) > 0 ? num(r.qty) : 0), 0);
  const total = r2(rows.reduce((s, r) => { const n = num(r.qty); return s + (n > 0 ? r2(n * Number(lineOf(r.lineId).unit_price)) : 0); }, 0));
  const vat = order.vat_applied ? r2(total * 12 / 112) : 0;
  const setRow = (key: number, patch: Partial<DrRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addLot = (r: DrRow) => {
    const l = lineOf(r.lineId);
    const used = new Set(rows.filter((x) => x.lineId === r.lineId).map((x) => x.lot));
    const next = (l.lots ?? []).find((o) => !used.has(o.lot_id));
    if (!next) { setError(`${l.description}: every lot with stock is already on this DR.`); return; }
    const i = rows.findIndex((x) => x.key === r.key);
    setRows([...rows.slice(0, i + 1), { key: ++drRowKey, lineId: r.lineId, qty: '', lot: next.lot_id }, ...rows.slice(i + 1)]);
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">{order.order_number} · {order.customer}{order.client_po ? ` · client PO ${order.client_po}` : ''} · terms {order.payment_terms ?? '—'} · {order.vat_applied ? 'with VAT' : 'without VAT'}</p>
      <table className="w-full">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Line</th><th className="p-2 text-right">Ordered</th><th className="p-2 text-right">Delivered</th><th className="p-2 text-right">Can deliver now</th><th className="p-2 text-right">Price</th><th className="p-2">Lot</th><th className="p-2 w-28">This DR</th></tr></thead>
        <tbody>{rows.map((r) => {
          const l = lineOf(r.lineId);
          const first = rows.find((x) => x.lineId === r.lineId)?.key === r.key;
          const max = canDeliver(l);
          const lots = l.lots ?? [];
          const lot = lots.find((o) => o.lot_id === r.lot);
          return (
            <tr key={r.key} className={`align-top ${first ? 'border-t' : ''}`}>
              <td className="p-2">{first ? <>{l.description}
                <div className="text-xs text-slate-500">{l.fulfilment === 'source' ? `from supplier · received ${q(l.received)}` : l.fulfilment === 'service' ? 'service' : `from stock${l.on_hand !== null ? ` · ${q(l.on_hand)} on hand at the store` : ''}${Number(l.reserved_here ?? 0) > 0 ? ` · ${q(l.reserved_here)} reserved for this order` : ''}`}</div>
                {l.fulfilment === 'stock' && l.on_hand !== null && lineQty(l.id) > Number(l.on_hand) && <div className="text-xs text-red-700">More than on hand — stock will go negative at release</div>}</> : <span className="text-xs text-slate-500">↳ same line, another lot</span>}</td>
              <td className="p-2 text-right">{first ? `${q(l.ordered)} ${l.unit ?? ''}` : ''}</td><td className="p-2 text-right">{first ? q(l.delivered) : ''}</td><td className="p-2 text-right">{first ? q(max) : ''}</td>
              <td className="p-2 text-right">{first ? peso(l.unit_price) : ''}</td>
              <td className="p-2">{l.fulfilment === 'service' ? <span className="text-xs text-slate-400">—</span> : lots.length === 0 ? <span className="text-xs text-slate-500">No lot with stock here</span> : <>
                <select className="input min-w-[11rem]" value={r.lot} onChange={(e) => setRow(r.key, { lot: e.target.value })}>
                  <option value="">Choose the lot…</option>
                  {lots.map((o) => <option key={o.lot_id} value={o.lot_id}>{lotLabel(o)}</option>)}
                </select>
                {lot && num(r.qty) > Number(lot.on_hand) && <div className="text-xs text-red-700">More than this lot holds ({q(lot.on_hand)})</div>}
                {lots.length > 1 && max > 0 && <button type="button" className="text-xs text-blue-700 underline" onClick={() => addLot(r)}>+ from another lot</button>}
                {!first && <button type="button" className="ml-2 text-xs text-slate-500 underline" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>remove</button>}</>}</td>
              <td className="p-2"><input className="input" type="number" min="0" max={max} step="any" disabled={max <= 0} placeholder={max > 0 ? '' : l.fulfilment === 'source' && Number(l.delivered) < Number(l.ordered) ? 'await PO' : 'done'}
                value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />
                {first && lineQty(l.id) > max && <div className="text-xs text-red-700">Only {q(max)} can be delivered</div>}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <div>
        <div className="mb-1 font-medium">Payment on delivery (optional)</div>
        <p className="mb-2 text-xs text-slate-500">Leave empty for COD collected later (Receive AR payment when the cash reaches the counter) or for credit per the order's terms. Every order DR is billed in AR.</p>
        <PaymentBlock total={total} pays={pays} setPays={setPays} si={si} setSi={setSi} dr={dr} setDr={setDr} vatBooklet={vatBooklet} drFixed
          vatNote={order.vat_applied ? `This order is with VAT (from its quotation): VAT ${peso(vat)} included; an SI must come from a VAT-registered booklet.` : 'This order is without VAT; an SI must come from a non-VAT booklet (or issue the DR only).'} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Notes (optional, e.g. driver, vehicle)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <input className="input" placeholder="Hardcopy DR no. (optional)" maxLength={40} value={hardcopy} onChange={(e) => setHardcopy(e.target.value)} />
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !(total > 0)} onClick={() => start(async () => {
        setError('');
        const missing = rows.find((r) => num(r.qty) > 0 && !r.lot && (lineOf(r.lineId).lots ?? []).length > 0);
        if (missing) { setError(`Choose the lot for ${lineOf(missing.lineId).description}.`); return; }
        try {
          const r = await orderDrAction({ order_id: order.id, notes, si_number: si, payments: paysToInput(pays), hardcopy_dr_no: hardcopy.trim() || undefined,
            lines: rows.map((x) => ({ sales_order_item_id: x.lineId, quantity: num(x.qty), lot_id: x.lot || null })).filter((x) => x.quantity > 0) });
          onDone(`${r.dr_number} issued for ${order.order_number} (${peso(r.total)}${Number(r.balance) > 0 ? `, ${peso(r.balance)} open in AR` : ', paid'}). The Warehouse confirms the release.`);
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : `Issue DR (${peso(total)})`}</button></div>
    </div>
  );
}

// Build 78: cancelling an order releases its stock reservation (no DR may be out).
function CancelOrderForm({ order, onDone }: { order: StoreOrder; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Cancelling {order.order_number} ({order.customer}) releases the stock reserved for it. An order with a DR already issued can't be cancelled: return or cancel that sale first.{order.pr_number ? ` Its PR ${order.pr_number} stays in Procurement.` : ''}</p>
      <input className="input" placeholder="Why is the order cancelled? *" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !reason.trim()} onClick={() => start(async () => {
        try { await cancelOrderAction(order.id, reason); onDone(`${order.order_number} cancelled; its reserved stock is free again.`); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Cancel order'}</button></div>
    </div>
  );
}


// Build 75 — one booklet SI across several DRs of the order (DOC-09 / DOC-10).
function EnterSiForm({ order, onDone }: { order: StoreOrder; onDone: (m: string) => void }) {
  const open = order.drs.filter((d) => !d.si_number);
  const [picked, setPicked] = useState<string[]>(open.map((d) => d.sale_id));
  const [si, setSi] = useState('');
  const [date, setDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()));
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const total = open.filter((d) => picked.includes(d.sale_id)).reduce((s, d) => s + Number(d.total), 0);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Enter the SI number written in the BIR booklet once for the DRs it covers. AR then keeps one invoice for them; payments already received move with them, and a DR can't be put on another SI. {order.vat_applied ? 'This order is with VAT: the SI must come from a VAT-registered booklet.' : 'This order is without VAT: the SI must come from a non-VAT booklet.'}</p>
      <div className="space-y-1">
        {open.map((d) => (
          <label key={d.sale_id} className="flex items-center gap-2 rounded border px-2 py-1">
            <input type="checkbox" checked={picked.includes(d.sale_id)} onChange={(e) => setPicked(e.target.checked ? [...picked, d.sale_id] : picked.filter((x) => x !== d.sale_id))} />
            <span className="flex-1">{d.dr_number} · {d.sale_date}</span><span>{peso(d.total)}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">SI number *<input className="input mt-1" value={si} onChange={(e) => setSi(e.target.value)} placeholder="From the BIR booklet" /></label>
        <label className="block">SI date<input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <p>Invoice total <b>{peso(total)}</b> for {picked.length} DR(s)</p>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !si.trim() || picked.length === 0} onClick={() => start(async () => {
        setError('');
        try { const r = await combinedSiAction({ sale_ids: picked, si_number: si.trim(), si_date: date }); onDone(`SI ${si.trim()} recorded as ${r.invoice_number} covering ${r.drs} — ${peso(r.total)}, balance ${peso(r.balance)}.`); }
        catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Record SI'}</button></div>
    </div>
  );
}

export function OrdersTab({ orders, readOnly, canRelease, canCancel = false, vatBooklet, onMessage }: { orders: StoreOrder[]; readOnly: boolean; canRelease: boolean; canCancel?: boolean; vatBooklet: boolean; onMessage: (m: string) => void }) {
  const [pending, start] = useTransition();
  if (!orders.length) return <p className="text-sm text-slate-500">No approved sales orders to deliver. Orders come from quotations (Sales / Revenue Pipeline) once the client's go-signal is recorded and the order is approved.</p>;
  return (
    <div className="space-y-4 text-sm">
      {orders.map((o) => {
        const ordered = o.lines.reduce((s, l) => s + Number(l.ordered), 0);
        const delivered = o.lines.reduce((s, l) => s + Number(l.delivered), 0);
        const released = o.lines.reduce((s, l) => s + Number(l.released), 0);
        const open = o.lines.some((l) => Number(l.delivered) < Number(l.ordered));
        return (
          <div key={o.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{o.order_number} · {o.customer} · {peso(o.total)}</div>
                <div className="text-xs text-slate-500">{o.quotation_number ? `Quote ${o.quotation_number} · ` : ''}{o.client_po ? `Client PO ${o.client_po} · ` : ''}terms {o.payment_terms ?? '—'} · {o.vat_applied ? 'with VAT' : 'no VAT'}
                  {o.pr_number ? ` · PR ${o.pr_number}` : ''}{o.po_numbers.length ? ` · PO ${o.po_numbers.join(', ')}` : ''}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-slate-100 px-2 py-0.5">DR issued {q(delivered)}/{q(ordered)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">Released {q(released)}/{q(ordered)}</span>
                <span className={`rounded px-2 py-0.5 ${payStatus(o).startsWith('Paid') ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{payStatus(o)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 capitalize">{o.status}</span>
                {!readOnly && open && <PopupAction label="Issue DR" title={`DR from ${o.order_number}`} wide>{(close) => <IssueDrForm order={o} vatBooklet={vatBooklet} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>}
                {!readOnly && o.drs.some((d) => !d.si_number) && <PopupAction label="Enter SI" title={`SI for ${o.order_number}`} variant="secondary" wide>{(close) => <EnterSiForm order={o} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>}
                {canCancel && o.drs.length === 0 && <PopupAction label="Cancel order…" title={`Cancel ${o.order_number}`} variant="secondary">{(close) => <CancelOrderForm order={o} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>}
              </div>
            </div>
            <table className="mt-2 w-full text-xs">
              <thead><tr className="border-b text-left uppercase text-slate-500"><th className="p-1">Line</th><th className="p-1 text-right">Ordered</th><th className="p-1 text-right">DR issued</th><th className="p-1 text-right">Released</th><th className="p-1 text-right">Reserved</th><th className="p-1">Source</th></tr></thead>
              <tbody>{o.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0"><td className="p-1">{l.description}</td><td className="p-1 text-right">{q(l.ordered)} {l.unit}</td><td className="p-1 text-right">{q(l.delivered)}</td><td className="p-1 text-right">{q(l.released)}</td>
                  <td className="p-1 text-right">{Number(l.reserved_here ?? 0) > 0 ? q(l.reserved_here) : '—'}</td>
                  <td className="p-1">{l.fulfilment === 'source' ? `Supplier · PO received ${q(l.received)}` : l.fulfilment === 'service' ? 'Service' : 'Stock'}</td></tr>
              ))}</tbody>
            </table>
            {o.drs.length > 0 && (
              <div className="mt-2 space-y-1">
                {o.drs.map((d) => (
                  <div key={d.sale_id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-xs">
                    <span><a className="underline" href={`/sales/storefront/${d.sale_id}/dr`} target="_blank" rel="noreferrer">{d.dr_number}</a>{d.si_number ? ` · SI ${d.si_number}` : ''}{d.hardcopy_dr_no ? ` · hardcopy ${d.hardcopy_dr_no}` : ''} · {d.sale_date} · {peso(d.total)}
                      {' · '}{d.release_status === 'released' ? 'released by the Warehouse' : 'waiting for the Warehouse'}
                      {' · '}{AR_LABEL[d.invoice_status ?? ''] ?? '—'}{Number(d.balance_due ?? 0) > 0 ? ` ${peso(d.balance_due)}${d.due_date ? ` due ${d.due_date}` : ''}` : ''}</span>
                    {canRelease && !readOnly && d.release_status !== 'released' && (
                      <button className="button-secondary" disabled={pending} onClick={() => start(async () => {
                        try { const r = await releaseDrAction(d.sale_id); onMessage(`${r.dr_number} released${r.order_complete ? ` — ${o.order_number} is complete` : ''}.`); } catch (e) { onMessage(errorText(e)); }
                      })}>Confirm release</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
