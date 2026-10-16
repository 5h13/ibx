'use client';
// Build 126 (UIA-44): My Profile → cash advance — request, see the balance, cancel while waiting.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { cancelCashAdvanceAction, requestCashAdvanceAction } from './actions';

export const peso = (n: unknown) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function advanceState(a: any) {
  if (a.status === 'requested') return { label: 'Waiting for the Business Admin', tone: 'bg-amber-100 text-amber-800' };
  if (a.status === 'approved') return { label: 'Approved — waiting for Finance to release', tone: 'bg-sky-100 text-sky-800' };
  if (a.status === 'rejected') return { label: 'Not approved', tone: 'bg-red-100 text-red-800' };
  if (a.status === 'cancelled') return { label: 'Cancelled', tone: 'bg-slate-100 text-slate-600' };
  if (a.paid_off) return { label: 'Paid off', tone: 'bg-emerald-100 text-emerald-800' };
  return { label: 'Released — being repaid', tone: 'bg-indigo-100 text-indigo-800' };
}

export function CashAdvanceCard({ data }: { data: any }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [payments, setPayments] = useState('2');
  if (!data) return null;
  const history: any[] = data.history ?? [];
  const current = history.find((a) => a.id === data.open_id);
  const limit = data.limit == null ? null : Number(data.limit);
  const run = (fn: () => Promise<unknown>, after?: () => void) => start(async () => { setError(''); try { await fn(); after?.(); router.refresh(); } catch (e) { setError(errorText(e)); } });
  const each = Number(amount) > 0 && Number(payments) > 0 ? Number(amount) / Number(payments) : 0;
  return (
    <section className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Cash advance</h2>
        {!current && !open && limit != null && <button className="button-secondary" onClick={() => setOpen(true)}>Request a cash advance</button>}
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {limit == null && !current && <p className="text-sm text-slate-500">Your pay is not set up in payroll yet, so a cash advance cannot be requested. Ask HR.</p>}
      {current && (
        <div className="rounded-lg border p-3 text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-2"><b>{current.advance_number}</b> · {peso(current.amount)} in {current.payments} payment(s) of {peso(current.instalment)} <span className={`rounded px-1.5 py-0.5 text-[11px] ${advanceState(current).tone}`}>{advanceState(current).label}</span></div>
          {current.status === 'released' && <div>Repaid so far {peso(current.deducted)} · <b>left {peso(current.balance)}</b> · {current.payments_made} of {current.payments} payment(s)</div>}
          <div className="text-xs text-slate-500">{current.reason}</div>
          {current.status === 'requested' && <button className="text-xs text-red-700 hover:underline" disabled={pending} onClick={() => run(() => cancelCashAdvanceAction(current.id))}>Cancel request</button>}
        </div>
      )}
      {open && !current && limit != null && (
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => requestCashAdvanceAction(fd), () => setOpen(false)); }}>
          <label className="text-sm">Amount (up to {peso(limit)})<input className="input mt-1" name="amount" type="number" min="1" max={limit} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label className="text-sm">Repay in<select className="input mt-1" name="payments" value={payments} onChange={(e) => setPayments(e.target.value)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} payment{n > 1 ? 's' : ''}{n === 12 ? ' (6 months)' : ''}</option>)}</select></label>
          <div className="text-sm text-slate-600 self-end pb-2">{each > 0 ? <>About <b>{peso(each)}</b> taken from each pay</> : 'Taken from your pay, twice a month'}</div>
          <label className="text-sm sm:col-span-3">What is it for?<input className="input mt-1" name="reason" required /></label>
          <p className="text-xs text-slate-500 sm:col-span-3">The most you can borrow is half a month's pay, with no interest, and one advance at a time. The Business Admin approves; Finance releases the cash. If you leave the company, what is left is taken from your final pay.</p>
          <div className="flex gap-2 sm:col-span-3"><button className="button" disabled={pending}>{pending ? 'Sending…' : 'Send request'}</button><button type="button" className="button-secondary" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {history.filter((a) => a.id !== data.open_id).length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer text-slate-600">Earlier advances</summary>
          <ul className="mt-2 space-y-1">{history.filter((a) => a.id !== data.open_id).map((a) => <li key={a.id} className="flex flex-wrap gap-2">{a.advance_number} · {peso(a.amount)} <span className={`rounded px-1.5 py-0.5 text-[11px] ${advanceState(a).tone}`}>{advanceState(a).label}</span>{a.rejection_reason && <span className="text-xs text-red-700">{a.rejection_reason}</span>}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
