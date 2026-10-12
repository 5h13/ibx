'use client';
// Build 91 — Storefront tabs for agents' work:
//   Agent orders   — orders sent by agents: make the sale (customer, items and
//                    the agent's prices filled in) or return it to the agent.
//   Agent payments — payments agents report per DR / SI: confirm when the money
//                    or check is handed in (posted like a counter AR payment,
//                    into the day's closing) or reject with a reason.
import { Fragment, useState, useTransition, type ReactNode } from 'react';
import { errorText } from '@/core/errors/appError';
import { PopupAction } from '@/core/ui/PopupAction';
import { agentOrderReturnAction, agentOrderToSalesOrderAction, agentReportPhotoAction, confirmAgentPaymentAction, rejectAgentPaymentAction } from './actions';
import { PayRow } from './PayRow';
import { methodLabel, paysToInput, peso, type Pay } from './storefrontShared';

const qty = (v: unknown) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

function NoteForm({ label, placeholder, onSubmit }: { label: string; placeholder: string; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 text-sm">
      <textarea className="input" rows={3} placeholder={placeholder} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !note.trim()} onClick={() => start(async () => { setError(''); try { await onSubmit(note.trim()); } catch (e) { setError(errorText(e)); } })}>{pending ? 'Saving…' : label}</button>
    </div>
  );
}

// Build 95 — an agent order the store cannot fill from stock becomes a sales order: each line from stock or
// "order from supplier". The Sales approver approves it; the supplier lines then go to Procurement as a PR → PO.
function ToSalesOrderForm({ o, onDone }: { o: any; onDone: (m: string) => void }) {
  const lines: any[] = o.lines ?? [];
  const [pick, setPick] = useState<Record<string, 'stock' | 'source'>>(() =>
    Object.fromEntries(lines.filter((l) => l.item_type !== 'service').map((l) => [l.item_id, Number(l.available ?? 0) >= Number(l.quantity) ? 'stock' : 'source'])));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const toSource = Object.values(pick).filter((v) => v === 'source').length;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Makes a sales order for <b>{o.customer}</b> with the agent&apos;s prices. Lines marked <b>Order from supplier</b> go to Procurement as a purchase request (then a P.O.) as soon as the Sales approver approves the sales order.</p>
      <div className="divide-y rounded border">
        {lines.map((l) => (
          <div key={l.item_id} className="flex flex-wrap items-center gap-2 p-2">
            <div className="min-w-0 flex-1"><div className="font-medium">{l.item_name}</div>
              <div className="text-xs text-slate-500">{l.item_code} · {qty(l.quantity)} {l.unit} × {peso(l.unit_price)}{l.item_type !== 'service' && <> · <span className={Number(l.available ?? 0) >= Number(l.quantity) ? 'text-emerald-700' : 'text-red-700'}>{qty(l.available)} available</span></>}</div></div>
            {l.item_type === 'service' ? <span className="text-xs text-slate-500">service</span> : (
              <select className="input w-48" value={pick[l.item_id]} onChange={(e) => setPick({ ...pick, [l.item_id]: e.target.value as 'stock' | 'source' })}>
                <option value="stock">From stock</option><option value="source">Order from supplier</option>
              </select>
            )}
          </div>
        ))}
      </div>
      <input className="input" placeholder="Note (optional, e.g. client agreed to wait 2 weeks)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending} onClick={() => start(async () => {
        setError('');
        try {
          const r = await agentOrderToSalesOrderAction(o.id, Object.entries(pick).map(([item_id, fulfilment]) => ({ item_id, fulfilment })), note);
          onDone(`${o.order_number} → sales order ${r.order_number}${r.lines_to_source ? ` (${r.lines_to_source} line(s) to order from the supplier once approved)` : ''}. Waiting for the Sales approver.`);
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : `Make sales order${toSource ? ` · ${toSource} to order` : ''}`}</button>
    </div>
  );
}

