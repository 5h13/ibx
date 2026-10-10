'use client';
// Build 86 — AGT-01 Part A: the agent list. Each store has its own "Store"
// agent; freelance agents sell for all stores. Every customer has one agent and
// every sale takes its customer's agent.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { agentExpensePhotoAction, decideAgentExpenseAction, saveAgentAction, saveTiersAction } from './agentActions';

export type AgentRow = { id: string; agent_code: string; name: string; kind: 'store' | 'freelance'; phone: string | null; email: string | null; gcash_number: string | null;
  notes: string | null; active: boolean; customers: number; sales_count: number; sales_total: number; has_login?: boolean };
const peso = (v: number) => `₱${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function AgentForm({ agent, onDone }: { agent?: AgentRow; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ name: agent?.name ?? '', phone: agent?.phone ?? '', email: agent?.email ?? '', gcash_number: agent?.gcash_number ?? '', notes: agent?.notes ?? '' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const save = () => { setError(''); start(async () => { try { await saveAgentAction(agent?.id ?? null, f); onDone(agent ? `${f.name} saved.` : `${f.name} added.`); } catch (e) { setError(errorText(e)); } }); };
  const box = (k: keyof typeof f, label: string) => <label className="block text-sm"><span className="mb-1 block text-slate-600">{label}</span><input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="space-y-3">
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

export function AgentsManagement({ agents, canEdit, from, to, tiers = null, expenses = [] }: { agents: AgentRow[]; canEdit: boolean; from: string; to: string; tiers?: number[] | null; expenses?: any[] }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const toggle = (a: AgentRow) => { setError(''); start(async () => { try { await saveAgentAction(a.id, { name: a.name, phone: a.phone ?? '', email: a.email ?? '', gcash_number: a.gcash_number ?? '', notes: a.notes ?? '', active: !a.active }); setMessage(`${a.name} ${a.active ? 'deactivated' : 'activated'}.`); } catch (e) { setError(errorText(e)); } }); };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Sales agents</h2>
        <p className="mt-1 text-sm text-slate-500">Every customer has an agent, and every counter sale, quotation and sales order takes its customer&apos;s agent. New customers default to the store&apos;s own agent. To move a customer to another agent, edit the customer (Accounts Receivable → Customers); past sales keep the agent they were made under.</p>
      </div>
      {canEdit && <ActionBar><PopupAction label="+ Add agent" title="Add freelance agent" notice={message}>{(close) => <AgentForm onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>
        {tiers && <PopupAction label="Price tiers" title="Agent price tiers (this store)" variant="secondary" wide notice={message}>{(close) => <TiersForm tiers={tiers} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>}
        <span className="text-xs text-slate-500">Agent logins: Settings → Users, role “Agent”.</span></ActionBar>}
      {tiers && <p className="text-xs text-slate-500">Price tiers: Tier 2 −{Number(tiers[0].toFixed(2))}% · Tier 3 −{Number(tiers[1].toFixed(2))}% · Tier 4 −{Number(tiers[2].toFixed(2))}% of the markup.</p>}
      {!canEdit && message && <p className="text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="block"><span className="mb-1 block text-xs text-slate-600">Sales from</span><input className="input" type="date" name="from" defaultValue={from} /></label>
        <label className="block"><span className="mb-1 block text-xs text-slate-600">to</span><input className="input" type="date" name="to" defaultValue={to} /></label>
        <button className="button-secondary">Show</button>
      </form>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">Code</th><th className="p-2">Agent</th><th className="p-2">Type</th><th className="p-2">Contact</th><th className="p-2 text-right">Customers</th><th className="p-2 text-right">Counter sales {from} to {to}</th><th className="p-2">Status</th>{canEdit && <th className="p-2" />}</tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="p-2 font-mono text-xs">{a.agent_code}</td>
                <td className="p-2 font-medium">{a.name}{a.notes && <div className="text-xs text-slate-500">{a.notes}</div>}</td>
                <td className="p-2">{a.kind === 'store' ? 'Store (own sales)' : 'Freelance'}</td>
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
