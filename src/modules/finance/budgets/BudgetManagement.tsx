'use client';
// Build 89 (BUD-01) — Budgets & Forecasting.
//   * New budget from this year's actuals (lines = this year's expense
//     categories + sales, cost of sales, payroll; months pre-filled).
//   * Lines: timing monthly / yearly (accrued 1/12 a month, paid in one month) /
//     one-time; approved yearly lines create accrual schedules in Expenses.
//   * Scenarios = lists of actions with their effect on net income.
//   * Budget vs actual and rolling forecast, read from posted sales / expenses.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import * as A from '../budgetActions';
import { MONTH_LABEL, actionImpacts, applyScenario, baseMonths, lineMonths, sum, summarize, type BudgetAction, type BudgetLine, type LineType } from './budgetMath';

const peso = (v: number) => `₱${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (a: number, b: number) => (b ? `${((a - b) / Math.abs(b) * 100).toFixed(1)}%` : '—');
const TYPE_LABEL: Record<LineType, string> = { revenue: 'Sales', cogs: 'Cost of sales', expense: 'Expenses' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', prepared: 'Prepared', reviewed: 'Reviewed', approved: 'Approved', closed: 'Closed' };
const ACT_STATUS: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };
// ready-made actions: pick one and fill in the numbers
const TEMPLATES: { label: string; a: Partial<BudgetAction> }[] = [
  { label: 'Price increase', a: { title: 'Raise selling prices', target: 'all_revenue', change_kind: 'percent', value: 3, cogs_follows: false } },
  { label: 'Sales growth', a: { title: 'Grow sales volume', target: 'all_revenue', change_kind: 'percent', value: 10, cogs_follows: true } },
  { label: 'New hire', a: { title: 'Hire 1 staff', target: 'line', change_kind: 'amount', value: 18000, start_month: 4 } },
  { label: 'Rent increase', a: { title: 'Rent escalation', target: 'line', change_kind: 'percent', value: 5, start_month: 7 } },
  { label: 'Cost cut', a: { title: 'Reduce cost', target: 'line', change_kind: 'percent', value: -10 } },
  { label: 'Sales drop (conservative)', a: { title: 'Slower sales', target: 'all_revenue', change_kind: 'percent', value: -10, cogs_follows: true } },
];

type Props = { budgets: any[]; budget: any | null; lines: BudgetLine[]; scenarios: any[]; actions: BudgetAction[]; actuals: any[]; categories: { id: string; name: string }[];
  canApprove: boolean; hasBusiness: boolean; thisYear: number; initialTab?: string };

export function BudgetManagement({ budgets, budget, lines, scenarios, actions, actuals, categories, canApprove, hasBusiness, thisYear, initialTab }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState(['lines', 'scenarios', 'actual', 'guide'].includes(initialTab ?? '') ? initialTab! : 'lines');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const base = scenarios.find((s) => s.is_base);
  const [scenarioId, setScenarioId] = useState<string>(budget?.approved_scenario_id ?? base?.id ?? '');
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? base;
  const editable = budget && ['draft'].includes(budget.status);
  const run = (f: () => Promise<unknown>, ok: string) => { setErr(''); setMsg(''); start(async () => { try { await f(); setMsg(ok); router.refresh(); } catch (e) { setErr(errorText(e)); } }); };

  const scActions = (sid?: string) => actions.filter((a) => a.scenario_id === sid);
  const values = useMemo(() => applyScenario(lines, scActions(scenario?.id)), [lines, actions, scenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarize(lines, values), [lines, values]);
  const baseSummary = useMemo(() => summarize(lines, new Map(lines.map((l) => [l.id, baseMonths(l)]))), [lines]);

  if (!budget) {
    return (
      <div className="space-y-5">
        <Header />
        <div className="rounded-lg border bg-white p-6 text-sm text-slate-600">
          <p className="font-medium text-slate-800">No budget yet for this store.</p>
          <p className="mt-1">Start next year&apos;s budget from this year&apos;s actual sales and expenses: every expense you spent on this year becomes a budget line, already filled in month by month.</p>
          {hasBusiness ? <div className="mt-3"><NewBudget thisYear={thisYear} onDone={(id) => router.push(`/finance/budgets?b=${id}`)} /></div>
            : <p className="mt-3 text-amber-700">Select a business in &quot;Acting as&quot; first; budgets are per store.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block text-sm"><span className="mb-1 block text-xs text-slate-500">Budget</span>
          <select className="input" value={budget.id} onChange={(e) => router.push(`/finance/budgets?b=${e.target.value}`)}>
            {budgets.map((b) => <option key={b.id} value={b.id}>{b.budget_code} — {b.name} ({STATUS_LABEL[b.status] ?? b.status})</option>)}
          </select></label>
        <ActionBar>
          {hasBusiness && <PopupAction label="+ New budget from actuals" title="New budget from this year's actuals" variant="secondary">{(close) => <NewBudget thisYear={thisYear} onDone={(id) => { close(); router.push(`/finance/budgets?b=${id}`); }} />}</PopupAction>}
          {budget.status === 'draft' && <button className="button" disabled={pending} onClick={() => run(() => A.prepareBudgetAction(budget.id), 'Budget prepared — send it for review.')}>Mark prepared</button>}
          {budget.status === 'prepared' && <><button className="button" disabled={pending} onClick={() => run(() => A.reviewBudgetAction(budget.id, true), 'Budget reviewed — ready for the Business Admin.')}>Mark reviewed</button>
            <button className="button-secondary" disabled={pending} onClick={() => run(() => A.reviewBudgetAction(budget.id, false), 'Sent back to draft.')}>Send back</button></>}
          {budget.status === 'reviewed' && canApprove && <button className="button" disabled={pending || !scenario} onClick={() => run(() => A.approveBudgetScenarioAction(budget.id, scenario!.id), `Budget approved with the "${scenario!.name}" scenario.`)}>Approve with &quot;{scenario?.name}&quot;</button>}
          {budget.status === 'reviewed' && !canApprove && <span className="text-sm text-slate-500">Waiting for a Business Admin to approve.</span>}
          {budget.status === 'approved' && lines.some((l) => l.timing === 'yearly' && !l.accrual_schedule_id) &&
            <button className="button-secondary" disabled={pending} onClick={() => run(async () => { const r = await A.createBudgetAccrualsAction(budget.id); if (r.skipped.length) setErr(`No expense category on: ${r.skipped.join(', ')} — set up those accruals in Expenses.`); }, 'Accrual schedules created in Expenses for the yearly lines.')}>Create accrual schedules</button>}
        </ActionBar>
      </div>
      {msg && <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}
      {err && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <p className="text-xs text-slate-500">{budget.notes} · Status: <b>{STATUS_LABEL[budget.status]}</b>{budget.approved_scenario_id && <> · approved with <b>{scenarios.find((s) => s.id === budget.approved_scenario_id)?.name}</b></>}
        {!editable && budget.status !== 'approved' && ' · lines are locked while the budget is in review'}</p>

      {/* profit summary for the selected scenario */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Scenario shown:</span>
        {scenarios.map((s) => <button key={s.id} type="button" onClick={() => setScenarioId(s.id)} className={`rounded-full border px-3 py-1 ${s.id === scenario?.id ? 'border-blue-600 bg-blue-50 font-medium text-blue-800' : 'bg-white text-slate-600'}`}>{s.name}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        {([['Sales', 'sales'], ['Cost of sales', 'cogs'], ['Gross profit', 'gross'], ['Expenses', 'expenses'], ['Net income', 'net']] as const).map(([label, k]) => (
          <div key={k} className="rounded-lg border bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className={`text-lg font-semibold tabular-nums ${k === 'net' && sum(summary.net) < 0 ? 'text-red-700' : ''}`}>{peso(sum(summary[k]))}</div>
            <div className="text-xs text-slate-500">{budget.base_year ?? 'Base'}: {peso(sum(baseSummary[k]))} · {pct(sum(summary[k]), sum(baseSummary[k]))}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {([['lines', 'Budget lines'], ['scenarios', 'Scenarios & actions'], ['actual', 'Budget vs actual'], ['guide', 'How to budget']] as const).map(([k, l]) =>
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-blue-600 font-medium text-blue-800' : 'border-transparent text-slate-600'}`}>{l}</button>)}
      </div>

      {tab === 'lines' && <LinesTab lines={lines} values={values} summary={summary} editable={!!editable} budget={budget} categories={categories} onMsg={(m) => { setMsg(m); router.refresh(); }} />}
      {tab === 'scenarios' && <ScenariosTab budget={budget} lines={lines} scenarios={scenarios} actions={actions} scenarioId={scenario?.id ?? ''} setScenarioId={setScenarioId}
        canEdit={!!editable} canTrack={budget.status === 'approved'} onMsg={(m) => { setMsg(m); router.refresh(); }} />}
      {tab === 'actual' && <ActualTab budget={budget} lines={lines} values={values} actuals={actuals} thisYear={thisYear} scenarioName={scenario?.name ?? ''} />}
      {tab === 'guide' && <Guide />}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Budgets &amp; Forecasting</h1>
      <p className="text-sm text-slate-500">Next year&apos;s budget starts from this year&apos;s actuals. Adjust the lines you know will change, plan scenarios as concrete actions, then track budget against actual every month.</p>
    </div>
  );
}

