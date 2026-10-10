'use client';
// Build 92 — agent commissions (staff): one row per freelance agent for the month; statement, adjustments,
// close the month (Business Admin) and the commission matrix (rates per category, tier brackets).
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { CommissionStatement } from '@/modules/agent/CommissionStatement';
import { agentOnlineAction, commissionAdjustAction, commissionAdjustDeleteAction, commissionCloseAction, commissionSettingsAction, commissionStatementAction, savingsReleaseAction } from './commissionActions';

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Statement({ agentId, month }: { agentId: string; month: string }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { commissionStatementAction(agentId, `${month}-01`).then(setD).catch((e) => setError(errorText(e))); }, [agentId, month]);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return <CommissionStatement data={d} />;
}

function AdjustForm({ agent, month, lines, onDone }: { agent: any; month: string; lines: any[]; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      {lines.length > 0 && <ul className="space-y-1">{lines.map((a: any) => <li key={a.id} className="flex justify-between gap-2"><span>{a.note}</span><span>{peso(a.amount)}
        <button type="button" className="ml-2 text-xs text-red-700 underline" onClick={() => start(async () => { try { await commissionAdjustDeleteAction(a.id); onDone('Adjustment removed.'); } catch (e) { setError(errorText(e)); } })}>remove</button></span></li>)}</ul>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">Amount (negative = deduction)<input className="input mt-1" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="block">What for<input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cash advance, bonus" /></label>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !Number(amount) || !note.trim()} onClick={() => start(async () => {
        setError(''); try { await commissionAdjustAction(agent.agent_id, `${month}-01`, Number(amount), note); onDone(`Adjustment added for ${agent.agent}.`); } catch (e) { setError(errorText(e)); }
      })}>Add adjustment</button>
    </div>
  );
}

