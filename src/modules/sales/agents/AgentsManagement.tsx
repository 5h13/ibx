'use client';
// Build 86 — AGT-01 Part A: the agent list. Each store has its own "Store"
// agent; freelance agents sell for all stores. Every customer has one agent and
// every sale takes its customer's agent.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { saveAgentAction } from './agentActions';

export type AgentRow = { id: string; agent_code: string; name: string; kind: 'store' | 'freelance'; phone: string | null; email: string | null; gcash_number: string | null;
  notes: string | null; active: boolean; customers: number; sales_count: number; sales_total: number };
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

export function AgentsManagement({ agents, canEdit, from, to }: { agents: AgentRow[]; canEdit: boolean; from: string; to: string }) {
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
      {canEdit && <ActionBar><PopupAction label="+ Add agent" title="Add freelance agent" notice={message}>{(close) => <AgentForm onDone={(m) => { setMessage(m); close(); }} />}</PopupAction></ActionBar>}
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
                <td className="p-2">{a.active ? 'Active' : 'Inactive'}</td>
                {canEdit && <td className="p-2"><div className="flex gap-2">
                  <PopupAction label="Edit" title={`Edit ${a.name}`} variant="secondary">{(close) => <AgentForm agent={a} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>
                  {a.kind === 'freelance' && <button type="button" className="button-secondary" disabled={pending} onClick={() => toggle(a)}>{a.active ? 'Deactivate' : 'Activate'}</button>}
                </div></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
