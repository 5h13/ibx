'use client';
// Build 96 — the store's clients with their agent. Sales approver / Business Admin: move one or many
// clients to another agent (with a note); both agents get a notice in the agent app.
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { moveClientsAction, saveClientAction, type ClientInput } from './clientActions';

type Client = { id: string; store: string; customer_code: string; legal_name: string; trade_name: string | null; contact_person: string | null; phone: string | null;
  email: string | null; address: string | null; tax_id: string | null; payment_terms: string | null; credit_limit: number | null; notes: string | null; price_tier: number | null;
  active: boolean; agent_id: string | null; agent: string | null; agent_code: string | null; agent_kind: string | null; agent_has_login: boolean;
  open_balance: number; overdue: number; last_sale: string | null };
type Agent = { id: string; name: string; agent_code: string; kind: string; has_login: boolean };
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const agentLabel = (a: Agent) => (a.kind === 'store' ? `${a.name} (walk-ins)` : `${a.name}${a.has_login ? '' : ' · no app login'}`);

function ClientForm({ client, agents, canMove, canFinance, onDone }: { client?: Client; agents: Agent[]; canMove: boolean; canFinance: boolean; onDone: (m: string) => void }) {
  const [f, setF] = useState<ClientInput>({
    legal_name: client?.legal_name ?? '', trade_name: client?.trade_name ?? '', contact_person: client?.contact_person ?? '', phone: client?.phone ?? '', email: client?.email ?? '',
    address: client?.address ?? '', tax_id: client?.tax_id ?? '', payment_terms: client?.payment_terms ?? '', credit_limit: client?.credit_limit != null ? String(client.credit_limit) : '',
    notes: client?.notes ?? '', price_tier: client?.price_tier ?? 1, agent_id: client?.agent_id ?? '', move_note: '', active: client?.active ?? true,
  });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const box = (k: keyof ClientInput, label: string, type = 'text') => (
    <label className="block text-sm"><span className="mb-1 block text-slate-600">{label}</span>
      <input className="input" type={type} value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  const moving = !!client && canMove && f.agent_id !== (client.agent_id ?? '');
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {box('legal_name', 'Client / company name *')}{box('trade_name', 'Trade name')}{box('contact_person', 'Contact person')}{box('phone', 'Phone')}
        {box('email', 'Email', 'email')}{box('tax_id', 'TIN')}{box('address', 'Address')}{box('payment_terms', 'Payment terms')}
        {canFinance && box('credit_limit', 'Credit limit', 'number')}
        <label className="block text-sm"><span className="mb-1 block text-slate-600">Usual price tier</span>
          <select className="input" value={f.price_tier} onChange={(e) => setF({ ...f, price_tier: Number(e.target.value) })}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}{t === 1 ? ' (store price)' : ''}</option>)}</select></label>
      </div>
      {box('notes', 'Notes')}
      {canMove ? (
        <div className="space-y-2 rounded border p-3 text-sm">
          <label className="block"><span className="mb-1 block text-slate-600">Agent</span>
            <select className="input" value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })}>
              {!client && <option value="">The store (walk-ins)</option>}
              {agents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}</option>)}
            </select></label>
          {moving && <input className="input" placeholder="Note to both agents (optional)" value={f.move_note} onChange={(e) => setF({ ...f, move_note: e.target.value })} />}
          {moving && <p className="text-xs text-slate-500">Both agents get a notice in the agent app. Past sales keep the agent they were made under.</p>}
        </div>
      ) : <p className="text-xs text-slate-500">Agent: {client?.agent ?? 'the store'}. Only the Sales approver or the Business Admin can move a client to another agent.</p>}
      {client && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.legal_name.trim()} onClick={() => start(async () => {
        setError('');
        try {
          const input = { ...f, agent_id: canMove ? f.agent_id : '' };
          await saveClientAction(client?.id ?? null, input);
          onDone(client ? `${f.legal_name} saved${moving ? ' and moved — both agents notified' : ''}.` : `${f.legal_name} added.`);
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

function MoveForm({ ids, clients, agents, onDone }: { ids: string[]; clients: Client[]; agents: Agent[]; onDone: (m: string) => void }) {
  const [agent, setAgent] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const chosen = clients.filter((c) => ids.includes(c.id));
  const from = Array.from(new Set(chosen.map((c) => c.agent ?? '—')));
  return (
    <div className="space-y-3 text-sm">
      <p>Move <b>{chosen.length}</b> client(s) from {from.join(', ')} to:</p>
      <select className="input" value={agent} onChange={(e) => setAgent(e.target.value)}>
        <option value="">Choose the agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}</option>)}
      </select>
      <input className="input" placeholder="Note to the agents (optional, e.g. covers the San Pedro area now)" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="text-xs text-slate-500">The agents they move from and the agent they move to each get a notice in the agent app. Past sales and commission stay with the agent they were made under; new sales go to the new agent.</p>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !agent} onClick={() => start(async () => {
        setError('');
        try { const n = await moveClientsAction(ids, agent, note); onDone(`${n} client(s) moved to ${agents.find((a) => a.id === agent)?.name}. Both agents notified.`); }
        catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Moving…' : 'Move'}</button>
    </div>
  );
}

export function ClientsList({ clients, agents, canMove, canFinance, hasStore, initialAgent }: {
  clients: Client[]; agents: Agent[]; canMove: boolean; canFinance: boolean; hasStore: boolean; initialAgent: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState(initialAgent);
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [store, setStore] = useState('');
  const stores = useMemo(() => Array.from(new Set(clients.map((c) => c.store))).sort(), [clients]);
  const [sel, setSel] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const done = (m: string) => { setMessage(m); setSel([]); router.refresh(); };
  const shown = useMemo(() => clients.filter((c) => (status === 'all' || (status === 'active') === c.active) && (!store || c.store === store) && (!agent || c.agent_id === agent)
    && (!q.trim() || `${c.legal_name} ${c.trade_name ?? ''} ${c.customer_code} ${c.phone ?? ''} ${c.agent ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [clients, q, agent, status, store]);
  // filter choices: every active agent, plus any (inactive) agent still holding clients
  const listAgents = useMemo(() => {
    const extra: Agent[] = [];
    for (const c of clients) if (c.agent_id && !agents.some((a) => a.id === c.agent_id) && !extra.some((x) => x.id === c.agent_id))
      extra.push({ id: c.agent_id, name: c.agent ?? '—', agent_code: c.agent_code ?? '', kind: c.agent_kind ?? 'freelance', has_login: c.agent_has_login });
    return [...agents, ...extra];
  }, [clients, agents]);
  const tot = shown.reduce((s, c) => s + Number(c.open_balance), 0);
  const od = shown.reduce((s, c) => s + Number(c.overdue), 0);
  const allSel = shown.length > 0 && shown.every((c) => sel.includes(c.id));
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Clients</h2>
        <p className="mt-1 text-sm text-slate-500">Every client has one agent; sales, quotations and orders take the client&apos;s agent. {canMove ? 'Tick clients and use “Move to agent” to reassign them — both agents are notified.' : 'Only the Sales approver or the Business Admin can move a client to another agent.'}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Clients</div><div className="text-lg font-semibold">{shown.length}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Open balance</div><div className="text-lg font-semibold">{peso(tot)}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Overdue</div><div className={`text-lg font-semibold ${od > 0 ? 'text-red-700' : ''}`}>{peso(od)}</div></div>
      </div>
      <ActionBar>
        {hasStore && <PopupAction label="+ New client" title="New client" wide notice={message}>{(close) => <ClientForm agents={agents} canMove={canMove} canFinance={canFinance} onDone={(m) => { done(m); close(); }} />}</PopupAction>}
        {canMove && <PopupAction label={`Move to agent${sel.length ? ` (${sel.length})` : ''}`} title="Move clients to another agent" variant="secondary" disabled={!sel.length} notice={message}>
          {(close) => <MoveForm ids={sel} clients={clients} agents={agents} onDone={(m) => { done(m); close(); }} />}</PopupAction>}
        <input className="input w-56" type="search" placeholder="Search client, code, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-56" value={agent} onChange={(e) => { setAgent(e.target.value); setSel([]); }} aria-label="Agent">
          <option value="">All agents</option>{listAgents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}</option>)}
        </select>
        {stores.length > 1 && <select className="input w-40" value={store} onChange={(e) => { setStore(e.target.value); setSel([]); }} aria-label="Store"><option value="">All stores</option>{stores.map((x) => <option key={x} value={x}>{x}</option>)}</select>}
        <select className="input w-36" value={status} onChange={(e) => { setStatus(e.target.value as 'active' | 'inactive' | 'all'); setSel([]); }} aria-label="Status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
      </ActionBar>
      {!hasStore && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">Showing every store. Choose a store (“Acting as”) to add clients or move them between agents.</p>}
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {canMove && <th className="w-8 p-2"><input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? shown.map((c) => c.id) : [])} aria-label="Select all" /></th>}
              <th className="p-2">Client</th><th className="p-2">Agent</th><th className="p-2">Tier</th><th className="p-2 text-right">Open balance</th><th className="p-2 text-right">Overdue</th><th className="p-2">Last sale</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={`border-t align-top ${c.active ? '' : 'opacity-60'}`}>
                {canMove && <td className="p-2"><input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} aria-label={`Select ${c.legal_name}`} /></td>}
                <td className="p-2"><div className="font-medium">{c.legal_name}{!c.active && ' (inactive)'}</div>
                  <div className="text-xs text-slate-500">{c.customer_code}{!hasStore ? ` · ${c.store}` : ''}{c.phone ? ` · ${c.phone}` : ''}{c.contact_person ? ` · ${c.contact_person}` : ''}</div></td>
                <td className="p-2">{c.agent_kind === 'store' ? <span className="text-slate-500">Store (walk-ins)</span> : c.agent}</td>
                <td className="p-2">{c.price_tier ?? 1}</td>
                <td className="p-2 text-right">{peso(c.open_balance)}</td>
                <td className={`p-2 text-right ${Number(c.overdue) > 0 ? 'font-medium text-red-700' : ''}`}>{peso(c.overdue)}</td>
                <td className="p-2 text-xs">{c.last_sale ?? '—'}</td>
                <td className="p-2"><div className="flex flex-wrap gap-2">
                  <PopupAction label="Edit" title={`Edit ${c.legal_name}`} variant="secondary" wide notice={message}>{(close) => <ClientForm client={c} agents={agents} canMove={canMove && hasStore} canFinance={canFinance} onDone={(m) => { done(m); close(); }} />}</PopupAction>
                  {canFinance && <Link className="button-secondary" href={`/finance/accounts-receivable/statement/${c.id}`} target="_blank">Statement</Link>}
                </div></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={canMove ? 8 : 7} className="p-6 text-center text-slate-500">No clients found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
