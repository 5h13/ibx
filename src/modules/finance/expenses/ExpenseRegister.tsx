'use client';
import { Form } from '@/core/ui/Form';
// Build 80 (EXP-01): Finance → All expenses.
import { useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { StatusBadge } from '@/core/utils/statusBadge';
import {
  saveCategoryAction, setCategoryAction, postExpenseAction, payExpenseAction, createAccrualAction, cancelScheduleAction, monthRunAction,
  type RegisterRow, type ScheduleRow, type MonthRunRow,
} from './actions';

type Cat = { id: string; code: string; name: string; description: string | null; gl_account_code: string; active: boolean };
type Bank = { id: string; account_code: string; account_name: string };
type Account = { account_code: string; account_name: string };
const peso = (v: unknown) => `₱${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<string, string> = { prepaid: 'Prepaid (spread)', accrual: 'Accrual (set aside)', thirteenth: '13th month' };

export function ExpenseRegister({ from, to, rows, loadError, categories, banks, schedules, accounts, canFinance }: {
  from: string; to: string; rows: RegisterRow[]; loadError: string; categories: Cat[]; banks: Bank[]; schedules: ScheduleRow[]; accounts: Account[]; canFinance: boolean;
}) {
  const [tab, setTab] = useState<'all' | 'categories' | 'spread'>('all');
  const tabs: [typeof tab, string][] = [['all', 'All expenses'], ['categories', 'Categories'], ['spread', 'Spread & accruals']];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">All expenses</h2>
        <p className="text-sm text-slate-500 mt-1">Every department&apos;s expenses. Finance maps suggested categories, posts approved expenses to the books, records payments and runs the monthly spread.</p>
      </div>
      {loadError && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{loadError}</div>}
      <div className="flex gap-1 border-b">
        {tabs.map(([k, label]) => <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-slate-900 font-semibold' : 'border-transparent text-slate-500'}`}>{label}</button>)}
      </div>
      {tab === 'all' && <AllExpenses from={from} to={to} rows={rows} categories={categories} banks={banks} schedules={schedules} accounts={accounts} canFinance={canFinance} />}
      {tab === 'categories' && <Categories categories={categories} accounts={accounts} />}
      {tab === 'spread' && <Spread schedules={schedules} categories={categories} canFinance={canFinance} />}
    </div>
  );
}

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const run = (fn: () => Promise<unknown>, ok?: () => void) => start(async () => { setMsg(''); try { await fn(); ok?.(); } catch (e) { setMsg(errorText(e) || 'Action failed.'); } });
  return { pending, msg, setMsg, run };
}