function SettingsForm({ data, categories, onDone }: { data: any; categories: string[]; onDone: (m: string) => void }) {
  const s = data.settings ?? {};
  const [f, setF] = useState({ default_rate: String(s.default_rate ?? 20), max_rate: String(s.max_rate ?? 30), start_date: String(s.start_date ?? ''),
    online_rate: String(s.online_rate ?? 20), savings_rate: String(s.savings_rate ?? 0), deduct: !!s.deduct_agent_expenses });
  const [rates, setRates] = useState<{ category: string; rate: string }[]>((data.rates ?? []).map((r: any) => ({ category: r.category, rate: String(r.rate) })));
  const [brackets, setBrackets] = useState<{ min_paid: string; points: string }[]>((data.brackets ?? []).map((b: any) => ({ min_paid: String(b.min_paid), points: String(b.points) })));
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">Default rate (% of markup)<input className="input mt-1" type="number" step="any" value={f.default_rate} onChange={(e) => setF({ ...f, default_rate: e.target.value })} /></label>
        <label className="block">Maximum rate (%)<input className="input mt-1" type="number" step="any" value={f.max_rate} onChange={(e) => setF({ ...f, max_rate: e.target.value })} /></label>
        <label className="block">Commission starts on<input className="input mt-1" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
        <label className="block">Online agents — flat rate (%)<input className="input mt-1" type="number" step="any" value={f.online_rate} onChange={(e) => setF({ ...f, online_rate: e.target.value })} /></label>
        <label className="block">Savings held back (% of commission after expenses, direct agents)<input className="input mt-1" type="number" step="any" value={f.savings_rate} onChange={(e) => setF({ ...f, savings_rate: e.target.value })} /></label>
        <label className="flex items-center gap-2 pt-6"><input type="checkbox" checked={f.deduct} onChange={(e) => setF({ ...f, deduct: e.target.checked })} /> Deduct the agent&apos;s approved expenses from his commission</label>
      </div>
      <div>
        <div className="mb-1 font-medium">Rate per category <span className="font-normal text-slate-500">(others use the default)</span></div>
        {rates.map((r, i) => (
          <div key={i} className="mb-1 flex gap-2">
            <select className="input" value={r.category} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
              <option value="">Category…</option>{categories.map((c) => <option key={c} value={c.toLowerCase()}>{c}</option>)}{r.category && !categories.some((c) => c.toLowerCase() === r.category) && <option value={r.category}>{r.category}</option>}
            </select>
            <input className="input w-28" type="number" step="any" value={r.rate} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
            <button type="button" className="text-xs text-red-700" onClick={() => setRates(rates.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="button-secondary text-xs" onClick={() => setRates([...rates, { category: '', rate: f.default_rate }])}>+ Category rate</button>
      </div>
      <div>
        <div className="mb-1 font-medium">Monthly tier brackets <span className="font-normal text-slate-500">(paid sales in the month → points added to the rate)</span></div>
        {brackets.map((b, i) => (
          <div key={i} className="mb-1 flex items-center gap-2">
            <span className="text-xs text-slate-500">from ₱</span><input className="input w-36" type="number" step="0.01" value={b.min_paid} onChange={(e) => setBrackets(brackets.map((x, j) => (j === i ? { ...x, min_paid: e.target.value } : x)))} />
            <input className="input w-24" type="number" step="any" value={b.points} onChange={(e) => setBrackets(brackets.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))} /><span className="text-xs text-slate-500">points</span>
            <button type="button" className="text-xs text-red-700" onClick={() => setBrackets(brackets.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="button-secondary text-xs" onClick={() => setBrackets([...brackets, { min_paid: '', points: '' }])}>+ Bracket</button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending} onClick={() => start(async () => {
        setError('');
        try {
          await commissionSettingsAction({ default_rate: Number(f.default_rate), max_rate: Number(f.max_rate), start_date: f.start_date,
            online_rate: Number(f.online_rate), savings_rate: Number(f.savings_rate), deduct_agent_expenses: f.deduct,
            rates: rates.filter((r) => r.category && r.rate !== '').map((r) => ({ category: r.category, rate: Number(r.rate) })),
            brackets: brackets.filter((b) => b.min_paid !== '' && b.points !== '').map((b) => ({ min_paid: Number(b.min_paid), points: Number(b.points) })) });
          onDone('Commission matrix saved.');
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Save matrix'}</button>
    </div>
  );
}

function ReleaseForm({ agent, onDone }: { agent: any; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState(String(agent.savings_balance));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p>Saved so far: <b>{peso(agent.savings_balance)}</b>. Releasing makes an approved Commission expense for Finance to pay the agent.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">Amount<input className="input mt-1" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="block">Note<input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. year-end release" /></label>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !(Number(amount) > 0)} onClick={() => start(async () => { setError(''); try { await savingsReleaseAction(agent.agent_id, Number(amount), note); onDone(`${peso(amount)} of ${agent.agent}'s savings released.`); } catch (e) { setError(errorText(e)); } })}>Release</button>
    </div>
  );
}

export function AgentCommissions({ data, month, thisMonth, canManage, categories }: { data: any; month: string; thisMonth: string; canManage: boolean; categories: string[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const agents: any[] = (data?.agents ?? []).filter((a: any) => a.active || Number(a.paid_sales) || Number(a.earned) || a.closed);
  const ended = month < thisMonth;
  const close = (a: any) => start(async () => {
    if (!(await dialog.confirm(`Close ${month} for ${a.agent}? Payable ${peso(a.payable)}. The amounts are frozen${Number(a.payable) > 0 ? ' and an approved Commission expense goes to Finance for payment' : ' and carried to next month'}.`))) return;
    try { const r = await commissionCloseAction(a.agent_id, `${month}-01`); setMessage(`${a.agent}: ${month} closed — payable ${peso(r.payable)}.`); router.refresh(); } catch (e) { setMessage(errorText(e)); }
  });
  const tot = (k: string) => agents.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const s = data?.settings ?? {};
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Agent Commissions</h2>
        <p className="mt-1 text-sm text-slate-500">Earned on the markup of each sale as the client pays; the month&apos;s paid sales set the tier. Default rate {Number(s.default_rate ?? 20)}% of markup, maximum {Number(s.max_rate ?? 30)}%; counted from {s.start_date}. Close a month after it ends: the amounts freeze and Finance pays the Commission expense.</p>
      </div>
      <ActionBar>
        <form method="get" className="flex items-end gap-2 text-sm"><label className="block">Month<input className="input mt-1" type="month" name="m" defaultValue={month} /></label><button className="button-secondary">Show</button></form>
        {canManage && <PopupAction label="Commission matrix" title="Commission matrix (this store)" variant="secondary" wide notice={message}>{(c) => <SettingsForm data={data} categories={categories} onDone={(m) => { setMessage(m); c(); router.refresh(); }} />}</PopupAction>}
      </ActionBar>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Agent</th><th className="p-2 text-right">Paid sales</th><th className="p-2 text-right">Tier</th><th className="p-2 text-right">Earned</th><th className="p-2 text-right">Adj. / carried</th><th className="p-2 text-right">Payable</th><th className="p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agent_id} className="border-t align-top">
                <td className="p-2 font-medium">{a.agent}<div className="text-xs font-normal text-slate-500">{a.agent_code}{a.online ? ' · online' : ''}{Number(a.savings_balance) > 0 ? ` · savings ${peso(a.savings_balance)}` : ''}</div></td>
                <td className="p-2 text-right">{peso(a.paid_sales)}</td>
                <td className="p-2 text-right">{Number(a.points) > 0 ? '+' : ''}{Number(a.points)} pts</td>
                <td className="p-2 text-right">{peso(a.earned)}</td>
                <td className="p-2 text-right">{peso(Number(a.adjustments) + Number(a.carried_in))}</td>
                <td className="p-2 text-right font-medium">{peso(a.payable)}</td>
                <td className="p-2 text-xs">{a.skipped ? 'counted in a later closed month' : a.closed ? (Number(a.payable) <= 0 ? 'closed · carried' : `closed · ${a.expense_status ?? 'approved'}`) : 'open'}</td>
                <td className="p-2"><div className="flex flex-wrap gap-2">
                  <PopupAction label="Statement" title={`${a.agent} — ${month}`} variant="secondary" wide><Statement agentId={a.agent_id} month={month} /></PopupAction>
                  {canManage && !a.closed && !a.skipped && <PopupAction label="Adjust" title={`Adjustments — ${a.agent} — ${month}`} variant="secondary">{(c) => <AdjustForm agent={a} month={month} lines={a.adjustment_lines ?? []} onDone={(m) => { setMessage(m); c(); router.refresh(); }} />}</PopupAction>}
                  {canManage && ended && !a.closed && !a.skipped && <button type="button" className="button" disabled={pending} onClick={() => close(a)}>Close month</button>}
                  {canManage && <button type="button" className="button-secondary" disabled={pending} onClick={() => start(async () => { try { await agentOnlineAction(a.agent_id, !a.online); setMessage(`${a.agent} is now ${a.online ? 'a direct' : 'an online'} agent.`); router.refresh(); } catch (e) { setMessage(errorText(e)); } })}>{a.online ? 'Make direct' : 'Make online'}</button>}
                  {canManage && Number(a.savings_balance) > 0 && <PopupAction label="Release savings" title={`Release savings — ${a.agent}`} variant="secondary">{(c) => <ReleaseForm agent={a} onDone={(m) => { setMessage(m); c(); router.refresh(); }} />}</PopupAction>}
                </div></td>
              </tr>
            ))}
            {!agents.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No freelance agents.</td></tr>}
          </tbody>
          {agents.length > 0 && <tfoot><tr className="border-t bg-slate-50 font-medium"><td className="p-2">Total</td><td className="p-2 text-right">{peso(tot('paid_sales'))}</td><td /><td className="p-2 text-right">{peso(tot('earned'))}</td><td /><td className="p-2 text-right">{peso(tot('payable'))}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
