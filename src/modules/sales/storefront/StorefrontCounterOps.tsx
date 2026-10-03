'use client';

// Build 68 — DOC-15 part 2 counter operations, opened from the Storefront
// action bar / tabs as pop-ups (Build 65 layout rule):
//   • Receive AR payment — pay an existing (old) invoice, partial allowed.
//     Build 88: by default one payment is applied to the oldest invoices first.
//   • Return / refund    — staff, linked to the original sale, with a reason.
//   • Close the day      — cash count vs expected, per-method summary, sent
//                          to an approver; approvers approve or return it.

import { useEffect, useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { CustomerBox } from './CustomerBox';
import { PopupAction } from '@/core/ui/PopupAction';
import {
  cashMovementAction, closeDayAction, closingPreviewAction, collectArAction, collectArOldestAction, decideClosingAction, openInvoicesAction, refundableAction, returnAction, saleForReturnAction,
} from './actions';
import { CONDITION_LABEL, METHODS, changeDue, methodLabel, num, paysToInput, paysTotal, peso, pesoSigned, r2, type Pay } from './storefrontShared';
import { useStoreAccounts } from './accountsContext';
import { PayRow } from './PayRow';
import type { ReturnCondition } from './actions';

type Customer = { id: string; customer_code: string; legal_name: string; phone: string | null };

function ErrorBox({ text }: { text: string }) {
  return text ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{text}</div> : null;
}

/** Payment (or refund) rows: method, amount, reference. */
function PayRows({ pays, setPays, fillLabel, fillAmount, refund = false }: { pays: Pay[]; setPays: (p: Pay[]) => void; fillLabel: string; fillAmount: number; refund?: boolean }) {
  const set = (i: number, patch: Partial<Pay>) => setPays(pays.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-2">
      {pays.map((p, i) => <PayRow key={i} p={p} set={(patch) => set(i, patch)} remove={() => setPays(pays.filter((_, j) => j !== i))} refund={refund}
        due={refund ? undefined : r2(fillAmount - pays.reduce((s, x, j) => s + (j !== i && Number.isFinite(num(x.amount)) ? num(x.amount) : 0), 0))} />)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button-secondary" onClick={() => setPays([...pays, { method: 'cash', amount: '', reference: '' }])}>+ Add line</button>
        <button type="button" className="button-secondary" disabled={!(fillAmount > 0)} onClick={() => setPays([{ method: 'cash', amount: String(r2(fillAmount)), reference: '' }])}>{fillLabel}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AR --
export function ArCollectionForm({ customers, walkInId, onDone }: { customers: Customer[]; walkInId: string; onDone: (msg: string) => void }) {
  const [customerId, setCustomerId] = useState('');
  const [invoices, setInvoices] = useState<Awaited<ReturnType<typeof openInvoicesAction>> | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [oneInvoice, setOneInvoice] = useState(false);   // Build 88: default = oldest invoices first
  const [pays, setPays] = useState<Pay[]>([{ method: 'cash', amount: '', reference: '' }]);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const inv = invoices?.find((i) => i.invoice_id === invoiceId);
  const paying = paysTotal(pays);
  const owed = r2((invoices ?? []).reduce((s, i) => s + Number(i.balance_due), 0));
  // the split the counter will make: oldest invoice first (same order as the list)
  const split: Record<string, number> = {};
  { let left = Number.isFinite(paying) ? paying : 0; for (const i of invoices ?? []) { const t = r2(Math.min(left, Number(i.balance_due))); split[i.invoice_id] = t > 0 ? t : 0; left = r2(left - split[i.invoice_id]); } }

  function pick(id: string) {
    setCustomerId(id); setInvoices(null); setInvoiceId(''); setError('');
    if (!id) return;
    start(async () => {
      try { const r = await openInvoicesAction(id); setInvoices(r); if (r.length >= 1) setInvoiceId(r[0].invoice_id); }
      catch (e) { setError(errorText(e)); }
    });
  }
  function save() {
    setError('');
    start(async () => {
      try {
        if (!oneInvoice) {
          const r = await collectArOldestAction(customerId, paysToInput(pays));
          if (r.payment_id && r.applied.length === 1) window.open(`/sales/storefront/payments/${r.payment_id}/receipt`, '_blank');
          onDone(`${peso(r.amount)} received, oldest first: ${r.applied.map((a) => `${a.dr ? 'DR ' + a.dr : a.invoice_number} ${peso(a.applied)}${Number(a.balance) > 0 ? ` (balance ${peso(a.balance)})` : ' (paid)'}`).join('; ')}. Still owed ${peso(r.balance)}.`);
          return;
        }
        const r = await collectArAction(invoiceId, paysToInput(pays));
        if (r.payment_id) window.open(`/sales/storefront/payments/${r.payment_id}/receipt`, '_blank');
        onDone(`${peso(r.amount)} received on ${r.invoice_number}. Remaining balance ${peso(r.balance)}.`);
      } catch (e) { setError(errorText(e)); }
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CustomerBox customers={customers.filter((c) => c.id !== walkInId)} value={customerId} onChange={pick} placeholder="Type the customer's name, code or phone" />
      </div>
      {pending && !invoices && customerId && <p className="text-slate-500">Loading open invoices…</p>}
      {customerId && <a className="text-xs underline" href={`/finance/accounts-receivable/statement/${customerId}`} target="_blank" rel="noreferrer">Print statement of account</a>}
      {invoices && invoices.length === 0 && <p className="text-slate-500">This customer has no unpaid approved invoices.</p>}
      {invoices && invoices.length > 0 && (
        <table className="w-full">
          <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2" /><th className="p-2">Invoice</th><th className="p-2">Date</th><th className="p-2">Due</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Balance</th>{!oneInvoice && <th className="p-2 text-right">This payment</th>}</tr></thead>
          <tbody>{invoices.map((i) => (
            <tr key={i.invoice_id} className="border-b">
              <td className="p-2">{oneInvoice && <input type="radio" name="inv" checked={invoiceId === i.invoice_id} onChange={() => setInvoiceId(i.invoice_id)} aria-label={i.invoice_number} />}</td>
              <td className="p-2 font-medium">{i.invoice_number}</td><td className="p-2">{i.invoice_date}</td><td className="p-2">{i.due_date ?? '—'}</td>
              <td className="p-2 text-right">{peso(i.total_amount)}</td><td className="p-2 text-right">{peso(i.amount_received)}</td><td className="p-2 text-right font-medium text-amber-700">{peso(i.balance_due)}</td>
              {!oneInvoice && <td className="p-2 text-right">{split[i.invoice_id] > 0 ? <span className="font-medium text-emerald-700">{peso(split[i.invoice_id])}{split[i.invoice_id] >= Number(i.balance_due) ? ' · paid' : ''}</span> : <span className="text-slate-400">—</span>}</td>}
            </tr>))}
            <tr><td colSpan={6} className="p-2 text-right text-slate-500">Total owed</td><td className="p-2 text-right font-semibold">{peso(owed)}</td>{!oneInvoice && <td />}</tr>
          </tbody>
        </table>
      )}
      {invoices && invoices.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={oneInvoice} onChange={(e) => setOneInvoice(e.target.checked)} />
          Pay one specific invoice instead (normally the payment goes to the oldest invoices first)</label>
      )}
      {invoices && invoices.length > 0 && (oneInvoice ? inv : true) && (() => {
        const target = oneInvoice && inv ? Number(inv.balance_due) : owed;
        return (
          <>
            <PayRows pays={pays} setPays={setPays} fillLabel={oneInvoice ? 'Pay full balance in cash' : 'Pay everything owed in cash'} fillAmount={target} />
            <div className="grid gap-2 rounded bg-slate-50 p-3 sm:grid-cols-3">
              <div>{oneInvoice ? 'Balance' : 'Total owed'} <b>{peso(target)}</b></div><div>Paying <b>{peso(paying)}</b>{changeDue(pays) > 0 && <> · change <b className="text-emerald-700">{peso(changeDue(pays))}</b></>}</div>
              <div>{paying > target ? <b className="text-red-700">More than {oneInvoice ? 'the balance' : 'what is owed'}</b> : <>Remaining <b>{peso(r2(target - paying))}</b></>}</div>
            </div>
            <p className="text-xs text-slate-500">{oneInvoice ? 'Each line is posted as an AR receipt on the invoice; Finance sees it at once.' : 'The payment pays the oldest invoice first, then the next (see "This payment" above); each part is posted as an AR receipt on its invoice. A check covering several invoices stays one check.'}</p>
          </>
        );
      })()}
      <ErrorBox text={error} />
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !invoices?.length || (oneInvoice && !inv) || !(paying > 0)} onClick={save}>{pending ? 'Saving…' : `Receive ${peso(paying)}`}</button></div>
    </div>
  );
}

// ------------------------------------------------------------- returns --
export function ReturnForm({ saleNumber = '', onDone }: { saleNumber?: string; onDone: (msg: string) => void }) {
  const [no, setNo] = useState(saleNumber);
  const [sale, setSale] = useState<Awaited<ReturnType<typeof saleForReturnAction>> | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<Record<string, ReturnCondition>>({});
  const [reason, setReason] = useState('');
  const [pays, setPays] = useState<Pay[]>([{ method: 'cash', amount: '', reference: '' }]);
  const [refundable, setRefundable] = useState<Awaited<ReturnType<typeof refundableAction>>>([]);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const value = sale ? r2(sale.lines.reduce((s, l) => { const q = num(qty[l.sale_item_id] ?? ''); return s + (q > 0 ? r2(q * Number(l.unit_price)) : 0); }, 0)) : 0;
  const credit = sale ? r2(Math.min(value, Math.max(Number(sale.ar_balance), 0))) : 0;
  const refund = r2(value - credit);
  const entered = paysTotal(pays);

  function find() {
    setError(''); setSale(null); setQty({});
    start(async () => {
      try { const found = await saleForReturnAction(no.trim()); setSale(found); setRefundable(await refundableAction(found.id)); }
      catch (e) { setError(errorText(e)); }
    });
  }
  function save() {
    if (!sale) return;
    setError('');
    start(async () => {
      try {
        const r = await returnAction({
          sale_id: sale.id, reason,
          lines: sale.lines.map((l) => ({ sale_item_id: l.sale_item_id, quantity: num(qty[l.sale_item_id] ?? ''), condition: cond[l.sale_item_id] ?? 'back_to_stock' })).filter((l) => l.quantity > 0),
          refunds: refund > 0 ? paysToInput(pays) : [],
        });
        onDone(`${r.return_number} recorded: ${peso(r.total)} returned${Number(r.credit_to_ar) > 0 ? `, ${peso(r.credit_to_ar)} taken off the unpaid balance` : ''}${Number(r.refund) > 0 ? `, ${peso(r.refund)} refunded` : ''}.${Number(r.damaged_cost) > 0 ? ' Damaged items are kept aside (not sellable); the rest is back in stock.' : ' Items are back in stock.'}`);
      } catch (e) { setError(errorText(e)); }
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Sale, DR, SI or hardcopy DR no." value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } }} />
        <button type="button" className="button-secondary" disabled={pending || !no.trim()} onClick={find}>Find sale</button>
      </div>
      {sale && (
        <>
          <div className="text-slate-600">{sale.sale_number}{sale.dr_number ? ` · ${sale.dr_number}` : ''}{sale.si_number ? ` · SI ${sale.si_number}` : ''} · {sale.sale_date} · {sale.customer} · total {peso(sale.total)}{Number(sale.ar_balance) > 0 && <> · unpaid balance <b className="text-amber-700">{peso(sale.ar_balance)}</b></>}</div>
          <table className="w-full">
            <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2 text-right">Sold</th><th className="p-2 text-right">Already returned</th><th className="p-2 text-right">Price</th><th className="p-2 w-28">Return qty</th><th className="p-2 w-44">Condition</th></tr></thead>
            <tbody>{sale.lines.map((l) => {
              const left = Number(l.sold) - Number(l.returned);
              return (
                <tr key={l.sale_item_id} className="border-b">
                  <td className="p-2">{l.description}{l.item_type === 'service' && <span className="ml-1 text-xs text-slate-500">(service — no stock)</span>}{l.lot_code && <div className="text-xs text-slate-500">Lot {l.lot_code} — goes back into this lot</div>}</td>
                  <td className="p-2 text-right">{Number(l.sold)} {l.unit}</td><td className="p-2 text-right">{Number(l.returned) || '—'}</td><td className="p-2 text-right">{peso(l.unit_price)}</td>
                  <td className="p-2"><input className="input" type="number" min="0" max={left} step="any" disabled={left <= 0} placeholder={left > 0 ? `max ${left}` : 'none left'} value={qty[l.sale_item_id] ?? ''} onChange={(e) => setQty({ ...qty, [l.sale_item_id]: e.target.value })} /></td>
                  <td className="p-2">{l.item_type === 'service' ? <span className="text-xs text-slate-500">—</span> : (
                    <select className="input" value={cond[l.sale_item_id] ?? 'back_to_stock'} disabled={left <= 0} onChange={(e) => setCond({ ...cond, [l.sale_item_id]: e.target.value as ReturnCondition })}>
                      {Object.entries(CONDITION_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>)}
                    {sale.order_dr && !l.released && <div className="text-xs text-slate-500">Not yet released by the Warehouse</div>}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <input className="input" placeholder="Reason for the return *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-slate-500">Back to stock: resellable. Damaged: kept aside, not sellable (for supplier return). Wrong item: back to stock — for an exchange, refund here and ring up the right item as a new sale.</p>
          <div className="grid gap-2 rounded bg-slate-50 p-3 sm:grid-cols-3">
            <div>Returned value <b>{peso(value)}</b></div>
            <div>Off the unpaid balance <b>{peso(credit)}</b></div>
            <div>Refund to give <b className={refund > 0 ? 'text-amber-700' : ''}>{peso(refund)}</b></div>
          </div>
          {refund > 0 && (
            <div className="space-y-2">
              <div className="font-medium">How the refund is given</div>
              <div className="text-xs text-slate-600">Refund the way the customer paid (Build 70): {refundable.length
                ? refundable.map((m) => `${methodLabel(m.method)} up to ${peso(m.refundable)}`).join(' · ')
                : 'no payments recorded on this sale'}. Refunding more by a method than was paid by it needs an approver to process the return.</div>
              <PayRows pays={pays} setPays={setPays} fillLabel="Refund the way it was paid" fillAmount={refund} refund />
              <button type="button" className="button-secondary" onClick={() => {
                // spread the refund over the methods paid, in order, up to what each can still take
                let left = refund; const rows: Pay[] = [];
                for (const m of refundable) { if (left <= 0) break; const a = r2(Math.min(left, Number(m.refundable))); if (a > 0) { rows.push({ method: m.method, amount: String(a), reference: '' }); left = r2(left - a); } }
                if (left > 0) rows.push({ method: 'cash', amount: String(left), reference: '' });
                setPays(rows.length ? rows : [{ method: 'cash', amount: '', reference: '' }]);
              }}>Fill from the original payments</button>
              {entered !== refund && <p className="text-xs text-amber-700">The refund lines must add up to {peso(refund)} (now {peso(entered)}).</p>}
            </div>
          )}
        </>
      )}
      <ErrorBox text={error} />
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !sale || !(value > 0) || !reason.trim() || (refund > 0 && entered !== refund)} onClick={save}>{pending ? 'Saving…' : 'Record return'}</button></div>
    </div>
  );
}

export function ReturnsTab({ returns, payments }: { returns: any[]; payments: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Return</th><th className="p-2">Sale</th><th className="p-2">Customer</th><th className="p-2">Reason</th><th className="p-2 text-right">Value</th><th className="p-2 text-right">Off balance</th><th className="p-2">Refund</th></tr></thead>
        <tbody>
          {returns.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No returns on this date.</td></tr>}
          {returns.map((r) => (
            <tr key={r.id} className="border-b align-top">
              <td className="p-2 font-medium">{r.return_number}<div><a className="text-xs font-normal underline" href={`/sales/storefront/returns/${r.id}/slip`} target="_blank" rel="noreferrer">Return slip</a></div></td><td className="p-2">{r.sale?.sale_number}</td><td className="p-2">{r.sale?.customer?.legal_name}</td>
              <td className="p-2">{r.reason}{Number(r.damaged_cost) > 0 && <div className="text-xs text-amber-700">Damaged goods kept aside (cost {peso(r.damaged_cost)})</div>}</td><td className="p-2 text-right">{peso(r.total)}</td><td className="p-2 text-right">{Number(r.credit_to_ar) > 0 ? peso(r.credit_to_ar) : '—'}</td>
              <td className="p-2 text-xs">{payments.filter((p) => p.return_id === r.id).map((p) => `${methodLabel(p.method)} ${peso(p.amount)}${p.reference_number ? ` (${p.reference_number})` : ''}`).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- closing --
export function ClosingForm({ date, today, onDone }: { date: string; today: string; onDone: (msg: string) => void }) {
  const [day, setDay] = useState(date > today ? today : date);
  const [pv, setPv] = useState<Awaited<ReturnType<typeof closingPreviewAction>> | null>(null);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const variance = pv && Number.isFinite(num(counted)) ? r2(num(counted) - Number(pv.expected_cash)) : null;

  function load(d: string) {
    setDay(d); setPv(null); setError('');
    start(async () => { try { setPv(await closingPreviewAction(d)); } catch (e) { setError(errorText(e)); } });
  }
  // load the chosen day as soon as the pop-up opens
  useEffect(() => { load(day); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function save() {
    setError('');
    start(async () => {
      try {
        const r = await closeDayAction({ date: day, counted_cash: num(counted), notes });
        onDone(`${r.closing_number} submitted for approval${Number(r.variance) !== 0 ? ` — cash ${Number(r.variance) > 0 ? 'over' : 'short'} by ${peso(Math.abs(Number(r.variance)))}` : ' — cash matches'}.`);
      } catch (e) { setError(errorText(e)); }
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label>Day <input className="input w-auto" type="date" max={today} value={day} onChange={(e) => e.target.value && load(e.target.value)} /></label>
        <button type="button" className="button-secondary" disabled={pending || !day} onClick={() => load(day)}>{pending && !pv ? 'Loading…' : 'Refresh'}</button>
      </div>
      {pv && (
        <>
          {pv.already_closed && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-800">This day is already closed or waiting for approval.</div>}
          {pv.awaiting_approval > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-800">{pv.awaiting_approval} sale(s) are still awaiting approval or payment; they are not part of this closing until completed.</div>}
          <p className="text-xs text-slate-500">Includes everything up to this day that is not yet in a closing (so an unclosed earlier day is carried in).</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded border p-2">Sales <b>{peso(pv.sales_total)}</b><div className="text-xs text-slate-500">{pv.sales_count} completed</div></div>
            <div className="rounded border p-2">Charged to AR <b>{peso(pv.charged_to_ar)}</b></div>
            <div className="rounded border p-2">Returns <b>{peso(pv.returns_total)}</b></div>
            <div className="rounded border p-2">Old AR collected <b>{peso(pv.ar_collected)}</b></div>
          </div>
          <table className="w-full">
            <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Method</th><th className="p-2 text-right">Net received (after refunds)</th></tr></thead>
            <tbody>
              {Object.keys(pv.by_method).length === 0 && <tr><td colSpan={2} className="p-2 text-slate-500">No money received.</td></tr>}
              {METHODS.filter((m) => pv.by_method[m.v] !== undefined).map((m) => <tr key={m.v} className="border-b"><td className="p-2">{m.l}</td><td className="p-2 text-right">{peso(pv.by_method[m.v])}</td></tr>)}
            </tbody>
          </table>
          {pv.checks?.length > 0 && (
            <div className="rounded border p-2 text-xs">
              <div className="mb-1 font-medium text-sm">Checks received (not cash — held in Checks on hand)</div>
              {pv.checks.map((c) => <div key={c.payment} className="flex justify-between"><span>{c.number} · {c.bank} · dated {c.date}{c.pdc && <b className="ml-1 text-amber-700">post-dated — not yet depositable</b>}</span><span>{peso(c.amount)}</span></div>)}
            </div>
          )}
          <div className="rounded bg-slate-50 p-3 text-sm">
            {Number(pv.vat_total) !== 0 && <div className="mb-1">Output VAT (on SIs from a VAT-registered booklet, net of returns): <b>{peso(pv.vat_total)}</b></div>}
            Expected cash = opening float <b>{peso(pv.float_total)}</b> + net cash received <b>{peso(pv.by_method.cash ?? 0)}</b> − cash taken out <b>{peso(pv.cash_out_total)}</b>
            {pv.cash_movements.length > 0 && <div className="mt-1 text-xs text-slate-500">{pv.cash_movements.map((m) => `${m.number} ${m.kind === 'float' ? 'float' : CASH_OUT_LABEL[m.category ?? 'other']} ${peso(m.amount)}${m.note ? ` (${m.note})` : ''}`).join(' · ')}</div>}
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-3">
            <div>Expected cash in drawer<div className="text-lg font-semibold">{peso(pv.expected_cash)}</div></div>
            <label>Cash counted *<input className="input mt-1" type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
            <div>Variance<div className={`text-lg font-semibold ${variance === null ? '' : variance < 0 ? 'text-red-700' : variance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{variance === null ? '—' : pesoSigned(variance)}</div></div>
          </div>
          <input className="input" placeholder="Notes (explain any variance)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </>
      )}
      <ErrorBox text={error} />
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !pv || pv.already_closed || !Number.isFinite(num(counted))} onClick={save}>{pending ? 'Saving…' : 'Submit closing for approval'}</button></div>
    </div>
  );
}

function DecideClosing({ closing, onDone }: { closing: any; onDone: (msg: string) => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const go = (approve: boolean) => start(async () => {
    try { await decideClosingAction(closing.id, approve, note); onDone(`${closing.closing_number} ${approve ? 'approved' : 'returned for a recount'}.`); }
    catch (e) { setError(errorText(e)); }
  });
  return (
    <div className="space-y-3 text-sm">
      <ClosingSummary c={closing} />
      <input className="input" placeholder="Note (required when returning)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorBox text={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" disabled={pending} onClick={() => go(false)}>Return for recount</button>
        <button type="button" className="button" disabled={pending} onClick={() => go(true)}>Approve closing</button>
      </div>
    </div>
  );
}

function ClosingSummary({ c }: { c: any }) {
  const v = Number(c.variance);
  return (
    <div className="space-y-2 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <div>Sales <b>{peso(c.sales_total)}</b> ({c.sales_count})</div><div>Charged to AR <b>{peso(c.charged_to_ar)}</b></div><div>Returns <b>{peso(c.returns_total)}</b></div>
        <div>Old AR collected <b>{peso(c.ar_collected)}</b></div><div>Opening float <b>{peso(c.float_total)}</b></div><div>Cash taken out <b>{peso(c.cash_out_total)}</b></div>
        <div>Expected cash <b>{peso(c.expected_cash)}</b></div><div>Counted <b>{peso(c.counted_cash)}</b></div>
      </div>
      <div>By method: {METHODS.filter((m) => c.by_method?.[m.v] !== undefined).map((m) => `${m.l} ${peso(c.by_method[m.v])}`).join(' · ') || '—'}</div>
      <div>Variance <b className={v < 0 ? 'text-red-700' : v > 0 ? 'text-amber-700' : 'text-emerald-700'}>{pesoSigned(v)}</b>{c.notes && <span className="text-slate-500"> · {c.notes}</span>}</div>
      {Number(c.vat_total) !== 0 && <div>Output VAT <b>{peso(c.vat_total)}</b></div>}
      {c.journal_number && <div>Sent to Finance: journal <b>{c.journal_number}</b> ({String(c.journal_status).replaceAll('_', ' ')}) and one Bank/Cash entry per receiving account</div>}
      {c.decision_note && <div className="text-slate-500">Approver note: {c.decision_note}</div>}
    </div>
  );
}

export function ClosingsTab({ closings, canApprove, me, onMessage }: { closings: any[]; canApprove: boolean; me: string; onMessage: (m: string) => void }) {
  const badge = (s: string) => s === 'approved' ? 'bg-emerald-100 text-emerald-800' : s === 'returned' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Closing</th><th className="p-2">Day</th><th className="p-2 text-right">Sales</th><th className="p-2 text-right">Expected cash</th><th className="p-2 text-right">Counted</th><th className="p-2 text-right">Variance</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
        <tbody>
          {closings.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">No closings yet.</td></tr>}
          {closings.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="p-2 font-medium">{c.closing_number}</td><td className="p-2">{c.closing_date}</td><td className="p-2 text-right">{peso(c.sales_total)}</td>
              <td className="p-2 text-right">{peso(c.expected_cash)}</td><td className="p-2 text-right">{peso(c.counted_cash)}</td>
              <td className={`p-2 text-right ${Number(c.variance) < 0 ? 'text-red-700' : ''}`}>{pesoSigned(c.variance)}</td>
              <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs capitalize ${badge(c.status)}`}>{c.status === 'submitted' ? 'awaiting approval' : c.status}</span></td>
              <td className="p-2 whitespace-nowrap">
                {c.status === 'submitted' && canApprove && c.submitted_by === me && <span className="mr-2 text-xs text-slate-500">You submitted it — another approver reviews it</span>}
                {c.status === 'submitted' && canApprove && c.submitted_by !== me
                  ? <PopupAction label="Review" title={`Daily closing ${c.closing_number} · ${c.closing_date}`} wide>{(close) => <DecideClosing closing={c} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>
                  : <PopupAction label="View" title={`Daily closing ${c.closing_number} · ${c.closing_date}`} variant="secondary" wide><ClosingSummary c={c} /></PopupAction>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------- cash drawer --
export const CASH_OUT_LABEL: Record<string, string> = { bank_deposit: 'Bank deposit', petty_cash: 'Petty cash', other: 'Other' };
export function CashDrawerForm({ entries, onDone }: { entries: any[]; onDone: (msg: string) => void }) {
  const [kind, setKind] = useState<'float' | 'cash_out'>('float');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<'bank_deposit' | 'petty_cash' | 'other'>('bank_deposit');
  const [note, setNote] = useState('');
  const [bank, setBank] = useState('');
  const banks = useStoreAccounts().filter((a) => a.method === 'bank_transfer');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">Record the change fund put in the drawer at opening, and any cash taken out during the day. Both are counted in the daily closing's expected cash.</p>
      <div className="flex gap-2">
        <button type="button" className={kind === 'float' ? 'button' : 'button-secondary'} onClick={() => setKind('float')}>Opening float</button>
        <button type="button" className={kind === 'cash_out' ? 'button' : 'button-secondary'} onClick={() => setKind('cash_out')}>Cash taken out</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">Amount *<input className="input mt-1" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        {kind === 'cash_out' && <label className="block">For *<select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {Object.entries(CASH_OUT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
        <label className={`block ${kind === 'cash_out' ? '' : 'sm:col-span-2'}`}>{kind === 'cash_out' ? (category === 'other' ? 'Explanation *' : 'Note (deposit slip no., etc.)') : 'Note'}
          <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {kind === 'cash_out' && category === 'bank_deposit' && banks.length > 1 && (
          <label className="block sm:col-span-3">Deposited to *<select className="input mt-1" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">Choose the bank account</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}{b.number ? ` · ${b.number}` : ''}</option>)}</select></label>
        )}
        {kind === 'cash_out' && category === 'bank_deposit' && banks.length === 0 && <p className="text-xs text-amber-700 sm:col-span-3">Set up the store's bank account first (Store settings → Receiving accounts, "Bank transfer").</p>}
      </div>
      {entries.length > 0 && (
        <div><div className="mb-1 font-medium">Today</div>
          {entries.map((m) => <div key={m.id} className="flex justify-between border-b py-1"><span>{m.movement_number} · {m.kind === 'float' ? 'Opening float' : `Cash out — ${CASH_OUT_LABEL[m.category] ?? m.category}`}{m.note ? ` · ${m.note}` : ''}</span><span className={m.kind === 'cash_out' ? 'text-red-700' : ''}>{m.kind === 'cash_out' ? `−${peso(m.amount)}` : peso(m.amount)}</span></div>)}
        </div>
      )}
      <ErrorBox text={error} />
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !(num(amount) > 0)} onClick={() => start(async () => {
        setError('');
        try {
          const r = await cashMovementAction({ kind, amount: num(amount), category: kind === 'cash_out' ? category : null, note, bank_account: kind === 'cash_out' && category === 'bank_deposit' && bank ? bank : null });
          onDone(`${r.movement_number}: ${kind === 'float' ? 'opening float' : 'cash taken out'} ${peso(num(amount))} recorded.`);
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Record'}</button></div>
    </div>
  );
}