function AllExpenses({ from, to, rows, categories, banks, schedules, accounts, canFinance }: { from: string; to: string; rows: RegisterRow[]; categories: Cat[]; banks: Bank[]; schedules: ScheduleRow[]; accounts: Account[]; canFinance: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ dept: '', cat: '', status: '', q: '' });
  const [modal, setModal] = useState<{ kind: 'map' | 'post' | 'pay'; row: RegisterRow } | null>(null);
  const shown = useMemo(() => rows.filter((r) =>
    (!f.dept || r.section_code === f.dept) &&
    (!f.cat || (f.cat === 'none' ? !r.category_id : f.cat === 'suggested' ? !!r.suggested_category : r.category_id === f.cat)) &&
    (!f.status || r.status === f.status) &&
    (!f.q || `${r.description} ${r.vendor || ''} ${r.supplier_name || ''} ${r.reference_no || ''}`.toLowerCase().includes(f.q.toLowerCase()))), [rows, f]);
  const total = (st?: string[]) => shown.filter((r) => !st || st.includes(r.status)).reduce((n, r) => n + Number(r.amount), 0);
  const depts = Array.from(new Map(rows.map((r) => [r.section_code, r.section_name])).entries());

  const exportCsv = () => {
    const head = ['Date', 'Department', 'Description', 'Category', 'Suggested category', 'Account', 'Vendor', 'Supplier', 'Reference', 'Amount', 'Status', 'Yearly', 'Spread months', 'Prepared by', 'Journal'];
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head, ...shown.map((r) => [r.expense_date, r.section_name, r.description, r.category_name, r.suggested_category, r.gl_account_code, r.vendor, r.supplier_name, r.reference_no, r.amount, r.status, r.is_yearly ? 'yes' : '', r.spread_months, r.prepared_by_name, r.journal_number])];
    const blob = new Blob([lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `expenses_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <Form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); router.push(`/finance/expenses/register?from=${fd.get('from')}&to=${fd.get('to')}`); }}>
        <Field label="From"><input className="input" type="date" name="from" defaultValue={from} required /></Field>
        <Field label="To"><input className="input" type="date" name="to" defaultValue={to} required /></Field>
        <button className="button-secondary">Show period</button>
        <span className="mx-2" />
        <Field label="Department"><select className="input" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}><option value="">All</option>{depts.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
        <Field label="Category"><select className="input" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}><option value="">All</option><option value="suggested">With a suggestion</option><option value="none">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{['draft', 'prepared', 'reviewed', 'approved', 'posted', 'paid'].map((s) => <option key={s} value={s}>{s === 'approved' ? 'approved — to post' : s}</option>)}</select></Field>
        <Field label="Search"><input className="input" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="description, vendor, reference" /></Field>
        <button type="button" className="button-secondary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
      </Form>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile title={`${shown.length} expense(s)`} value={total()} />
        <Tile title="In the departments" value={total(['draft', 'prepared', 'reviewed'])} />
        <Tile title="Approved — to post" value={total(['approved'])} />
        <Tile title="Posted — to pay" value={total(['posted'])} />
        <Tile title="Paid" value={total(['paid'])} />
      </div>
      <div className="rounded-xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Date</th><th className="p-3">Department</th><th className="p-3">Expense</th><th className="p-3">Category</th><th className="p-3">Vendor</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b last:border-0 align-top">
                <td className="p-3 whitespace-nowrap">{r.expense_date}</td>
                <td className="p-3">{r.section_name}</td>
                <td className="p-3"><div className="font-medium">{r.description}</div><div className="text-xs text-slate-500">{[r.prepared_by_name, r.reference_no, r.is_yearly ? `yearly · ${r.spread_months || 12} months` : null, r.journal_number].filter(Boolean).join(' · ')}</div></td>
                <td className="p-3">{r.category_name ? <>{r.category_name}<div className="text-xs text-slate-400">{r.gl_account_code}</div></> : r.suggested_category ? <span className="text-amber-700">Suggested: {r.suggested_category}</span> : <span className="text-slate-400">—</span>}</td>
                <td className="p-3">{r.supplier_name || r.vendor || '—'}</td>
                <td className="p-3 text-right font-medium whitespace-nowrap">{peso(r.amount)}</td>
                <td className="p-3"><StatusBadge status={r.status as any} /></td>
                <td className="p-3 space-x-2 whitespace-nowrap">
                  {!['posted', 'paid'].includes(r.status) && (r.suggested_category || !r.category_id) && <button className="link" onClick={() => setModal({ kind: 'map', row: r })}>{r.suggested_category ? 'Map suggestion…' : 'Set category…'}</button>}
                  {canFinance && r.status === 'approved' && <button className="link text-blue-700" onClick={() => setModal({ kind: 'post', row: r })}>Post…</button>}
                  {canFinance && r.status === 'posted' && <button className="link text-green-700" onClick={() => setModal({ kind: 'pay', row: r })}>Pay…</button>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No expenses in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      {modal?.kind === 'map' && <MapModal row={modal.row} categories={categories} accounts={accounts} close={() => setModal(null)} />}
      {modal?.kind === 'post' && <PostModal row={modal.row} categories={categories} schedules={schedules} close={() => setModal(null)} />}
      {modal?.kind === 'pay' && <PayModal row={modal.row} banks={banks} close={() => setModal(null)} />}
    </div>
  );
}

function MapModal({ row, categories, accounts, close }: { row: RegisterRow; categories: Cat[]; accounts: Account[]; close: () => void }) {
  const { pending, msg, run } = useRun();
  const [mode, setMode] = useState<'existing' | 'new'>(row.suggested_category ? 'new' : 'existing');
  return (
    <Modal title={row.suggested_category ? `Suggested category: “${row.suggested_category}”` : 'Set category'} sub={`${row.section_name} — ${row.description} — ${peso(row.amount)}`} close={close} msg={msg}>
      <div className="flex gap-4 text-sm">
        {row.suggested_category && <label className="flex items-center gap-1"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Add it as a new category</label>}
        <label className="flex items-center gap-1"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Use an existing category</label>
      </div>
      {mode === 'existing' ? (
        <Form className="space-y-3" action={(fd) => run(() => setCategoryAction(row.id, String(fd.get('category_id'))), close)}>
          <Field label="Category"><select className="input" name="category_id" required defaultValue=""><option value="">Select</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.gl_account_code})</option>)}</select></Field>
          <button className="button" disabled={pending}>Save</button>
        </Form>
      ) : (
        <Form className="space-y-3" action={(fd) => { fd.set('expense_id', row.id); run(() => saveCategoryAction(fd), close); }}>
          <Field label="Category name"><input className="input" name="name" defaultValue={row.suggested_category || ''} required /></Field>
          <Field label="Expense account"><AccountSelect accounts={accounts} /></Field>
          <button className="button" disabled={pending}>Add category and use it</button>
        </Form>
      )}
    </Modal>
  );
}

function PostModal({ row, categories, schedules, close }: { row: RegisterRow; categories: Cat[]; schedules: ScheduleRow[]; close: () => void }) {
  const { pending, msg, run } = useRun();
  const [spread, setSpread] = useState<number>(row.is_yearly ? row.spread_months || 12 : 1);
  const open = schedules.filter((s) => s.status === 'active' && (s.kind === 'accrual' || s.kind === 'thirteenth'));
  return (
    <Modal title="Post expense to the books" sub={`${row.section_name} — ${row.description} — ${peso(row.amount)}`} close={close} msg={msg}>
      <Form className="space-y-3" action={(fd) => { fd.set('expense_id', row.id); run(() => postExpenseAction(fd), close); }}>
        <Field label="Category (sets the expense account)">
          <select className="input" name="category_id" defaultValue={row.category_id || ''} required>
            <option value="">{row.suggested_category ? `Choose — suggested: ${row.suggested_category}` : 'Choose'}</option>
            {categories.filter((c) => c.active || c.id === row.category_id).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.gl_account_code})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Spread over (months)"><input className="input" type="number" name="spread_months" min={1} max={60} value={spread} onChange={(e) => setSpread(Number(e.target.value) || 1)} /></Field>
          {spread > 1 && <Field label="Starting month"><input className="input" type="month" name="start_month" defaultValue={row.expense_date.slice(0, 7)} /></Field>}
        </div>
        {spread > 1
          ? <p className="text-xs text-slate-500">Goes to Prepaid Expenses now; {peso(Number(row.amount) / spread)} moves to expense each month at the month-end run.</p>
          : open.length > 0 && (
            <Field label="Charge against an accrual (optional)">
              <select className="input" name="accrual_id" defaultValue=""><option value="">No — a normal expense</option>{open.map((s) => <option key={s.id} value={s.id}>{s.description} — set aside {peso(s.booked)}</option>)}</select>
            </Field>
          )}
        <p className="text-xs text-slate-500">Posting books it: debit the expense (or prepaid) account, credit Accounts Payable. It then counts in the dashboards.</p>
        <button className="button" disabled={pending}>{pending ? 'Posting…' : 'Post'}</button>
      </Form>
    </Modal>
  );
}

function PayModal({ row, banks, close }: { row: RegisterRow; banks: Bank[]; close: () => void }) {
  const { pending, msg, run } = useRun();
  return (
    <Modal title="Record payment" sub={`${row.description} — ${peso(row.amount)}`} close={close} msg={msg}>
      <Form className="space-y-3" action={(fd) => { fd.set('expense_id', row.id); run(() => payExpenseAction(fd), close); }}>
        <Field label="Paid from"><select className="input" name="bank_account_id" required defaultValue=""><option value="">Select account</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.account_code} — {b.account_name}</option>)}</select></Field>
        <Field label="Payment date"><input className="input" type="date" name="payment_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
        <button className="button" disabled={pending}>Mark paid</button>
      </Form>
    </Modal>
  );
}

function Categories({ categories, accounts }: { categories: Cat[]; accounts: Account[] }) {
  const { pending, msg, run } = useRun();
  const [edit, setEdit] = useState<Cat | 'new' | null>(null);
  const name = (code: string) => accounts.find((a) => a.account_code === code)?.account_name || '';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm text-slate-500">Departments choose from these. Each category posts to its expense account.</p><button className="button" onClick={() => setEdit('new')}>+ Add category</button></div>
      <div className="rounded-xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Category</th><th className="p-3">Expense account</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{c.name}</div>{c.description && <div className="text-xs text-slate-500">{c.description}</div>}</td><td className="p-3">{c.gl_account_code} {name(c.gl_account_code)}</td><td className="p-3">{c.active ? 'Active' : <span className="text-slate-400">Inactive</span>}</td><td className="p-3"><button className="link" onClick={() => setEdit(c)}>Edit</button></td></tr>
            ))}
            {categories.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No categories yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Add category' : `Edit ${edit.name}`} close={() => setEdit(null)} msg={msg}>
          <Form className="space-y-3" action={(fd) => { if (edit !== 'new') fd.set('id', edit.id); run(() => saveCategoryAction(fd), () => setEdit(null)); }}>
            <Field label="Name"><input className="input" name="name" defaultValue={edit === 'new' ? '' : edit.name} required /></Field>
            <Field label="Description"><input className="input" name="description" defaultValue={edit === 'new' ? '' : edit.description || ''} /></Field>
            <Field label="Expense account"><AccountSelect accounts={accounts} value={edit === 'new' ? '5200' : edit.gl_account_code} /></Field>
            {edit !== 'new' && <label className="flex items-center gap-2 text-sm"><input type="hidden" name="active" value="false" /><input type="checkbox" name="active" defaultChecked={edit.active} /> Active (inactive categories are hidden from the departments)</label>}
            <button className="button" disabled={pending}>Save</button>
          </Form>
        </Modal>
      )}
    </div>
  );
}

function Spread({ schedules, categories, canFinance }: { schedules: ScheduleRow[]; categories: Cat[]; canFinance: boolean }) {
  const dialog = useDialog();
  const { pending, msg, run } = useRun();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [result, setResult] = useState<MonthRunRow[] | null>(null);
  const [newAccrual, setNewAccrual] = useState(false);
  return (
    <div className="space-y-4">
      {msg && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{msg}</div>}
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <h3 className="font-semibold">Month-end run</h3>
        <p className="text-sm text-slate-500">Books every month that is due and not booked yet, up to the month chosen: 1/N of each prepaid cost to expense, 1/N of each accrual set aside, and 1/12 of the month&apos;s basic pay (approved or posted payroll) set aside for the 13th month. Running it again books only what changed. Run it after payroll is approved.</p>
        {canFinance ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Up to month"><input className="input" type="month" value={month} max={thisMonth} onChange={(e) => setMonth(e.target.value)} /></Field>
            <button className="button" disabled={pending} onClick={() => run(async () => setResult(await monthRunAction(month)))}>{pending ? 'Running…' : 'Run month-end'}</button>
          </div>
        ) : <p className="text-sm text-amber-700">A Finance approver runs the month-end.</p>}
        {result && (result.length === 0
          ? <p className="text-sm text-slate-500">Nothing was due — everything up to {month} is already booked.</p>
          : <table className="w-full text-sm"><thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Item</th><th>Month</th><th className="text-right">Amount</th><th className="pl-3">Journal</th></tr></thead>
              <tbody>{result.map((r, i) => <tr key={i} className="border-b last:border-0"><td className="py-1">{r.schedule}</td><td>{r.period.slice(0, 7)}</td><td className="text-right">{peso(r.amount)}</td><td className="pl-3">{r.journal_number}</td></tr>)}</tbody></table>)}
      </section>
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Prepaid costs and accruals</h3>{canFinance && <button className="button-secondary" onClick={() => setNewAccrual(true)}>+ New accrual</button>}</div>
        <p className="text-xs text-slate-500">Prepaid costs come from expenses posted &quot;spread over N months&quot;. Accruals are year-end costs (bonuses, audit fee …) set aside monthly; post the actual bill against the accrual to clear it. The 13th month appears after the first month-end run of the year.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-slate-500"><th className="p-2">Item</th><th className="p-2">Type</th><th className="p-2">From</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Booked</th><th className="p-2 text-right">Remaining</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="p-2"><div className="font-medium">{s.description}</div><div className="text-xs text-slate-500">{[s.category_name, `${s.expense_account_code} / ${s.balance_account_code}`].filter(Boolean).join(' · ')}</div></td>
                  <td className="p-2">{KIND[s.kind]}</td>
                  <td className="p-2 whitespace-nowrap">{s.start_month.slice(0, 7)}{s.kind !== 'thirteenth' ? ` · ${s.months_booked}/${s.months} months` : ''}</td>
                  <td className="p-2 text-right">{s.total_amount === null ? 'follows payroll' : peso(s.total_amount)}</td>
                  <td className="p-2 text-right">{peso(s.booked)}</td>
                  <td className="p-2 text-right">{s.remaining === null ? '—' : peso(s.remaining)}</td>
                  <td className="p-2">{s.status}</td>
                  <td className="p-2">{canFinance && s.status === 'active' && s.kind === 'accrual' && s.months_booked === 0 && <button className="link text-red-600" onClick={() => dialog.confirm('Cancel this accrual?', { tone: 'danger', confirmLabel: 'Cancel accrual' }).then((ok) => { if (ok) run(() => cancelScheduleAction(s.id)); })}>Cancel</button>}</td>
                </tr>
              ))}
              {schedules.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Nothing spread or set aside yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {newAccrual && (
        <Modal title="New accrual" sub="A year-end cost set aside month by month (e.g. year-end bonus, annual audit fee)." close={() => setNewAccrual(false)} msg={msg}>
          <Form className="space-y-3" action={(fd) => run(() => createAccrualAction(fd), () => setNewAccrual(false))}>
            <Field label="Description"><input className="input" name="description" required /></Field>
            <Field label="Category"><select className="input" name="category_id" required defaultValue=""><option value="">Select</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.gl_account_code})</option>)}</select></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Estimated total (PHP)"><input className="input" type="number" step="0.01" min="0.01" name="total_amount" required /></Field>
              <Field label="Months"><input className="input" type="number" name="months" min={1} max={60} defaultValue={12} required /></Field>
              <Field label="Starting month"><input className="input" type="month" name="start_month" defaultValue={`${new Date().getFullYear()}-01`} /></Field>
            </div>
            <button className="button" disabled={pending}>Create accrual</button>
          </Form>
        </Modal>
      )}
    </div>
  );
}

function AccountSelect({ accounts, value }: { accounts: Account[]; value?: string }) {
  return <select className="input" name="gl_account_code" defaultValue={value || '5200'}>{accounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>)}</select>;
}
function Modal({ title, sub, close, msg, children }: { title: string; sub?: string; close: () => void; msg?: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl space-y-3">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{title}</h3>{sub && <p className="text-sm text-slate-500">{sub}</p>}</div><button type="button" className="button-secondary" onClick={close}>Close</button></div>
        {msg && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{msg}</div>}
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <div><label className="label">{label}</label>{children}</div>; }
function Tile({ title, value }: { title: string; value: number }) { return <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{title}</div><div className="text-lg font-semibold mt-1">{peso(value)}</div></div>; }
