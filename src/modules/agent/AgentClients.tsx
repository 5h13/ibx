'use client';
// Build 91 — the agent's clients in one store: usual price tier, open balance,
// and links to the catalogue / order, payment report and statement.
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { addClientAction, setClientTierAction } from './agentActions';
import { peso } from './AgentHeader';

export type AgentClient = { customer_id: string; business_id: string; store: string; customer_code: string; legal_name: string; phone: string | null; address: string | null;
  price_tier: number; open_balance: number; overdue: number; last_sale: string | null };

export const tierLabel = (t: number, tiers: number[]) => (t <= 1 ? 'Tier 1 · store price' : `Tier ${t} · −${Number(tiers[t - 1].toFixed(2))}% of markup`);

function AddClient({ businessId, onDone }: { businessId: string; onDone: (m: string) => void }) {
  const [f, setF] = useState({ name: '', phone: '', address: '', tax_id: '' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const box = (k: keyof typeof f, label: string) => <label className="block text-sm"><span className="mb-1 block text-slate-600">{label}</span><input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">{box('name', 'Client / company name *')}{box('phone', 'Phone')}{box('address', 'Address')}{box('tax_id', 'TIN')}</div>
      <p className="text-xs text-slate-500">The client is added to this store and assigned to you.</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.name.trim()} onClick={() => start(async () => {
        setError('');
        try { await addClientAction({ business_id: businessId, ...f }); onDone(`${f.name} added.`); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Add client'}</button>
    </div>
  );
}

export function AgentClients({ businessId, clients, tiers }: { businessId: string; clients: AgentClient[]; tiers: number[] }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  const shown = clients.filter((c) => !q.trim() || `${c.legal_name} ${c.customer_code} ${c.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const setTier = (c: AgentClient, t: number) => start(async () => {
    try { await setClientTierAction(c.customer_id, t); setMessage(`${c.legal_name}: ${tierLabel(t, tiers)}.`); router.refresh(); } catch (e) { setMessage(errorText(e)); }
  });
  const total = clients.reduce((s, c) => s + Number(c.open_balance), 0);
  const overdue = clients.reduce((s, c) => s + Number(c.overdue), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Clients</div><div className="text-lg font-semibold">{clients.length}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Open balance</div><div className="text-lg font-semibold">{peso(total)}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Overdue</div><div className={`text-lg font-semibold ${overdue > 0 ? 'text-red-700' : ''}`}>{peso(overdue)}</div></div>
      </div>
      <ActionBar>
        <PopupAction label="+ New client" title="New client" notice={message}>{(close) => <AddClient businessId={businessId} onDone={(m) => { setMessage(m); close(); router.refresh(); }} />}</PopupAction>
        <input className="input min-w-0 flex-1 sm:w-64 sm:flex-none" type="search" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
      </ActionBar>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((c) => (
          <div key={c.customer_id} className="space-y-2 rounded-xl border bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium leading-snug">{c.legal_name}</div>
                <div className="text-xs text-slate-500">{c.customer_code}{c.phone ? <> · <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a></> : ''}</div>
                {c.address && <div className="truncate text-xs text-slate-500">{c.address}</div>}
              </div>
              <div className="flex-none text-right">
                <div className="text-sm font-semibold">{peso(c.open_balance)}</div>
                <div className={`text-[11px] ${Number(c.overdue) > 0 ? 'font-medium text-red-700' : 'text-slate-500'}`}>{Number(c.overdue) > 0 ? `${peso(c.overdue)} overdue` : 'open balance'}</div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">Usual price
              <select className="input flex-1 text-xs" value={c.price_tier} disabled={pending} onChange={(e) => setTier(c, Number(e.target.value))}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>{tierLabel(t, tiers)}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Link className="button px-1" href={`/agent/catalog?b=${businessId}&c=${c.customer_id}`}>Order</Link>
              <Link className="button-secondary px-1" href={`/agent/payments?b=${businessId}&c=${c.customer_id}&new=pay`}>Payment</Link>
              <Link className="button-secondary px-1" href={`/finance/accounts-receivable/statement/${c.customer_id}`} target="_blank">Statement</Link>
            </div>
            {c.last_sale && <div className="text-[11px] text-slate-500">Last sale {c.last_sale}</div>}
          </div>
        ))}
      </div>
      {!shown.length && <div className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">{clients.length ? 'No client matches.' : 'No clients assigned to you in this store yet. Add one, or ask the store to assign existing customers to you.'}</div>}
    </div>
  );
}