function NewBudget({ thisYear, onDone }: { thisYear: number; onDone: (id: string) => void }) {
  const [f, setF] = useState({ year: thisYear + 1, base_year: thisYear, name: '', baseline: 'same_month' as 'same_month' | 'average' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="mb-1 block text-slate-600">Budget year</span><input className="input" type="number" value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} /></label>
        <label className="block"><span className="mb-1 block text-slate-600">Start from the actuals of</span><input className="input" type="number" value={f.base_year} onChange={(e) => setF({ ...f, base_year: Number(e.target.value) })} /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-slate-600">Name (optional)</span><input className="input" value={f.name} placeholder={`${f.year} Operating Budget`} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      </div>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-slate-600">Fill each month with</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={f.baseline === 'same_month'} onChange={() => setF({ ...f, baseline: 'same_month' })} /> the same month this year (keeps the seasons; months not finished yet use the monthly average)</label>
        <label className="flex items-center gap-2"><input type="radio" checked={f.baseline === 'average'} onChange={() => setF({ ...f, baseline: 'average' })} /> this year&apos;s monthly average, evenly</label>
      </fieldset>
      <p className="text-xs text-slate-500">Lines are made from this store&apos;s posted sales and cost of sales, approved payroll and posted / paid expenses (one line per expense category). Permits, insurance and 13th month start as yearly (accrued) lines.</p>
      {err && <p className="text-red-700">{err}</p>}
      <button className="button" disabled={pending} onClick={() => { setErr(''); start(async () => { try { onDone(await A.createBudgetFromActualsAction(f)); } catch (e) { setErr(errorText(e)); } }); }}>{pending ? 'Building the budget…' : 'Create budget'}</button>
    </div>
  );
}

