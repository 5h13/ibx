'use client';
// Build 86 — AGT-01 Part A: the agent list. Each store has its own "Store"
// agent; freelance agents sell for all stores. Every customer has one agent and
// every sale takes its customer's agent.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { agentExpensePhotoAction, decideAgentExpenseAction, saveAgentAction, saveTiersAction } from './agentActions';
import { agentCommissionSetupAction } from './commissionActions';

export type AgentRow = { id: string; agent_code: string; name: string; kind: 'store' | 'freelance'; phone: string | null; email: string | null; gcash_number: string | null;
  notes: string | null; active: boolean; commission_basis?: 'markup' | 'gross' | null; commission_rate?: number | null; gross_less_expenses?: boolean | null; stores?: string[]; business_id?: string | null; customers: number; sales_count: number; sales_total: number; has_login?: boolean };
const peso = (v: number) => `₱${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Build 95c — the agent form asks the type: a store agent (the store's own salesman, paid a % of gross sales
// collected — can have an agent-app login) or a freelance agent (commission on markup). The "Store (…)" account
// for walk-ins is not a person and stays as it is.
const typeLabel = (a: AgentRow) => (a.kind === 'store' ? 'Store account (walk-ins)' : a.commission_basis === 'gross' ? `Store agent · ${Number(a.commission_rate ?? 0)}% of gross` : 'Freelance · markup');

function AgentForm({ agent, onDone }: { agent?: AgentRow; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ name: agent?.name ?? '', phone: agent?.phone ?? '', email: agent?.email ?? '', gcash_number: agent?.gcash_number ?? '', notes: agent?.notes ?? '' });
  const person = !agent || agent.kind === 'freelance';
  const [type, setType] = useState<'gross' | 'markup'>(agent?.commission_basis === 'gross' ? 'gross' : agent ? 'markup' : 'gross');
  const [rate, setRate] = useState(String(agent?.commission_basis === 'gross' && agent.commission_rate != null ? Number(agent.commission_rate) : 1));
  const [lessExp, setLessExp] = useState(agent?.gross_less_expenses ?? false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const save = () => {
    setError('');
    if (person && type === 'gross' && !(Number(rate) >= 0 && Number(rate) <= 100 && rate.trim() !== '')) { setError('Enter the % of gross sales (e.g. 1).'); return; }
    start(async () => {
      try {
        const id = await saveAgentAction(agent?.id ?? null, f);
        const changed = !agent ? true : type !== (agent.commission_basis === 'gross' ? 'gross' : 'markup') || (type === 'gross' && (Number(rate) !== Number(agent.commission_rate) || lessExp !== !!agent.gross_less_expenses));
        if (person && changed) {
          await agentCommissionSetupAction(agent?.id ?? id, type === 'gross'
            ? { commission_basis: 'gross', commission_rate: Number(rate), gross_less_expenses: lessExp }
            : { commission_basis: 'markup', commission_rate: 0, gross_less_expenses: false, tiers: [] });
        }
        onDone(agent ? `${f.name} saved.` : `${f.name} added as ${type === 'gross' ? 'a store agent' : 'a freelance agent'}. Give him a login in Settings → Users (role Agent) to use the agent app.`);
      } catch (e) { setError(errorText(e)); }
    });
  };
  const box = (k: keyof typeof f, label: string) => <label className="block text-sm"><span className="mb-1 block text-slate-600">{label}</span><input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="space-y-3">
      {person && (
        <fieldset className="space-y-2 rounded border p-3 text-sm">
          <legend className="px-1 text-slate-600">Type</legend>
          <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={type === 'gross'} onChange={() => setType('gross')} />
            <span><b>Store agent</b> — the store&apos;s own salesman; paid a % of the gross sales his clients pay.</span></label>
          <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={type === 'markup'} onChange={() => setType('markup')} />
            <span><b>Freelance agent</b> — own clients, no benefits; commission on the markup (store commission rules).</span></label>
          {type === 'gross' && (
            <div className="flex flex-wrap items-end gap-3 pl-6">
              <label className="block">% of gross sales<input className="input mt-1 w-28" type="number" min="0" max="100" step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
              <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={lessExp} onChange={(e) => setLessExp(e.target.checked)} /> Deduct his approved expenses</label>
            </div>
          )}
          <p className="text-xs text-slate-500">Both kinds can log in to the agent app (Settings → Users, role Agent). Tiered rates: Agent Commissions → How paid.</p>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">{box('name', 'Name *')}{box('phone', 'Phone')}{box('email', 'Email')}{box('gcash_number', 'GCash no. (payouts)')}</div>
      {box('notes', 'Notes')}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.name.trim()} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

/** Build 91 — price tiers: Tier 2–4 give away this share of each item's markup (store price − acquisition cost); never below the floor. */
function TiersForm({ tiers, onDone }: { tiers: number[]; onDone: (m: string) => void }) {
  const [v, setV] = useState(tiers.map((t) => String(Math.round(t * 1e8) / 1e8)));
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const ex = (pct: number) => Math.max(2500 - Math.round(1300 * pct) / 100, 1284);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Each tier gives away a share of the item&apos;s <b>markup</b>. Agents pick a tier per client or per order line; Tier 4 is the lowest an agent can go. Prices never go below the floor (cost + 7%).</p>
      <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map((i) => (
        <label key={i} className="block">Tier {i + 2} — % of markup<input className="input mt-1" type="number" min="0" max="100" step="any" value={v[i]} onChange={(e) => setV(v.map((x, j) => (j === i ? e.target.value : x)))} />
          <span className="text-xs text-slate-500">₱2,500 item, cost ₱1,200 → ₱{ex(Number(v[i]) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></label>
      ))}</div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending} onClick={() => start(async () => { setError(''); try { await saveTiersAction(Number(v[0]), Number(v[1]), Number(v[2])); onDone('Price tiers saved.'); } catch (e) { setError(errorText(e)); } })}>{pending ? 'Saving…' : 'Save tiers'}</button>
    </div>
  );
}

function ExpenseReview({ expenses, onMessage }: { expenses: any[]; onMessage: (m: string) => void }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Record<string, string>>({});
  const decide = (e: any, approve: boolean) => start(async () => {
    try { await decideAgentExpenseAction(e.id, approve, note[e.id]); onMessage(`${e.expense_number} ${approve ? 'approved — Finance will pay it back' : 'rejected'}.`); } catch (er) { onMessage(errorText(er)); }
  });
  const photo = (e: any) => start(async () => { try { window.open(await agentExpensePhotoAction(e.id), '_blank'); } catch (er) { onMessage(errorText(er)); } });
  const waiting = expenses.filter((e) => e.status === 'submitted');
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Agent expenses {waiting.length ? `(${waiting.length} to approve)` : ''}</h3>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">No. / date</th><th className="p-2">Agent</th><th className="p-2">Category · for</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b align-top last:border-0">
                <td className="p-2 font-mono text-xs">{e.expense_number}<div className="font-sans text-slate-500">{e.expense_date}</div></td>
                <td className="p-2">{e.agent}</td>
                <td className="p-2">{e.category} · {e.description}{e.no_receipt && <div className="text-xs text-amber-700">no receipt (meals)</div>}</td>
                <td className="p-2 text-right">{peso(e.amount)}{Number(e.over_allowance) > 0 && <div className="text-xs text-amber-700">{peso(e.over_allowance)} over the {peso(e.allowance_limit)} allowance</div>}</td>
                <td className="p-2 text-xs">{e.status === 'approved' ? `approved · ${e.expense_status ?? ''}` : e.status}{e.decision_note && <div className="text-slate-500">{e.decision_note}</div>}</td>
                <td className="p-2"><div className="flex flex-wrap gap-2">
                  {e.photo_path && <button type="button" className="button-secondary" disabled={pending} onClick={() => photo(e)}>Receipt</button>}
                  {e.status === 'submitted' && <>
                    <input className="input w-40 text-xs" placeholder="Note (needed to reject)" value={note[e.id] ?? ''} onChange={(ev) => setNote({ ...note, [e.id]: ev.target.value })} />
                    <button type="button" className="button" disabled={pending} onClick={() => decide(e, true)}>Approve</button>
                    <button type="button" className="button-secondary" disabled={pending} onClick={() => decide(e, false)}>Reject</button>
                  </>}
                </div></td>
              </tr>
            ))}
            {!expenses.length && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No agent expenses.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Approved expenses become approved Sales expenses (vendor = the agent) for Finance to post and pay back; the receipt photo is attached.</p>
    </div>
  );
}

export function AgentsManagement({ agents, canEdit, from, to, tiers = null, expenses = [], businesses = [] }: { businesses?: { id: string; code: string; trade_name: string | null }[]; agents: AgentRow[]; canEdit: boolean; from: string; to: string; tiers?: number[] | null; expenses?: any[] }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  // Build 97: filters — store (where the agent has clients; shown when several stores are visible) and status
  const [store, setStore] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const shown = agents.filter((a) => (status === 'all' || (status === 'active') === a.active) && (!store || (a.stores ?? []).includes(store)));
  const toggle = (a: AgentRow) => { setError(''); start(async () => { try { await saveAgentAction(a.id, { name: a.name, phone: a.phone ?? '', email: a.email ?? '', gcash_number: a.gcash_number ?? '', notes: a.notes ?? '', active: !a.active }); setMessage(`${a.name} ${a.active ? 'deactivated' : 'activated'}.`); } catch (e) { setError(errorText(e)); } }); };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Sales agents</h2>
        <p className="mt-1 text-sm text-slate-500">Every customer has an agent, and every counter sale, quotation and sales order takes its customer&apos;s agent. New customers default to the store&apos;s own agent. To move a customer to another agent, edit the customer (Accounts Receivable → Customers); past sales keep the agent they were made under.</p>
      </div>
      {canEdit && <ActionBar><PopupAction label="+ Add agent" title="Add agent (store or freelance)" notice={message}>{(close) => <AgentForm onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>
        {tiers && <PopupAction label="Price tiers" title="Agent price tiers (this store)" variant="secondary" wide notice={message}>{(close) => <TiersForm tiers={tiers} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>}
        <span className="text-xs text-slate-500">Agent logins: Settings → Users, role “Agent”.</span></ActionBar>}
      {tiers && <p className="text-xs text-slate-500">Price tiers: Tier 2 −{Number(tiers[0].toFixed(2))}% · Tier 3 −{Number(tiers[1].toFixed(2))}% · Tier 4 −{Number(tiers[2].toFixed(2))}% of the markup.</p>}
      {!canEdit && message && <p className="text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {businesses.length > 1 && <select className="input w-48" value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store"><option value="">All stores</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.trade_name || b.code}</option>)}</select>}
        <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'all')} aria-label="Status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
        <span className="text-xs text-slate-500">{shown.length} of {agents.length} agent(s){store ? ' · with clients in this store' : ''}</span>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="block"><span className="mb-1 block text-xs text-slate-600">Sales from</span><input className="input" type="date" name="from" defaultValue={from} /></label>
        <label className="block"><span className="mb-1 block text-xs text-slate-600">to</span><input className="input" type="date" name="to" defaultValue={to} /></label>
        <button className="button-secondary">Show</button>
      </form>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">Code</th><th className="p-2">Agent</th><th className="p-2">Type</th><th className="p-2">Contact</th><th className="p-2 text-right">Customers</th><th className="p-2 text-right">Counter sales {from} to {to}</th><th className="p-2">Status</th>{canEdit && <th className="p-2" />}</tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="p-2 font-mono text-xs">{a.agent_code}</td>
                <td className="p-2 font-medium">{a.name}{a.notes && <div className="text-xs text-slate-500">{a.notes}</div>}</td>
                <td className="p-2">{typeLabel(a)}</td>
                <td className="p-2 text-xs">{[a.phone, a.email, a.gcash_number && `GCash ${a.gcash_number}`].filter(Boolean).join(' · ') || '—'}</td>
                <td className="p-2 text-right">{a.customers}</td>
                <td className="p-2 text-right">{a.sales_count} · {peso(a.sales_total)}</td>
                <td className="p-2">{a.active ? 'Active' : 'Inactive'}{a.has_login && <div className="text-xs text-emerald-700">has login</div>}</td>
                {canEdit && <td className="p-2"><div className="flex gap-2">
                  <PopupAction label="Edit" title={`Edit ${a.name}`} variant="secondary">{(close) => <AgentForm agent={a} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>
                  {a.kind === 'freelance' && <button type="button" className="button-secondary" disabled={pending} onClick={() => toggle(a)}>{a.active ? 'Deactivate' : 'Activate'}</button>}
                </div></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && <ExpenseReview expenses={expenses} onMessage={setMessage} />}
    </div>
  );
}
