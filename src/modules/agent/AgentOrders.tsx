'use client';
// Build 91 — the agent's orders: per client, with status; edit / send drafts, cancel.
import Link from 'next/link';
import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { orderStatusAction } from './agentActions';
import { Pill, peso, qty } from './AgentHeader';

export function AgentOrders({ businessId, orders }: { businessId: string; orders: any[] }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [client, setClient] = useState('');
  const [pending, start] = useTransition();
  const act = (o: any, s: 'sent' | 'cancelled') => start(async () => {
    try { await orderStatusAction(o.id, s); setMessage(`${o.order_number} ${s === 'sent' ? 'sent to the store' : 'cancelled'}.`); router.refresh(); } catch (e) { setMessage(errorText(e)); }
  });
  const clients = Array.from(new Set(orders.map((o) => o.customer))).sort();
  const shown = orders.filter((o) => (!status || o.status === status) && (!client || o.customer === client));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <Link className="button" href={`/agent/catalog?b=${businessId}`}>+ New order</Link>
        <select className="input" value={client} onChange={(e) => setClient(e.target.value)}><option value="">All clients</option>{clients.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['draft', 'sent', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Order</th><th className="p-2">Client</th><th className="p-2">Status</th><th className="p-2 text-right">Total</th><th className="p-2"></th></tr></thead>
          <tbody>
            {shown.map((o) => (
              <Fragment key={o.id}>
                <tr className="border-t align-top">
                  <td className="p-2"><button type="button" className="font-mono text-xs text-blue-700 underline" onClick={() => setOpen(open === o.id ? null : o.id)}>{o.order_number}</button>
                    <div className="text-xs text-slate-500">{new Date(o.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</div></td>
                  <td className="p-2">{o.customer}<div className="text-xs text-slate-500">{o.customer_code}</div></td>
                  <td className="p-2"><Pill status={o.status} />{o.sale_number && <div className="text-xs text-slate-500">Sale {o.sale_number}</div>}
                    {o.store_note && o.status === 'draft' && <div className="mt-1 max-w-xs text-xs text-amber-700">Returned: {o.store_note}</div>}</td>
                  <td className="p-2 text-right">{peso(o.total)}</td>
                  <td className="p-2"><div className="flex flex-wrap gap-2 text-xs">
                    {o.status === 'draft' && <><Link className="text-blue-700 underline" href={`/agent/catalog?b=${businessId}&order=${o.id}`}>Edit</Link>
                      <button type="button" className="text-blue-700 underline" disabled={pending} onClick={() => act(o, 'sent')}>Send to store</button></>}
                    {(o.status === 'draft' || o.status === 'sent') && <button type="button" className="text-red-700 underline" disabled={pending} onClick={() => act(o, 'cancelled')}>Cancel</button>}
                  </div></td>
                </tr>
                {open === o.id && (
                  <tr className="border-t bg-slate-50"><td colSpan={5} className="p-2">
                    <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="p-1">Item</th><th className="p-1 text-right">Qty</th><th className="p-1">Price</th><th className="p-1 text-right">Unit</th><th className="p-1 text-right">Amount</th></tr></thead>
                      <tbody>{(o.lines ?? []).map((l: any, i: number) => <tr key={i} className="border-t"><td className="p-1">{l.item_code} · {l.item_name}</td><td className="p-1 text-right">{qty(l.quantity)} {l.unit}</td>
                        <td className="p-1">{l.tier ? `Tier ${l.tier}` : Number(l.unit_price) < Number(l.list_price) ? 'Client / own price' : 'Store price'}</td><td className="p-1 text-right">{peso(l.unit_price)}</td><td className="p-1 text-right">{peso(l.line_total)}</td></tr>)}</tbody></table>
                    {o.notes && <div className="mt-1 text-xs text-slate-600">Notes: {o.notes}</div>}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!shown.length && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
