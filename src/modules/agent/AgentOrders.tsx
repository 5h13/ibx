'use client';
// Build 91 / 95 — the agent's orders as cards (phone first): status, edit / send drafts, cancel; tap for the lines.
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { orderStatusAction } from './agentActions';
import { Pill, peso, qty } from './AgentHeader';

const LABEL: Record<string, string> = { converted: 'sales order' };

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
      <div className="grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-end">
        <Link className="button col-span-2 text-center" href={`/agent/catalog?b=${businessId}`}>+ New order</Link>
        <select className="input sm:w-56" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client"><option value="">All clients</option>{clients.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>{['draft', 'sent', 'completed', 'converted', 'cancelled'].map((s) => <option key={s} value={s}>{LABEL[s] ?? s}</option>)}
        </select>
      </div>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((o) => (
          <div key={o.id} className="rounded-xl border bg-white">
            <button type="button" className="block w-full p-3 text-left" onClick={() => setOpen(open === o.id ? null : o.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium leading-snug">{o.customer}</div>
                  <div className="font-mono text-[11px] text-slate-500">{o.order_number} · {new Date(o.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                </div>
                <div className="flex-none text-right"><div className="font-semibold">{peso(o.total)}</div><Pill status={o.status === 'converted' ? 'approved' : o.status} label={LABEL[o.status]} /></div>
              </div>
              {o.sale_number && <div className="mt-1 text-xs text-slate-500">Sale {o.sale_number}</div>}
              {o.sales_order_number && <div className="mt-1 text-xs text-slate-500">Sales order {o.sales_order_number} ({o.sales_order_status}) — items ordered from the supplier</div>}
              {o.store_note && o.status === 'draft' && <div className="mt-1 text-xs text-amber-700">Returned: {o.store_note}</div>}
            </button>
            {open === o.id && (
              <div className="space-y-1 border-t bg-slate-50 p-3 text-xs">
                {(o.lines ?? []).map((l: any, i: number) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="min-w-0">{l.item_name}<span className="text-slate-500"> · {qty(l.quantity)} {l.unit} × {peso(l.unit_price)}{l.tier ? ` (Tier ${l.tier})` : ''}</span></span>
                    <span className="flex-none font-medium">{peso(l.line_total)}</span>
                  </div>
                ))}
                {o.notes && <div className="pt-1 text-slate-600">Notes: {o.notes}</div>}
              </div>
            )}
            {(o.status === 'draft' || o.status === 'sent') && (
              <div className="flex gap-2 border-t p-2 text-xs">
                {o.status === 'draft' && <>
                  <Link className="button-secondary flex-1 text-center" href={`/agent/catalog?b=${businessId}&order=${o.id}`}>Edit</Link>
                  <button type="button" className="button flex-1" disabled={pending} onClick={() => act(o, 'sent')}>Send to store</button></>}
                <button type="button" className="button-secondary flex-1 text-red-700" disabled={pending} onClick={() => act(o, 'cancelled')}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!shown.length && <div className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">No orders in this store yet.</div>}
    </div>
  );
}
