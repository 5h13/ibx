'use client';
// Build 126 (UIA-44): cash advances for the store — the Business Admin approves or rejects
// (Admin → Cash Advances); Finance releases the cash (Finance → Cash Advances).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { decideCashAdvanceAction, releaseCashAdvanceAction } from './actions';
import { advanceState, peso } from './CashAdvanceCard';

type Bank = { id: string; account_name: string; bank_name: string | null; is_cash_on_hand: boolean };

export function CashAdvanceManager({ rows, mode, banks, canDecide, canRelease }: { rows: any[]; mode: 'admin' | 'finance'; banks: Bank[]; canDecide: boolean; canRelease: boolean }) {
  const router = useRouter();
  const dialog = useDialog();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [bank, setBank] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<unknown>) => start(async () => { setError(''); try { await fn(); router.refresh(); } catch (e) { setError(errorText(e)); } });
  const shown = rows.filter((a) => filter === 'all' || ['requested', 'approved'].includes(a.status) || (a.status === 'released' && !a.paid_off));
  const outstanding = rows.filter((a) => a.status === 'released').reduce((s, a) => s + Number(a.balance || 0), 0);
  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-semibold">Cash Advances</h2>
        <p className="text-sm text-slate-500">{mode === 'admin' ? 'Employees request in My Profile; the Business Admin approves (up to half a month\'s pay, 1–12 payments, one at a time, no interest). Finance then releases the cash.' : 'Approved advances to release, and what employees still owe. Released advances are deducted from each payroll run automatically.'}</p></div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Waiting for approval" value={String(rows.filter((a) => a.status === 'requested').length)} />
        <Tile label="Approved, to release" value={String(rows.filter((a) => a.status === 'approved').length)} />
        <Tile label="Still owed by employees" value={peso(outstanding)} />
      </div>
      <div className="flex gap-2">{(['open', 'all'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded px-3 py-1.5 text-sm ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{f === 'open' ? 'Open' : 'All'}</button>)}</div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Advance</th><th className="p-3">Employee</th><th className="p-3 text-right">Amount</th><th className="p-3">Repayment</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
          <tbody>{shown.map((a) => { const st = advanceState(a); return (
            <tr key={a.id} className="border-t align-top">
              <td className="p-3"><div className="font-medium">{a.advance_number}</div><div className="text-xs text-slate-500">{new Date(a.requested_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}</div></td>
              <td className="p-3">{a.employee_name}<div className="text-xs text-slate-500">{a.employee_no} · {a.reason}</div><div className="text-xs text-slate-400">Monthly pay {peso(a.monthly_pay)}</div></td>
              <td className="p-3 text-right font-medium">{peso(a.amount)}</td>
              <td className="p-3">{a.payments} × {peso(a.instalment)}{a.status === 'released' && <div className="text-xs text-slate-500">repaid {peso(a.deducted)} · left <b>{peso(a.balance)}</b></div>}</td>
              <td className="p-3"><span className={`rounded px-1.5 py-0.5 text-[11px] ${st.tone}`}>{st.label}</span>{a.rejection_reason && <div className="text-xs text-red-700">{a.rejection_reason}</div>}</td>
              <td className="p-3 whitespace-nowrap">
                {a.status === 'requested' && canDecide && <>
                  <button className="mr-3 text-emerald-700 hover:underline" disabled={pending} onClick={() => run(() => decideCashAdvanceAction(a.id, true))}>Approve</button>
                  <button className="text-red-700 hover:underline" disabled={pending} onClick={async () => { const r = await dialog.prompt('Why is it not approved? (the employee sees this)', { required: true }); if (r) run(() => decideCashAdvanceAction(a.id, false, r)); }}>Reject</button></>}
                {a.status === 'approved' && canRelease && <div className="flex items-center gap-2">
                  <select className="input w-44" value={bank[a.id] ?? ''} onChange={(e) => setBank({ ...bank, [a.id]: e.target.value })}><option value="">Cash on hand</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.account_name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}</select>
                  <button className="button" disabled={pending} onClick={async () => { if (await dialog.confirm(`Release ${peso(a.amount)} to ${a.employee_name}?`, { title: 'Release cash advance' })) run(() => releaseCashAdvanceAction(a.id, bank[a.id] || null, bank[a.id] ? 'bank' : 'cash')); }}>Release</button></div>}
                {a.status === 'approved' && !canRelease && <span className="text-xs text-slate-500">Finance releases it</span>}
              </td>
            </tr>); })}
            {shown.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No cash advances {filter === 'open' ? 'open' : 'yet'}.</td></tr>}
          </tbody></table>
      </div>
    </div>
  );
}
function Tile({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-white p-4"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>; }
