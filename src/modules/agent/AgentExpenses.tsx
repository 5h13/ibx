'use client';
// Build 91 — agent expense reports. A receipt photo is required, except for
// Meals. Amounts over the agent's monthly allowance are flagged (not blocked).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { shrink } from '@/modules/finance/procurement/CatalogPhotoUpload';
import { agentPhotoUrlAction, cancelExpenseAction, submitExpenseAction, uploadAgentPhotoAction } from './agentActions';
import { Pill, manilaToday, peso } from './AgentHeader';

type Cat = { id: string; code: string; name: string };
const STATUS_LABEL = (e: any) => e.status === 'approved'
  ? (e.expense_status === 'paid' ? ['paid', 'Paid back'] : e.expense_status === 'posted' ? ['approved', 'Approved · Finance posted'] : ['approved', 'Approved · waiting for Finance'])
  : e.status === 'submitted' ? ['submitted', 'Waiting for approval'] : [e.status, undefined];

function ExpenseForm({ businessId, categories, allowances, expenses, onDone }: { businessId: string; categories: Cat[]; allowances: { category_id: string; monthly_limit: number }[]; expenses: any[]; onDone: (m: string) => void }) {
  const [f, setF] = useState({ category_id: '', amount: '', expense_date: manilaToday(), description: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const cat = categories.find((c) => c.id === f.category_id);
  const meals = cat?.code === 'meals';
  const limit = allowances.find((a) => a.category_id === f.category_id)?.monthly_limit;
  const used = expenses.filter((e) => e.category_id === f.category_id && ['submitted', 'approved'].includes(e.status) && String(e.expense_date).slice(0, 7) === f.expense_date.slice(0, 7))
    .reduce((s, e) => s + Number(e.amount), 0);
  const over = limit != null ? Math.max(used + (Number(f.amount) || 0) - Number(limit), 0) : 0;
  const submit = () => start(async () => {
    setError('');
    if (!meals && !photo) { setError('Attach a photo of the receipt (only meals can be filed without one).'); return; }
    try {
      let photo_path: string | null = null;
      if (photo) { const fd = new FormData(); fd.set('file', photo.type.startsWith('image/') ? await shrink(photo) : photo); photo_path = await uploadAgentPhotoAction(fd); }
      await submitExpenseAction({ business_id: businessId, category_id: f.category_id, amount: Number(f.amount), expense_date: f.expense_date, description: f.description, photo_path });
      onDone(`Expense of ${peso(f.amount)} sent for approval.`);
    } catch (e) { setError(errorText(e)); }
  });
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">Category *<select className="input mt-1" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
          <option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block">Amount *<input className="input mt-1" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block">Date *<input className="input mt-1" type="date" max={manilaToday()} value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></label>
      </div>
      <label className="block">What was it for? *<input className="input mt-1" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Gas, visit to ABC Aircon" /></label>
      <label className="block">Receipt photo {meals ? '(optional for meals)' : '*'}<input className="mt-1 block text-xs" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
      {limit != null && <p className={`text-xs ${over > 0 ? 'text-amber-700' : 'text-slate-500'}`}>Monthly allowance for {cat?.name}: {peso(limit)} · used this month {peso(used)}{over > 0 ? ` · this is ${peso(over)} over (it will be flagged for the approver)` : ''}</p>}
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.category_id || !(Number(f.amount) > 0) || !f.description.trim()} onClick={submit}>{pending ? 'Sending…' : 'Send for approval'}</button>
    </div>
  );
}

export function AgentExpenses({ businessId, expenses, categories, allowances }: { businessId: string; expenses: any[]; categories: Cat[]; allowances: { category_id: string; monthly_limit: number }[] }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const view = (path: string) => start(async () => { try { window.open(await agentPhotoUrlAction(path), '_blank'); } catch (e) { setMessage(errorText(e)); } });
  const cancel = (e: any) => start(async () => { try { await cancelExpenseAction(e.id); setMessage(`${e.expense_number} cancelled.`); router.refresh(); } catch (er) { setMessage(errorText(er)); } });
  const month = manilaToday().slice(0, 7);
  const thisMonth = expenses.filter((e) => String(e.expense_date).slice(0, 7) === month && ['submitted', 'approved'].includes(e.status)).reduce((s, e) => s + Number(e.amount), 0);
  return (
    <div className="space-y-3">
      <ActionBar>
        <PopupAction label="+ New expense" title="New expense" wide notice={message}>
          {(close) => <ExpenseForm businessId={businessId} categories={categories} allowances={allowances} expenses={expenses} onDone={(m) => { setMessage(m); close(); router.refresh(); }} />}
        </PopupAction>
        <span className="text-sm text-slate-600">This month: <b>{peso(thisMonth)}</b></span>
      </ActionBar>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">No.</th><th className="p-2">Date</th><th className="p-2">Category</th><th className="p-2">For</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {expenses.map((e) => { const [st, lbl] = STATUS_LABEL(e); return (
              <tr key={e.id} className="border-t align-top">
                <td className="p-2 font-mono text-xs">{e.expense_number}</td>
                <td className="p-2 text-xs">{e.expense_date}</td>
                <td className="p-2">{e.category}</td>
                <td className="p-2">{e.description}{e.no_receipt && <div className="text-xs text-slate-500">no receipt</div>}</td>
                <td className="p-2 text-right">{peso(e.amount)}{Number(e.over_allowance) > 0 && <div className="text-xs text-amber-700">{peso(e.over_allowance)} over allowance</div>}</td>
                <td className="p-2"><Pill status={st as string} label={lbl as string | undefined} />{e.decision_note && <div className="mt-1 max-w-xs text-xs text-slate-600">{e.decision_note}</div>}</td>
                <td className="p-2"><div className="flex gap-2 text-xs">
                  {e.photo_path && <button type="button" className="text-blue-700 underline" disabled={pending} onClick={() => view(e.photo_path)}>Receipt</button>}
                  {e.status === 'submitted' && <button type="button" className="text-red-700 underline" disabled={pending} onClick={() => cancel(e)}>Cancel</button>}
                </div></td>
              </tr>
            ); })}
            {!expenses.length && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No expenses filed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