// ------------------------------------------------------------------- lines --
function LinesTab({ lines, values, summary, editable, budget, categories, onMsg }: { lines: BudgetLine[]; values: Map<string, number[]>; summary: ReturnType<typeof summarize>; editable: boolean; budget: any; categories: { id: string; name: string }[]; onMsg: (m: string) => void }) {
  const groups: LineType[] = ['revenue', 'cogs', 'expense'];
  const timingText = (l: BudgetLine) => l.timing === 'yearly' ? `Yearly · accrued ${peso(sum(values.get(l.id) ?? []) / 12)}/mo · paid ${MONTH_LABEL[(l.pay_month ?? 1) - 1]}${l.accrual_schedule_id ? ' · accrual set up' : ''}` : l.timing === 'one_time' ? 'One-time' : 'Monthly';
  return (
    <div className="space-y-3">
      {editable && <ActionBar><PopupAction label="+ Add line" title="Add a budget line" variant="secondary">{(close) => <AddLine budgetId={budget.id} categories={categories} onDone={(m) => { close(); onMsg(m); }} />}</PopupAction></ActionBar>}
      <p className="text-xs text-slate-500">Amounts include the selected scenario&apos;s actions. {editable ? 'Edit a line to change its months, timing or note; the change applies to every scenario.' : ''}</p>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-xs tabular-nums">
          <thead><tr className="border-b bg-slate-50 text-left uppercase text-slate-500">
            <th className="sticky left-0 bg-slate-50 p-2">Line</th><th className="p-2">Timing</th><th className="p-2 text-right">{budget.base_year ?? 'Base'} actual</th><th className="p-2 text-right">Budget</th><th className="p-2 text-right">Change</th>
            {MONTH_LABEL.map((m) => <th key={m} className="p-2 text-right">{m}</th>)}{editable && <th className="p-2" />}</tr></thead>
          <tbody>
            {groups.map((g) => {
              const gl = lines.filter((l) => l.line_type === g);
              if (!gl.length) return null;
              const tot = g === 'revenue' ? summary.sales : g === 'cogs' ? summary.cogs : summary.expenses;
              const baseTot = gl.reduce((s, l) => s + sum(baseMonths(l)), 0);
              return [
                <tr key={g} className="border-b bg-slate-100 font-semibold"><td className="sticky left-0 bg-slate-100 p-2" colSpan={2}>{TYPE_LABEL[g]}</td><td className="p-2 text-right">{peso(baseTot)}</td><td className="p-2 text-right">{peso(sum(tot))}</td><td className="p-2 text-right">{pct(sum(tot), baseTot)}</td>
                  {tot.map((v, i) => <td key={i} className="p-2 text-right">{peso(v)}</td>)}{editable && <td />}</tr>,
                ...gl.map((l) => { const v = values.get(l.id) ?? []; const b = sum(baseMonths(l)); return (
                  <tr key={l.id} className="border-b align-top">
                    <td className="sticky left-0 bg-white p-2"><div className="font-medium">{l.account_name}</div>{l.notes && <div className="text-slate-500">{l.notes}</div>}</td>
                    <td className="p-2 text-slate-600">{timingText(l)}</td>
                    <td className="p-2 text-right text-slate-500">{peso(b)}</td><td className="p-2 text-right font-medium">{peso(sum(v))}</td>
                    <td className={`p-2 text-right ${sum(v) > b && l.line_type !== 'revenue' ? 'text-amber-700' : ''}`}>{pct(sum(v), b)}</td>
                    {v.map((x, i) => <td key={i} className="p-2 text-right">{peso(x)}</td>)}
                    {editable && <td className="p-2"><PopupAction label="Edit" title={`Edit ${l.account_name}`} variant="secondary" wide>{(close) => <LineForm line={l} onDone={(m) => { close(); onMsg(m); }} />}</PopupAction></td>}
                  </tr>); }),
              ];
            })}
            <tr className="border-t-2 font-semibold"><td className="sticky left-0 bg-white p-2" colSpan={3}>Gross profit</td><td className="p-2 text-right">{peso(sum(summary.gross))}</td><td />{summary.gross.map((v, i) => <td key={i} className="p-2 text-right">{peso(v)}</td>)}{editable && <td />}</tr>
            <tr className="font-semibold"><td className="sticky left-0 bg-white p-2" colSpan={3}>Net income</td><td className={`p-2 text-right ${sum(summary.net) < 0 ? 'text-red-700' : ''}`}>{peso(sum(summary.net))}</td><td />{summary.net.map((v, i) => <td key={i} className={`p-2 text-right ${v < 0 ? 'text-red-700' : ''}`}>{peso(v)}</td>)}{editable && <td />}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LineForm({ line, onDone }: { line: BudgetLine; onDone: (m: string) => void }) {
  const [name, setName] = useState(line.account_name);
  const [timing, setTiming] = useState(line.timing);
  const [annual, setAnnual] = useState(String(line.annual_amount ?? sum(lineMonths(line))));
  const [pay, setPay] = useState(line.pay_month ?? 1);
  const [months, setMonths] = useState(lineMonths(line).map(String));
  const [notes, setNotes] = useState(line.notes ?? '');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const baseM = baseMonths(line);
  const setAll = (fn: (v: number, i: number) => number) => setMonths(months.map((v, i) => String(Math.round(fn(Number(v) || 0, i) * 100) / 100)));
  const save = () => { setErr(''); start(async () => { try {
    await A.saveBudgetLineAction(line.id, { account_name: name, timing, annual_amount: Number(annual), pay_month: pay, months: months.map((v) => Number(v) || 0), notes });
    onDone(`${name} saved.`);
  } catch (e) { setErr(errorText(e)); } }); };
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2"><span className="mb-1 block text-slate-600">Line</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-slate-600">Timing</span>
          <select className="input" value={timing} onChange={(e) => setTiming(e.target.value as BudgetLine['timing'])}>
            <option value="monthly">Monthly (every month)</option><option value="yearly">Yearly — accrued 1/12 a month</option><option value="one_time">One-time</option>
          </select></label>
      </div>
      {timing === 'yearly' ? (
        <div className="grid gap-3 rounded bg-slate-50 p-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-slate-600">Yearly amount</span><input className="input" type="number" value={annual} onChange={(e) => setAnnual(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-slate-600">Paid in</span><select className="input" value={pay} onChange={(e) => setPay(Number(e.target.value))}>{MONTH_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <p className="text-xs text-slate-600 sm:self-end">The budget books {peso((Number(annual) || 0) / 12)} each month (accrual), so no month carries the whole cost. When the budget is approved, &quot;Create accrual schedules&quot; sets this up in Expenses.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="button-secondary" onClick={() => setAll((_, i) => baseM[i])}>Reset to this year&apos;s actuals</button>
            <button type="button" className="button-secondary" onClick={() => setAll((v) => v * 1.05)}>+5% every month</button>
            <button type="button" className="button-secondary" onClick={() => { const t = months.reduce((s, v) => s + (Number(v) || 0), 0); setAll(() => t / 12); }}>Spread evenly</button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {MONTH_LABEL.map((m, i) => <label key={m} className="block text-xs"><span className="mb-0.5 block text-slate-500">{m} <span className="text-slate-400">({peso(baseM[i])})</span></span>
              <input className="input" type="number" value={months[i]} onChange={(e) => setMonths(months.map((v, j) => (j === i ? e.target.value : v)))} /></label>)}
          </div>
          <p className="text-xs text-slate-500">Grey figures = this year&apos;s actual for the month. Total {peso(months.reduce((s, v) => s + (Number(v) || 0), 0))} vs {peso(sum(baseM))}.</p>
        </>
      )}
      <label className="block"><span className="mb-1 block text-slate-600">Why it changes (note)</span><input className="input" value={notes} placeholder="e.g. rent goes up 5% in July per the lease" onChange={(e) => setNotes(e.target.value)} /></label>
      {err && <p className="text-red-700">{err}</p>}
      <button className="button" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

function AddLine({ budgetId, categories, onDone }: { budgetId: string; categories: { id: string; name: string }[]; onDone: (m: string) => void }) {
  const [f, setF] = useState({ account_name: '', line_type: 'expense' as LineType, category_id: '', monthly: '' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="block"><span className="mb-1 block text-slate-600">Line name</span><input className="input" value={f.account_name} onChange={(e) => setF({ ...f, account_name: e.target.value })} /></label>
      <label className="block"><span className="mb-1 block text-slate-600">Type</span><select className="input" value={f.line_type} onChange={(e) => setF({ ...f, line_type: e.target.value as LineType })}><option value="expense">Expense</option><option value="revenue">Sales</option><option value="cogs">Cost of sales</option></select></label>
      {f.line_type === 'expense' && <label className="block"><span className="mb-1 block text-slate-600">Expense category (to track actuals)</span><select className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <label className="block"><span className="mb-1 block text-slate-600">Amount per month</span><input className="input" type="number" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></label>
      {err && <p className="text-red-700 sm:col-span-2">{err}</p>}
      <div className="sm:col-span-2"><button className="button" disabled={pending} onClick={() => { setErr(''); start(async () => { try { await A.addCustomBudgetLineAction(budgetId, { ...f, monthly: Number(f.monthly) || 0 }); onDone(`${f.account_name} added.`); } catch (e) { setErr(errorText(e)); } }); }}>Add line</button></div>
    </div>
  );
}

// --------------------------------------------------------------- scenarios --
function ScenariosTab({ budget, lines, scenarios, actions, scenarioId, setScenarioId, canEdit, canTrack, onMsg }: { budget: any; lines: BudgetLine[]; scenarios: any[]; actions: BudgetAction[]; scenarioId: string; setScenarioId: (id: string) => void; canEdit: boolean; canTrack: boolean; onMsg: (m: string) => void }) {
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const sc = scenarios.find((s) => s.id === scenarioId);
  const acts = actions.filter((a) => a.scenario_id === scenarioId);
  const impacts = useMemo(() => actionImpacts(lines, acts), [lines, acts]);
  const baseNet = sum(summarize(lines, applyScenario(lines, [])).net);
  const lineName = (id: string | null) => lines.find((l) => l.id === id)?.account_name ?? '—';
  const changeText = (a: BudgetAction) => `${Number(a.value) > 0 ? '+' : ''}${a.change_kind === 'percent' ? `${a.value}%` : `${peso(a.value)} a month`}`;
  const run = (f: () => Promise<unknown>, ok: string) => { setErr(''); start(async () => { try { await f(); onMsg(ok); } catch (e) { setErr(errorText(e)); } }); };
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm tabular-nums">
          <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">Scenario</th><th className="p-2 text-right">Actions</th><th className="p-2 text-right">Sales</th><th className="p-2 text-right">Expenses</th><th className="p-2 text-right">Net income</th><th className="p-2 text-right">vs Base</th></tr></thead>
          <tbody>{scenarios.map((s) => { const a = actions.filter((x) => x.scenario_id === s.id); const sm = summarize(lines, applyScenario(lines, a)); const net = sum(sm.net); return (
            <tr key={s.id} className={`cursor-pointer border-b ${s.id === scenarioId ? 'bg-blue-50' : ''}`} onClick={() => setScenarioId(s.id)}>
              <td className="p-2 font-medium">{s.name}{budget.approved_scenario_id === s.id && <span className="ml-2 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">approved</span>}{s.description && <div className="text-xs font-normal text-slate-500">{s.description}</div>}</td>
              <td className="p-2 text-right">{a.length}</td><td className="p-2 text-right">{peso(sum(sm.sales))}</td><td className="p-2 text-right">{peso(sum(sm.expenses))}</td>
              <td className={`p-2 text-right font-medium ${net < 0 ? 'text-red-700' : ''}`}>{peso(net)}</td><td className={`p-2 text-right ${net - baseNet < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{s.is_base ? '—' : `${net - baseNet >= 0 ? '+' : ''}${peso(net - baseNet)}`}</td>
            </tr>); })}</tbody>
        </table>
      </div>
      {canEdit && <ActionBar><PopupAction label="+ New scenario" title="New scenario" variant="secondary">{(close) => <ScenarioForm budgetId={budget.id} scenarios={scenarios} onDone={(id, m) => { close(); setScenarioId(id); onMsg(m); }} />}</PopupAction>
        {sc && !sc.is_base && <button className="button-secondary" disabled={pending} onClick={() => run(() => A.deleteScenarioAction(sc.id), `${sc.name} deleted.`)}>Delete &quot;{sc.name}&quot;</button>}</ActionBar>}
      {err && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}

      {sc && (
        <div className="space-y-3 rounded-lg border bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{sc.name}: actions</h3>
            <span className="text-sm text-slate-600">Net income {peso(baseNet)} (base) → <b>{peso(baseNet + Object.values(impacts).reduce((s, v) => s + v, 0))}</b></span>
          </div>
          {sc.is_base ? <p className="text-sm text-slate-500">The base is this year&apos;s actuals with your line edits, and has no actions. Make a scenario (e.g. Conservative, Growth) to plan actions on top of it.</p> : (
            <>
              {canEdit && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-500">Add an action:</span>
                {TEMPLATES.map((t) => <PopupAction key={t.label} label={t.label} title={`${sc.name}: ${t.label}`} variant="secondary" wide>{(close) => <ActionForm scenarioId={sc.id} lines={lines} preset={t.a} onDone={(m) => { close(); onMsg(m); }} />}</PopupAction>)}
                <PopupAction label="Other action" title={`${sc.name}: new action`} variant="secondary" wide>{(close) => <ActionForm scenarioId={sc.id} lines={lines} preset={{}} onDone={(m) => { close(); onMsg(m); }} />}</PopupAction>
              </div>}
              {acts.length === 0 ? <p className="text-sm text-slate-500">No actions yet. Each action is one concrete change: what changes, by how much, from which month, and who is responsible.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums">
                  <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Action</th><th className="p-2">Changes</th><th className="p-2">By</th><th className="p-2">Months</th><th className="p-2">Owner</th><th className="p-2">Status</th><th className="p-2 text-right">Net income effect</th><th className="p-2" /></tr></thead>
                  <tbody>{acts.map((a) => (
                    <tr key={a.id} className={`border-b ${a.status === 'dropped' ? 'text-slate-400 line-through' : ''}`}>
                      <td className="p-2 font-medium">{a.title}{a.notes && <div className="text-xs font-normal text-slate-500">{a.notes}</div>}</td>
                      <td className="p-2">{a.target === 'line' ? lineName(a.budget_line_id) : a.target === 'all_revenue' ? `All sales${a.cogs_follows && a.change_kind === 'percent' ? ' (cost of sales follows)' : ''}` : 'All expenses'}</td>
                      <td className="p-2">{changeText(a)}</td><td className="p-2">{MONTH_LABEL[a.start_month - 1]}–{MONTH_LABEL[a.end_month - 1]}</td><td className="p-2">{a.owner ?? '—'}</td>
                      <td className="p-2">{canEdit || canTrack ? <select className="rounded border px-1 py-0.5 text-xs" value={a.status} disabled={pending} onChange={(e) => run(() => A.setBudgetActionStatusAction(a.id, e.target.value as BudgetAction['status']), 'Status updated.')}>
                        {Object.entries(ACT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : ACT_STATUS[a.status]}</td>
                      <td className={`p-2 text-right font-medium ${(impacts[a.id] ?? 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{(impacts[a.id] ?? 0) >= 0 ? '+' : ''}{peso(impacts[a.id] ?? 0)}</td>
                      <td className="p-2">{canEdit && <div className="flex gap-1">
                        <PopupAction label="Edit" title={`Edit: ${a.title}`} variant="secondary" wide>{(close) => <ActionForm scenarioId={sc.id} lines={lines} action={a} preset={{}} onDone={(m) => { close(); onMsg(m); }} />}</PopupAction>
                        <button className="button-secondary" disabled={pending} onClick={() => run(() => A.deleteBudgetActionAction(a.id), 'Action removed.')}>Remove</button></div>}</td>
                    </tr>))}</tbody>
                </table></div>
              )}
              {canTrack && <p className="text-xs text-slate-500">The budget is approved: keep each action&apos;s status up to date (Planned → In progress → Done) so the monthly review shows what was actually carried out.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScenarioForm({ budgetId, scenarios, onDone }: { budgetId: string; scenarios: any[]; onDone: (id: string, m: string) => void }) {
  const [f, setF] = useState({ name: '', description: '', copy_from: '' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="block"><span className="mb-1 block text-slate-600">Name</span><input className="input" value={f.name} placeholder="e.g. Conservative, Growth" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="block"><span className="mb-1 block text-slate-600">Copy the actions of</span><select className="input" value={f.copy_from} onChange={(e) => setF({ ...f, copy_from: e.target.value })}><option value="">— start empty —</option>{scenarios.filter((s) => !s.is_base).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="block sm:col-span-2"><span className="mb-1 block text-slate-600">What this scenario assumes</span><input className="input" value={f.description} placeholder="e.g. sales 10% lower, no new hires" onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      {err && <p className="text-red-700 sm:col-span-2">{err}</p>}
      <div><button className="button" disabled={pending} onClick={() => { setErr(''); start(async () => { try { const id = await A.addScenarioAction(budgetId, { ...f, copy_from: f.copy_from || null }); onDone(id, `Scenario ${f.name} created.`); } catch (e) { setErr(errorText(e)); } }); }}>Create scenario</button></div>
    </div>
  );
}

function ActionForm({ scenarioId, lines, action, preset, onDone }: { scenarioId: string; lines: BudgetLine[]; action?: BudgetAction; preset: Partial<BudgetAction>; onDone: (m: string) => void }) {
  const src = { title: '', target: 'line', budget_line_id: '', change_kind: 'percent', value: 0, start_month: 1, end_month: 12, cogs_follows: true, owner: '', notes: '', ...preset, ...(action ?? {}) } as any;
  const [f, setF] = useState({ ...src, value: String(src.value ?? 0), budget_line_id: src.budget_line_id ?? '' });
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-slate-600">Action (what will be done)</span><input className="input" value={f.title} placeholder="e.g. Consolidate Lalamove deliveries to 2 trips a day" onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-slate-600">It changes</span>
          <select className="input" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="line">One budget line</option><option value="all_revenue">All sales</option><option value="all_expense">All expenses</option></select></label>
        {f.target === 'line' && <label className="block"><span className="mb-1 block text-slate-600">Budget line</span>
          <select className="input" value={f.budget_line_id} onChange={(e) => setF({ ...f, budget_line_id: e.target.value })}><option value="">Choose…</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.account_name}</option>)}</select></label>}
        <label className="block"><span className="mb-1 block text-slate-600">By</span>
          <div className="flex gap-2"><select className="input w-40" value={f.change_kind} onChange={(e) => setF({ ...f, change_kind: e.target.value })}><option value="percent">percent (%)</option><option value="amount">₱ per month</option></select>
            <input className="input" type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
          <span className="text-xs text-slate-500">Use a minus sign for a decrease.</span></label>
        <label className="block"><span className="mb-1 block text-slate-600">Months</span>
          <div className="flex items-center gap-2"><select className="input" value={f.start_month} onChange={(e) => setF({ ...f, start_month: Number(e.target.value) })}>{MONTH_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>to
            <select className="input" value={f.end_month} onChange={(e) => setF({ ...f, end_month: Number(e.target.value) })}>{MONTH_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div></label>
        {f.target === 'all_revenue' && f.change_kind === 'percent' && <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.cogs_follows} onChange={(e) => setF({ ...f, cogs_follows: e.target.checked })} /> Cost of sales moves by the same % (more volume = more goods bought). Untick for a price increase.</label>}
        <label className="block"><span className="mb-1 block text-slate-600">Owner (who does it)</span><input className="input" value={f.owner ?? ''} onChange={(e) => setF({ ...f, owner: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-slate-600">Note</span><input className="input" value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      {err && <p className="text-red-700">{err}</p>}
      <button className="button" disabled={pending} onClick={() => { setErr(''); start(async () => { try {
        await A.saveBudgetActionAction(action?.id ?? null, { scenario_id: scenarioId, title: f.title, target: f.target, budget_line_id: f.budget_line_id || null, change_kind: f.change_kind, value: Number(f.value) || 0,
          start_month: f.start_month, end_month: f.end_month, cogs_follows: f.cogs_follows, owner: f.owner, notes: f.notes });
        onDone(action ? 'Action saved.' : `Action added: ${f.title}.`);
      } catch (e) { setErr(errorText(e)); } }); }}>{action ? 'Save' : 'Add action'}</button>
    </div>
  );
}

// ----------------------------------------------------------- budget vs actual --
function ActualTab({ budget, lines, values, actuals, thisYear, scenarioName }: { budget: any; lines: BudgetLine[]; values: Map<string, number[]>; actuals: any[]; thisYear: number; scenarioName: string }) {
  const currentMonth = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(5, 7));
  const defaultThrough = budget.fiscal_year < thisYear ? 12 : budget.fiscal_year > thisYear ? 0 : Math.max(currentMonth - 1, 0);
  const [through, setThrough] = useState(defaultThrough);
  const act = new Map<string, number[]>();
  for (const a of actuals) { const k = a.line_key as string; if (!act.has(k)) act.set(k, Array(12).fill(0)); act.get(k)![Number(a.month) - 1] += Number(a.amount); }
  const rows = lines.map((l) => {
    const b = values.get(l.id) ?? Array(12).fill(0); const a = l.line_key ? act.get(l.line_key) ?? Array(12).fill(0) : null;
    const bY = sum(b.slice(0, through)); const aY = a ? sum(a.slice(0, through)) : 0; const full = sum(b);
    const forecast = a ? aY + sum(b.slice(through)) : full;
    const over = l.line_type === 'revenue' ? aY < bY * 0.9 : aY > bY * 1.1;
    return { l, bY, aY, full, forecast, tracked: !!a, over: a ? over && bY !== 0 : false };
  });
  const tot = (t: LineType, k: 'bY' | 'aY' | 'full' | 'forecast') => rows.filter((r) => r.l.line_type === t).reduce((s, r) => s + r[k], 0);
  const net = (k: 'bY' | 'aY' | 'full' | 'forecast') => tot('revenue', k) - tot('cogs', k) - tot('expense', k);
  return (
    <div className="space-y-3">
      {budget.fiscal_year > thisYear ? <p className="rounded border bg-white p-3 text-sm text-slate-600">This budget is for {budget.fiscal_year}; actuals appear here from January {budget.fiscal_year}, read automatically from posted sales, expenses and payroll.</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-600">Year to date through</span>
            <select className="input w-32" value={through} onChange={(e) => setThrough(Number(e.target.value))}>{MONTH_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <span className="text-xs text-slate-500">Budget = &quot;{scenarioName}&quot; scenario. Forecast = actual to date + remaining budget. Flagged: expenses more than 10% over, sales more than 10% under.</span></div>
          <div className="overflow-x-auto rounded border bg-white">
            <table className="w-full text-sm tabular-nums">
              <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">Line</th><th className="p-2 text-right">Budget to date</th><th className="p-2 text-right">Actual to date</th><th className="p-2 text-right">Variance</th><th className="p-2 text-right">%</th><th className="p-2 text-right">Full-year budget</th><th className="p-2 text-right">Year-end forecast</th></tr></thead>
              <tbody>
                {(['revenue', 'cogs', 'expense'] as LineType[]).map((g) => [
                  <tr key={g} className="border-b bg-slate-100 font-semibold"><td className="p-2">{TYPE_LABEL[g]}</td><td className="p-2 text-right">{peso(tot(g, 'bY'))}</td><td className="p-2 text-right">{peso(tot(g, 'aY'))}</td><td className="p-2 text-right">{peso(tot(g, 'aY') - tot(g, 'bY'))}</td><td className="p-2 text-right">{pct(tot(g, 'aY'), tot(g, 'bY'))}</td><td className="p-2 text-right">{peso(tot(g, 'full'))}</td><td className="p-2 text-right">{peso(tot(g, 'forecast'))}</td></tr>,
                  ...rows.filter((r) => r.l.line_type === g).map((r) => (
                    <tr key={r.l.id} className={`border-b ${r.over ? 'bg-amber-50' : ''}`}>
                      <td className="p-2">{r.l.account_name}{r.over && <span className="ml-2 rounded bg-amber-200 px-1.5 text-xs text-amber-900">{g === 'revenue' ? 'under' : 'over'}</span>}{!r.tracked && <span className="ml-2 text-xs text-slate-400">no actuals linked</span>}</td>
                      <td className="p-2 text-right">{peso(r.bY)}</td><td className="p-2 text-right">{r.tracked ? peso(r.aY) : '—'}</td><td className="p-2 text-right">{r.tracked ? peso(r.aY - r.bY) : '—'}</td><td className="p-2 text-right">{r.tracked ? pct(r.aY, r.bY) : '—'}</td>
                      <td className="p-2 text-right">{peso(r.full)}</td><td className="p-2 text-right">{peso(r.forecast)}</td>
                    </tr>)),
                ])}
                <tr className="border-t-2 font-semibold"><td className="p-2">Net income</td><td className="p-2 text-right">{peso(net('bY'))}</td><td className="p-2 text-right">{peso(net('aY'))}</td><td className="p-2 text-right">{peso(net('aY') - net('bY'))}</td><td className="p-2 text-right">{pct(net('aY'), net('bY'))}</td><td className="p-2 text-right">{peso(net('full'))}</td><td className="p-2 text-right">{peso(net('forecast'))}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Guide() {
  const steps: [string, string][] = [
    ['Budget per store', 'Make one budget for each store (pick it in "Acting as"). Each store\'s sales and costs behave differently; the dashboard adds them up.'],
    ['Start from actuals', 'Use "New budget from actuals" in October–November. Every expense you had this year becomes a line, filled month by month, so nothing is forgotten.'],
    ['Change only what you know', 'Edit a line only when something will really differ next year (a lease increase, a new salary rate, a price change) and write the reason in its note. Leave the rest as this year.'],
    ['Accrue yearly costs', 'Set permits, insurance, 13th month and other once-a-year costs to "Yearly". The budget books 1/12 each month so no month looks like a loss, and still shows the month you pay.'],
    ['Plan scenarios as actions', 'Keep the Base, then make 2–3 scenarios (e.g. Conservative: sales −10%; Growth: +10% sales with one extra staff). Each action has a line, an amount, a start month and an owner, and shows what it does to net income.'],
    ['Prepare, review, approve before January', 'Finance prepares and reviews; the Business Admin approves the budget with one scenario. After approval the budget is fixed: changes need a new version, so the approved one stays the yardstick.'],
    ['Set up the accruals', 'After approval click "Create accrual schedules" so the yearly lines are booked monthly in Expenses automatically.'],
    ['Review every month', 'In the first week of the month open "Budget vs actual": look at the flagged lines (expenses over 10%, sales under 10%), ask why, and update each action\'s status.'],
    ['Re-forecast mid-year', 'The year-end forecast column updates itself (actual to date + remaining budget). If it is far off by June–July, make a new version for the second half.'],
  ];
  return (
    <div className="space-y-3 rounded-lg border bg-white p-4 text-sm">
      <h3 className="font-semibold">How to budget in the app</h3>
      <ol className="space-y-2">{steps.map(([t, d], i) => <li key={t} className="flex gap-3"><span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800">{i + 1}</span><div><div className="font-medium">{t}</div><div className="text-slate-600">{d}</div></div></li>)}</ol>
    </div>
  );
}
