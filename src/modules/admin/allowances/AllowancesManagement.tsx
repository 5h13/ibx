'use client';
// Build 91 — monthly expense allowances per person (employee or agent) and category.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { deleteAllowanceAction, saveAllowanceAction } from './actions';

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Opt = { id: string; name: string };

function AddForm({ people, categories, onDone }: { people: { value: string; label: string }[]; categories: Opt[]; onDone: (m: string) => void }) {
  const [f, setF] = useState({ person: '', category_id: '', monthly_limit: '', notes: '' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">Person<select className="input mt-1" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="block">Category<select className="input mt-1" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block">Monthly limit (₱)<input className="input mt-1" type="number" min="0" step="0.01" value={f.monthly_limit} onChange={(e) => setF({ ...f, monthly_limit: e.target.value })} /></label>
        <label className="block">Notes<input className="input mt-1" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.person || !f.category_id || f.monthly_limit === ''} onClick={() => start(async () => {
        setError(''); try { await saveAllowanceAction({ ...f, monthly_limit: Number(f.monthly_limit) }); onDone('Allowance saved.'); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Save allowance'}</button>
    </div>
  );
}

export function AllowancesManagement({ rows, categories, users, agents }: { rows: any[]; categories: { id: string; name: string }[]; users: { id: string; full_name: string | null; email: string; role: string }[]; agents: { id: string; agent_code: string; name: string }[] }) {
  const [message, setMessage] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const people = [
    ...users.map((u) => ({ value: `user:${u.id}`, label: `${u.full_name || u.email} (${u.role.replace('_', ' ')})` })),
    ...agents.map((a) => ({ value: `agent:${a.id}`, label: `${a.name} (agent ${a.agent_code})` })),
  ];
  const who = (r: any) => r.user_id ? (users.find((u) => u.id === r.user_id)?.full_name || users.find((u) => u.id === r.user_id)?.email || 'Employee') : `${agents.find((a) => a.id === r.agent_id)?.name ?? 'Agent'} (agent)`;
  const cat = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Expense Allowances</h2>
        <p className="mt-1 text-sm text-slate-500">A monthly limit per person and expense category, for employees and agents of this store. Expenses over the limit are still saved but flagged “over allowance” for the approver.</p>
      </div>
      <ActionBar><PopupAction label="+ Add allowance" title="Add allowance" wide notice={message}>{(close) => <AddForm people={people} categories={categories} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction></ActionBar>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Person</th><th className="p-2">Category</th><th className="p-2 text-right">Monthly limit</th><th className="p-2">Notes</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{who(r)}</td>
                <td className="p-2">{cat(r.category_id)}</td>
                <td className="p-2 text-right">{edit[r.id] !== undefined
                  ? <input className="input w-32 text-right" type="number" min="0" step="0.01" value={edit[r.id]} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} />
                  : peso(r.monthly_limit)}</td>
                <td className="p-2 text-xs text-slate-600">{r.notes ?? ''}</td>
                <td className="p-2"><div className="flex gap-2 text-xs">
                  {edit[r.id] === undefined
                    ? <button type="button" className="text-blue-700 underline" onClick={() => setEdit({ ...edit, [r.id]: String(r.monthly_limit) })}>Edit</button>
                    : <button type="button" className="text-blue-700 underline" disabled={pending} onClick={() => start(async () => { try { await saveAllowanceAction({ id: r.id, person: '', category_id: r.category_id, monthly_limit: Number(edit[r.id]), notes: r.notes }); const n = { ...edit }; delete n[r.id]; setEdit(n); setMessage('Allowance saved.'); } catch (e) { setMessage(errorText(e)); } })}>Save</button>}
                  <button type="button" className="text-red-700 underline" disabled={pending} onClick={() => start(async () => { try { await deleteAllowanceAction(r.id); setMessage('Allowance removed.'); } catch (e) { setMessage(errorText(e)); } })}>Remove</button>
                </div></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No allowances set. Without one, expenses are not checked against a limit.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
