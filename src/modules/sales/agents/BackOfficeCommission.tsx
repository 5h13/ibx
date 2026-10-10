'use client';
// Build 93 — Back Office Commission: the month's key figures, each plan (manager by category, sales staff,
// share of an agent's net, department pools), payout per person, true bottomline, tithes and offering;
// the set-up (rates, thresholds, plans and their people) and closing the month (Business Admin).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { boCloseAction, boSetupAction } from './commissionActions';

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<string, string> = { manager: 'Manager (by category)', sales_staff: 'Sales staff (store sales threshold)', agent_share: 'Share of an agent’s net sales', department: 'Department pool (bottomline threshold)' };
type Emp = { id: string; first_name: string | null; last_name: string | null; department: string | null; position_title: string | null };
const empName = (e: Emp) => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();

function Setup({ data, employees, agents, categories, onDone }: { data: any; employees: Emp[]; agents: { id: string; agent_code: string; name: string }[]; categories: string[]; onDone: (m: string) => void }) {
  const s = data.settings ?? {};
  const [f, setF] = useState({ sales_staff_threshold: String(s.sales_staff_threshold ?? 1500000), back_office_threshold: String(s.back_office_threshold ?? 300000), tithes_rate: String(s.tithes_rate ?? 10), offering_multiplier: String(s.offering_multiplier ?? 100) });
  const [rates, setRates] = useState<{ category: string; rate: string }[]>((data.category_rates ?? []).map((r: any) => ({ category: r.category, rate: String(r.rate) })));
  const [plans, setPlans] = useState<any[]>((data.plan_setup ?? []).map((p: any) => ({ ...p, rate: String(p.rate ?? 0), threshold: p.threshold == null ? '' : String(p.threshold) })));
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const setPlan = (i: number, patch: any) => setPlans(plans.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const num = (k: keyof typeof f, label: string) => <label className="block">{label}<input className="input mt-1" type="number" step="any" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="space-y-5 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        {num('sales_staff_threshold', 'Sales staff: store gross over (₱)')}{num('back_office_threshold', 'Departments: bottomline over (₱)')}
        {num('tithes_rate', 'Tithes (% of true bottomline)')}{num('offering_multiplier', 'Offering (% of tithes)')}
      </div>
      <div>
        <div className="mb-1 font-medium">Manager rates per category <span className="font-normal text-slate-500">(% of category gross less its share of expenses + agent commission)</span></div>
        <div className="grid gap-1 sm:grid-cols-2">{rates.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select className="input" value={r.category} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}>
              <option value="">Category…</option>{categories.map((c) => <option key={c} value={c.toLowerCase()}>{c}</option>)}{r.category && !categories.some((c) => c.toLowerCase() === r.category) && <option value={r.category}>{r.category}</option>}
            </select>
            <input className="input w-24" type="number" step="any" value={r.rate} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
            <button type="button" className="text-xs text-red-700" onClick={() => setRates(rates.filter((_, j) => j !== i))}>✕</button>
          </div>))}</div>
        <button type="button" className="button-secondary mt-1 text-xs" onClick={() => setRates([...rates, { category: '', rate: '1' }])}>+ Category rate</button>
      </div>
      <div>
        <div className="mb-1 font-medium">Plans and who receives them <span className="font-normal text-slate-500">(an amount is split equally among the people on the plan)</span></div>
        <div className="space-y-2">{plans.map((p, i) => p.delete ? null : (
          <div key={i} className="space-y-2 rounded border p-2">
            <div className="flex flex-wrap gap-2">
              <input className="input w-48" placeholder="Name (e.g. Logistics)" value={p.label} onChange={(e) => setPlan(i, { label: e.target.value })} />
              <select className="input" value={p.kind} onChange={(e) => setPlan(i, { kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              {p.kind !== 'manager' && <label className="flex items-center gap-1">rate %<input className="input w-20" type="number" step="any" value={p.rate} onChange={(e) => setPlan(i, { rate: e.target.value })} /></label>}
              {(p.kind === 'sales_staff' || p.kind === 'department') && <label className="flex items-center gap-1">own threshold ₱<input className="input w-32" type="number" step="any" placeholder="store default" value={p.threshold} onChange={(e) => setPlan(i, { threshold: e.target.value })} /></label>}
              {p.kind === 'agent_share' && <select className="input" value={p.agent_id ?? ''} onChange={(e) => setPlan(i, { agent_id: e.target.value })}><option value="">Agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.agent_code})</option>)}</select>}
              <label className="flex items-center gap-1"><input type="checkbox" checked={p.active !== false} onChange={(e) => setPlan(i, { active: e.target.checked })} /> active</label>
              <button type="button" className="text-xs text-red-700" onClick={() => setPlan(i, { delete: true })}>Remove plan</button>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{employees.map((e) => (
              <label key={e.id} className="flex items-center gap-1"><input type="checkbox" checked={(p.members ?? []).includes(e.id)}
                onChange={(ev) => setPlan(i, { members: ev.target.checked ? [...(p.members ?? []), e.id] : (p.members ?? []).filter((x: string) => x !== e.id) })} />{empName(e)}{e.department ? <span className="text-slate-400"> · {e.department}</span> : null}</label>))}
              {!employees.length && <span className="text-slate-500">No employees in this store yet (Admin → Employees).</span>}</div>
          </div>))}</div>
        <button type="button" className="button-secondary mt-2 text-xs" onClick={() => setPlans([...plans, { kind: 'department', label: '', rate: '1', threshold: '', members: [], active: true, sort: plans.length + 1 }])}>+ Plan</button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending} onClick={() => start(async () => {
        setError('');
        try {
          await boSetupAction({
            settings: { sales_staff_threshold: Number(f.sales_staff_threshold), back_office_threshold: Number(f.back_office_threshold), tithes_rate: Number(f.tithes_rate), offering_multiplier: Number(f.offering_multiplier) },
            category_rates: rates.filter((r) => r.category && r.rate !== '').map((r) => ({ category: r.category, rate: Number(r.rate) })),
            plans: plans.map((p, i) => ({ id: p.id ?? null, delete: !!p.delete, kind: p.kind, label: p.label, rate: Number(p.rate || 0), threshold: p.threshold === '' ? null : Number(p.threshold),
              agent_id: p.agent_id || null, active: p.active !== false, sort: i + 1, members: p.members ?? [] })),
          });
          onDone('Back office commission set-up saved.');
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Save set-up'}</button>
    </div>
  );
}

export function BackOfficeCommission({ data: d, month, thisMonth, canManage, employees, agents, categories }: { data: any; month: string; thisMonth: string; canManage: boolean; employees: Emp[];
  agents: { id: string; agent_code: string; name: string }[]; categories: string[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const ended = month < thisMonth;
  const close = () => start(async () => {
    if (!(await dialog.confirm(`Close back office commission for ${month}? Total ${peso(d.back_office_total)}; each person's amount becomes an approved Commission expense for Finance to pay.`))) return;
    try { const r = await boCloseAction(`${month}-01`); setMessage(`${month} closed — ${peso(r.total)} for ${r.people} people.`); router.refresh(); } catch (e) { setMessage(errorText(e)); }
  });
  const tile = (label: string, v: unknown, hint?: string) => <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold">{peso(v)}</div>{hint && <div className="text-xs text-slate-500">{hint}</div>}</div>;
  const s = d.settings ?? {};
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Back Office Commission</h2>
        <p className="mt-1 text-sm text-slate-500">Manager, sales staff, agent-share and department commissions from the store&apos;s own figures for the month; rates and people are set per store. {d.closed ? `Closed ${new Date(d.closed_at).toLocaleDateString('en-PH')}.` : 'Open — figures move until the month is closed.'}</p>
      </div>
      <ActionBar>
        <form method="get" className="flex items-end gap-2 text-sm"><label className="block">Month<input className="input mt-1" type="month" name="m" defaultValue={month} /></label><button className="button-secondary">Show</button></form>
        {canManage && <PopupAction label="Set-up (rates, plans, people)" title="Back office commission set-up (this store)" variant="secondary" wide notice={message}>{(c) => <Setup data={d} employees={employees} agents={agents} categories={categories} onDone={(m) => { setMessage(m); c(); router.refresh(); }} />}</PopupAction>}
        {canManage && ended && !d.closed && <button type="button" className="button" disabled={pending} onClick={close}>Close month</button>}
      </ActionBar>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile('Total sales (gross, paid & unpaid)', d.overall_gross)}
        {tile('Store sales (paid, own sales)', d.store_paid_gross)}
        {tile('Net sales (gross profit)', d.net_sales)}
        {tile('Monthly expenses', d.monthly_expenses, 'expenses, payroll, accruals — without commission')}
        {tile('Bottomline before BO commission', d.bottomline_before)}
        {tile('Agent commission (month)', d.agent_commission)}
        {tile('Back office commission', d.back_office_total)}
        {tile('True bottomline', d.true_bottomline)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tile(`Tithes (${Number(s.tithes_rate ?? 10)}% of true bottomline)`, d.tithes)}
        {tile(`Offering (${Number(s.offering_multiplier ?? 100)}% of tithes)`, d.offering)}
      </div>
      <section className="space-y-2">
        <h3 className="font-semibold">Plans</h3>
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Plan</th><th className="p-2 text-right">Basis</th><th className="p-2 text-right">Rate</th><th className="p-2">Qualifies</th><th className="p-2 text-right">Amount</th><th className="p-2">People</th></tr></thead>
            <tbody>
              {(d.plans ?? []).map((p: any) => (
                <tr key={p.plan_id} className="border-t align-top">
                  <td className="p-2 font-medium">{p.label}<div className="text-xs font-normal text-slate-500">{KIND[p.kind]}{p.agent ? ` · ${p.agent}` : ''}{p.threshold != null ? ` · over ${peso(p.threshold)}` : ''}{p.pool != null ? ` · pool ${peso(p.pool)}` : ''}</div></td>
                  <td className="p-2 text-right">{peso(p.store_paid != null && !p.qualifies ? p.store_paid : p.basis)}</td>
                  <td className="p-2 text-right">{p.kind === 'manager' ? 'by category' : `${Number(p.rate)}%`}</td>
                  <td className="p-2 text-xs">{p.qualifies ? 'yes' : 'no'}</td>
                  <td className="p-2 text-right font-medium">{peso(p.amount)}</td>
                  <td className="p-2 text-xs">{p.unassigned ? <span className="text-amber-700">no one assigned — not paid</span> : (p.members ?? []).map((m: any) => <div key={m.employee_id}>{m.name}: {peso(m.amount)}</div>)}</td>
                </tr>
              ))}
              {!(d.plans ?? []).length && <tr><td colSpan={6} className="p-4 text-center text-slate-500">No plans yet. {canManage ? 'Open Set-up to add the manager, sales staff, agent-share and department plans.' : ''}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="font-semibold">Payout per person</h3>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-sm">
              <tbody>{(d.payouts ?? []).map((x: any) => <tr key={x.employee_id} className="border-t"><td className="p-2">{x.name}<div className="text-xs text-slate-500">{x.detail}</div></td><td className="p-2 text-right font-medium">{peso(x.amount)}</td>
                <td className="p-2 text-xs">{d.closed ? (x.expense_status ?? '—') : ''}</td></tr>)}
                {!(d.payouts ?? []).length && <tr><td className="p-4 text-center text-slate-500">No payouts.</td></tr>}</tbody>
            </table>
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold">Manager — by category</h3>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500"><tr><th className="p-2">Category</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Allocated</th><th className="p-2 text-right">Basis</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Commission</th></tr></thead>
              <tbody>{(d.categories ?? []).map((c: any) => <tr key={c.category} className="border-t"><td className="p-2 capitalize">{c.category}</td><td className="p-2 text-right">{peso(c.gross)}</td><td className="p-2 text-right">{peso(c.allocated)}</td>
                <td className="p-2 text-right">{peso(c.basis)}</td><td className="p-2 text-right">{Number(c.rate)}%</td><td className="p-2 text-right font-medium">{peso(c.commission)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
      <p className="text-xs text-slate-500">Allocation pool for the manager = monthly expenses + agent commission, shared by each category&apos;s share of gross sales. Close the agents&apos; commission for the month first (Agent Commissions).</p>
    </div>
  );
}