export function AgentOrdersTab({ orders, canSell, onMessage, renderSale }: { orders: any[]; canSell: boolean; onMessage: (m: string) => void; renderSale: (order: any, close: () => void) => ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const sent = orders.filter((o) => o.status === 'sent');
  const done = orders.filter((o) => o.status === 'completed' || o.status === 'converted');
  return (
    <section className="space-y-3 rounded-xl border bg-white p-3 sm:p-4">
      <p className="text-sm text-slate-500">Orders agents took for their clients. <b>Make the sale</b> opens a new counter sale with the client, items and the agent&apos;s prices filled in (change quantities or lots as needed); the order is marked done when the sale is saved. No stock? <b>Sales order / P.O.</b> turns it into a sales order whose short lines are ordered from the supplier. Return an order to the agent if it cannot be filled.</p>
      {!canSell && <p className="text-sm text-amber-700">Set the store&apos;s stock location first (Store settings).</p>}
      <table className="m-cards w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Order</th><th className="p-2">Agent</th><th className="p-2">Client</th><th className="p-2 text-right">Total</th><th className="p-2"></th></tr></thead>
        <tbody>
          {sent.map((o) => (
            <Fragment key={o.id}>
              <tr className="border-t align-top">
                <td className="p-2"><button type="button" className="font-mono text-xs text-blue-700 underline" onClick={() => setOpen(open === o.id ? null : o.id)}>{o.order_number}</button>
                  <div className="text-xs text-slate-500">sent {new Date(o.sent_at ?? o.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</div></td>
                <td className="p-2">{o.agent}<div className="text-xs text-slate-500">{o.agent_code}</div></td>
                <td className="p-2">{o.customer}<div className="text-xs text-slate-500">{(o.lines ?? []).length} item(s){o.notes ? ` · ${o.notes}` : ''}</div>
                  {(o.lines ?? []).some((l: any) => l.item_type !== 'service' && Number(l.available ?? 0) < Number(l.quantity)) && <div className="text-xs font-medium text-red-700">Short of stock</div>}</td>
                <td className="p-2 text-right">{peso(o.total)}</td>
                <td className="p-2"><div className="flex flex-wrap gap-2">
                  <PopupAction label="Make the sale" title={`Sale for agent order ${o.order_number}`} wide disabled={!canSell}>{(close) => renderSale(o, close)}</PopupAction>
                  <PopupAction label={(o.lines ?? []).some((l: any) => l.item_type !== 'service' && Number(l.available ?? 0) < Number(l.quantity)) ? 'No stock → sales order / P.O.' : 'Sales order / P.O.'}
                    title={`Sales order for agent order ${o.order_number}`} wide variant="secondary">
                    {(close) => <ToSalesOrderForm o={o} onDone={(m) => { onMessage(m); close(); }} />}
                  </PopupAction>
                  <PopupAction label="Return to agent" title={`Return ${o.order_number} to ${o.agent}`} variant="secondary">
                    {(close) => <NoteForm label="Return to agent" placeholder="Why (e.g. out of stock, wrong item)" onSubmit={async (n) => { await agentOrderReturnAction(o.id, n); onMessage(`${o.order_number} returned to ${o.agent}.`); close(); }} />}
                  </PopupAction>
                </div></td>
              </tr>
              {open === o.id && (
                <tr className="border-t bg-slate-50"><td colSpan={5} className="p-2">
                  <table className="w-full text-xs"><tbody>{(o.lines ?? []).map((l: any, i: number) => (
                    <tr key={i} className="border-t"><td className="p-1">{l.item_code} · {l.item_name}</td><td className="p-1 text-right">{qty(l.quantity)} {l.unit}{l.item_type !== 'service' && <div className={Number(l.available ?? 0) >= Number(l.quantity) ? 'text-emerald-700' : 'text-red-700'}>{qty(l.available)} available</div>}</td>
                      <td className="p-1">{l.tier ? `Tier ${l.tier}` : 'agent price'}</td><td className="p-1 text-right">{peso(l.unit_price)}{Number(l.unit_price) < Number(l.list_price) && <span className="text-slate-500"> (store {peso(l.list_price)})</span>}</td>
                      <td className="p-1 text-right">{peso(l.line_total)}</td></tr>))}</tbody></table>
                </td></tr>
              )}
            </Fragment>
          ))}
          {!sent.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">No agent orders waiting.</td></tr>}
        </tbody>
      </table>
      {done.length > 0 && <div className="text-xs text-slate-500">Done this week: {done.map((o) => `${o.order_number} → ${o.status === 'converted' ? `sales order ${o.sales_order_number ?? ''}` : o.sale_number ?? 'sale'}`).join(' · ')}</div>}
    </section>
  );
}

function ConfirmForm({ r, onDone }: { r: any; onDone: (m: string) => void }) {
  const [p, setP] = useState<Pay>({ method: r.method, amount: String(r.amount), reference: r.reference ?? '', check_bank: r.details?.check_bank ?? '', check_date: r.details?.check_date ?? '', issuer: r.details?.issuer ?? '' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p>{r.agent} reports <b>{peso(r.amount)}</b> from <b>{r.customer}</b> ({methodLabel(r.method)}, paid {r.paid_on}) for:</p>
      <ul className="list-disc pl-5 text-xs">{(r.allocations ?? []).map((a: any, i: number) => <li key={i}>{a.dr_numbers || a.invoice_number}{a.si_number ? ` · SI ${a.si_number}` : ''}: {peso(a.amount)}</li>)}</ul>
      <p className="text-xs text-slate-500">Confirm only when you have the cash, check or the transfer in the account. Correct the method / reference to what you received; the amount is the agent&apos;s report.</p>
      <PayRow p={{ ...p, amount: String(r.amount) }} set={(patch) => setP({ ...p, ...patch, amount: String(r.amount) })} remove={() => undefined} />
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending} onClick={() => start(async () => {
        setError('');
        try { const [pay] = paysToInput([{ ...p, amount: String(r.amount) }]); const res = await confirmAgentPaymentAction(r.id, pay); onDone(`${res.report_number}: ${peso(res.amount)} received and posted on ${res.parts} DR / invoice(s).`); }
        catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Posting…' : 'Confirm received'}</button>
    </div>
  );
}

export function AgentPaymentsTab({ reports, onMessage }: { reports: any[]; onMessage: (m: string) => void }) {
  const [pending, start] = useTransition();
  const photo = (id: string) => start(async () => { try { window.open(await agentReportPhotoAction(id), '_blank'); } catch (e) { onMessage(errorText(e)); } });
  const waiting = reports.filter((r) => r.status === 'pending');
  const decided = reports.filter((r) => r.status !== 'pending');
  return (
    <section className="space-y-3 rounded-xl border bg-white p-3 sm:p-4">
      <p className="text-sm text-slate-500">Payments agents collected from their clients, per DR / SI. Confirm when the money is handed in — it posts like a counter AR payment and goes into today&apos;s closing.</p>
      <table className="m-cards w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Report</th><th className="p-2">Agent / client</th><th className="p-2">DRs</th><th className="p-2">How</th><th className="p-2 text-right">Amount</th><th className="p-2"></th></tr></thead>
        <tbody>
          {waiting.map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="p-2 font-mono text-xs">{r.report_number}<div className="font-sans text-slate-500">paid {r.paid_on}</div></td>
              <td className="p-2">{r.agent}<div className="text-xs text-slate-500">{r.customer}</div></td>
              <td className="p-2 text-xs">{(r.allocations ?? []).map((a: any, i: number) => <div key={i}>{a.dr_numbers || a.invoice_number}: {peso(a.amount)}</div>)}</td>
              <td className="p-2 text-xs">{methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ''}{r.notes && <div className="text-slate-500">{r.notes}</div>}</td>
              <td className="p-2 text-right font-medium">{peso(r.amount)}</td>
              <td className="p-2"><div className="flex flex-wrap gap-2">
                <PopupAction label="Confirm" title={`Confirm ${r.report_number}`} wide>{(close) => <ConfirmForm r={r} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>
                <PopupAction label="Reject" title={`Reject ${r.report_number}`} variant="secondary">
                  {(close) => <NoteForm label="Reject" placeholder="Why (e.g. not received, wrong amount)" onSubmit={async (n) => { await rejectAgentPaymentAction(r.id, n); onMessage(`${r.report_number} rejected.`); close(); }} />}
                </PopupAction>
                {r.photo_path && <button type="button" className="button-secondary" disabled={pending} onClick={() => photo(r.id)}>Photo</button>}
              </div></td>
            </tr>
          ))}
          {!waiting.length && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No agent payments waiting.</td></tr>}
        </tbody>
      </table>
      {decided.length > 0 && <div className="text-xs text-slate-500">Last 7 days: {decided.map((r) => `${r.report_number} ${r.status}`).join(' · ')}</div>}
    </section>
  );
}
