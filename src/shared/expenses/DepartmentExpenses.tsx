'use client';
// Build 80 (EXP-01): the one expense page every department uses (Admin,
// Finance, Logistics, Marketing, Sales) — own department's expenses, any
// month, prepare → review → approve. Finance then posts and pays from
// Finance → All expenses.
import { useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { StatusBadge } from '@/core/utils/statusBadge';
import { hasWorkflowRole, type SessionProfile } from '@/core/auth/types';
import { submitForReviewAction, markReviewedAction, markApprovedAction, deleteExpenseDraftAction } from './actions';
import { createDepartmentExpenseAction, updateDepartmentExpenseAction, returnDepartmentExpenseAction } from './departmentActions';
import { uploadExpenseDocumentAction, getExpenseDocumentUrlAction, deleteExpenseDocumentAction } from './documentActions';
import type { DeptExpenseData } from './loadDepartmentExpenses';

const TITLES: Record<string, string> = { admin: 'Admin', finance: 'Finance', logistics: 'Logistics', marketing: 'Marketing', sales: 'Sales' };
const peso = (v: unknown) => `₱${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FINANCE_STEP: Record<string, string> = { approved: 'Waiting for Finance to post', posted: 'Posted by Finance', paid: 'Paid by Finance' };

function shiftMonth(key: string, by: number) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function DepartmentExpenses({ profile, data }: { profile: SessionProfile; data: DeptExpenseData }) {
  const { section, sectionId, monthKey, monthLabel, rows, categories, costCenters, suppliers, assets, vehicles, suggestions } = data;
  const pathname = `/${section}/expenses`;
  const dialog = useDialog();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const run = (fn: () => Promise<unknown>, done?: () => void) => start(async () => {
    setMessage('');
    try { await fn(); setMessage('Saved.'); done?.(); } catch (e) { setMessage(errorText(e) || 'Action failed.'); }
  });
  const canPrepare = hasWorkflowRole(profile, sectionId, 'preparer');
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((n: number, r: any) => n + Number(r.amount), 0);
  const thisMonth = new Date().toISOString().slice(0, 7);

  const returnRow = (r: any) => dialog.prompt('Reason for returning this expense to the preparer?', { required: true }).then((reason) => {
    if (!reason) return;
    const fd = new FormData(); fd.set('section', section); fd.set('expense_id', r.id); fd.set('rejection_reason', reason);
    run(() => returnDepartmentExpenseAction(fd));
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{TITLES[section]} Expenses</h2>
          <p className="text-sm text-slate-500 mt-1">This department&apos;s expenses. After approval, Finance posts them to the books and records the payment.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link className="button-secondary" href={`${pathname}?month=${shiftMonth(monthKey, -1)}`}>‹</Link>
          <input type="month" className="input w-40" value={monthKey} max={thisMonth} onChange={(e) => e.target.value && router.push(`${pathname}?month=${e.target.value}`)} />
          {monthKey < thisMonth && <Link className="button-secondary" href={`${pathname}?month=${shiftMonth(monthKey, 1)}`}>›</Link>}
        </div>
      </div>

      {canPrepare && (
        <ActionBar>
          <PopupAction label="+ Add expense" title={`Add ${TITLES[section].toLowerCase()} expense`} notice={message} wide>
            {(close) => (
              <form action={(fd) => { fd.set('section', section); run(() => createDepartmentExpenseAction(fd), close); }}>
                <ExpenseFields categories={categories} costCenters={costCenters} suppliers={suppliers} assets={assets} vehicles={vehicles} suggestions={suggestions} />
                <button disabled={pending} className="button mt-3">{pending ? 'Saving…' : 'Save expense draft'}</button>
              </form>
            )}
          </PopupAction>
        </ActionBar>
      )}
      {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile title={monthLabel} value={sum(() => true)} />
        <Tile title="Drafts" value={sum((r) => r.status === 'draft')} />
        <Tile title="For review / approval" value={sum((r) => r.status === 'prepared' || r.status === 'reviewed')} />
        <Tile title="Approved, posted or paid" value={sum((r) => ['approved', 'posted', 'paid'].includes(r.status))} />
      </div>

      <div className="rounded-xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Date</th><th className="p-3">Expense</th><th className="p-3">Vendor</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead>
          <tbody>
            {rows.map((r: any) => {
              const mine = r.prepared_by === profile.user.id;
              const canSubmit = hasWorkflowRole(profile, r.section_id, 'preparer') && mine && r.status === 'draft';
              const canReview = hasWorkflowRole(profile, r.section_id, 'reviewer') && r.status === 'prepared' && !mine;
              const canApprove = hasWorkflowRole(profile, r.section_id, 'approver') && r.status === 'reviewed' && !mine;
              return (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="p-3 whitespace-nowrap">{r.expense_date || '—'}</td>
                  <td className="p-3">
                    <button type="button" className="font-medium text-left hover:underline" onClick={() => setSelected(r)}>{r.description}</button>
                    <div className="text-xs text-slate-500">
                      {r.category?.name || (r.suggested_category ? <span className="text-amber-700">Suggested: {r.suggested_category}</span> : 'Uncategorised')}
                      {r.is_yearly ? ` · yearly cost, ${r.spread_months || 12} months` : ''}
                      {r.vehicle ? ` · ${r.vehicle.vehicle_no}` : ''}{r.asset ? ` · ${r.asset.asset_no}` : ''}
                    </div>
                  </td>
                  <td className="p-3">{suppliers.find((s: any) => s.id === r.supplier_id)?.legal_name || r.vendor || '—'}</td>
                  <td className="p-3 text-right font-medium whitespace-nowrap">{peso(r.amount)}</td>
                  <td className="p-3"><StatusBadge status={r.status} />{FINANCE_STEP[r.status] && <div className="text-xs text-slate-500 mt-1">{FINANCE_STEP[r.status]}</div>}{r.rejection_reason && r.status === 'draft' && <div className="text-xs text-red-600 mt-1">Returned: {r.rejection_reason}</div>}</td>
                  <td className="p-3 space-x-2 whitespace-nowrap">
                    {canSubmit && <button disabled={pending} className="link" onClick={() => run(() => submitForReviewAction(r.id, pathname))}>Submit</button>}
                    {canReview && <><button disabled={pending} className="link" onClick={() => run(() => markReviewedAction(r.id, pathname))}>Review</button><button disabled={pending} className="link text-red-600" onClick={() => returnRow(r)}>Return</button></>}
                    {canApprove && <><button disabled={pending} className="link text-green-600" onClick={() => run(() => markApprovedAction(r.id, pathname))}>Approve</button><button disabled={pending} className="link text-red-600" onClick={() => returnRow(r)}>Return</button></>}
                    {r.status === 'draft' && mine && <button disabled={pending} className="link" onClick={() => setEditing(r)}>Edit</button>}
                    {r.status === 'draft' && mine && <button disabled={pending} className="link text-red-600" onClick={() => dialog.confirm('Discard this draft expense? This cannot be undone.', { tone: 'danger', confirmLabel: 'Discard' }).then((ok) => { if (ok) run(() => deleteExpenseDraftAction(r.id, pathname)); })}>Clear draft</button>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No expenses for {monthLabel}.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <form className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl space-y-3"
            action={(fd) => { fd.set('section', section); fd.set('expense_id', editing.id); run(() => updateDepartmentExpenseAction(fd), () => setEditing(null)); }}>
            <h3 className="font-semibold">Edit draft</h3>
            <ExpenseFields row={editing} categories={categories} costCenters={costCenters} suppliers={suppliers} assets={assets} vehicles={vehicles} suggestions={suggestions} />
            <div className="flex gap-2 justify-end"><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button" disabled={pending}>Save</button></div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Expense detail</h3><p className="text-sm text-slate-500">{selected.description}</p></div><button type="button" className="button-secondary" onClick={() => setSelected(null)}>Close</button></div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Detail label="Date" value={selected.expense_date || '—'} />
              <Detail label="Amount" value={peso(selected.amount)} />
              <Detail label="Status" value={FINANCE_STEP[selected.status] || selected.status} />
              <Detail label="Category" value={selected.category?.name || (selected.suggested_category ? `Suggested: ${selected.suggested_category}` : '—')} />
              <Detail label="Vendor" value={suppliers.find((s: any) => s.id === selected.supplier_id)?.legal_name || selected.vendor || '—'} />
              <Detail label="Payment method / reference" value={[selected.payment_method, selected.reference_no].filter(Boolean).join(' · ') || '—'} />
              <Detail label="Yearly cost" value={selected.is_yearly ? `Yes — spread over ${selected.spread_months || 12} months` : 'No'} />
              <Detail label="Asset / vehicle" value={[selected.asset?.asset_no, selected.vehicle?.vehicle_no].filter(Boolean).join(' · ') || '—'} />
            </div>
            {selected.notes && <div className="rounded-lg bg-slate-50 p-3 text-sm">{selected.notes}</div>}
            <div className="space-y-2">
              <div className="font-medium text-sm">Receipts / documents</div>
              {(selected.documents || []).length === 0 && <div className="text-sm text-slate-400">No documents attached.</div>}
              <ul className="space-y-1">
                {(selected.documents || []).map((d: any) => (
                  <li key={d.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                    <button type="button" className="font-medium hover:underline text-left" onClick={() => getExpenseDocumentUrlAction(d.id).then((r) => window.open(r.url, '_blank', 'noopener,noreferrer')).catch((e) => dialog.alert(errorText(e) || 'Unable to open document.', { tone: 'danger' }))}>{d.document_name}</button>
                    {selected.status === 'draft' && selected.prepared_by === profile.user.id && <button type="button" className="text-red-600 hover:underline" onClick={() => run(() => deleteExpenseDocumentAction(d.id, pathname), () => setSelected(null))}>Remove</button>}
                  </li>
                ))}
              </ul>
              {selected.status === 'draft' && selected.prepared_by === profile.user.id && (
                <form className="flex flex-wrap items-end gap-2" action={(fd) => { fd.set('expense_id', selected.id); fd.set('pathname', pathname); run(() => uploadExpenseDocumentAction(fd), () => setSelected(null)); }}>
                  <input className="input" type="file" name="document" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" required />
                  <button className="button-secondary" disabled={pending}>Attach</button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpenseFields({ row, categories, costCenters, suppliers, assets, vehicles, suggestions }: { row?: any; categories: any[]; costCenters: any[]; suppliers: any[]; assets: any[]; vehicles: any[]; suggestions: string[] }) {
  const [cat, setCat] = useState<string>(row ? (row.category_id || (row.suggested_category ? 'suggest' : '')) : '');
  const [yearly, setYearly] = useState<boolean>(!!row?.is_yearly);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label="Expense date"><input className="input" name="expense_date" type="date" defaultValue={row?.expense_date || new Date().toISOString().slice(0, 10)} required /></Field>
      <Field label="Amount (PHP)"><input className="input" name="amount" type="number" step="0.01" min="0.01" defaultValue={row?.amount ?? ''} required /></Field>
      <Field label="Category">
        <select className="input" name="category_id" value={cat} onChange={(e) => setCat(e.target.value)} required>
          <option value="">Select category</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="suggest">Other: suggest a category…</option>
        </select>
      </Field>
      {cat === 'suggest' && <Field label="Suggested category (Finance adds or maps it)"><input className="input" name="suggested_category" defaultValue={row?.suggested_category || ''} maxLength={80} required /></Field>}
      <div className="md:col-span-2"><Field label="Description"><input className="input" name="description" list="expense-description-suggestions" defaultValue={row?.description || ''} required /><datalist id="expense-description-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist></Field></div>
      <Field label="Vendor / payee (free text)"><input className="input" name="vendor" defaultValue={row?.vendor || ''} /></Field>
      {suppliers.length > 0 && <Field label="Or a listed supplier"><select className="input" name="supplier_id" defaultValue={row?.supplier_id || ''}><option value="">Not a listed supplier</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>)}</select></Field>}
      <Field label="Payment method"><select className="input" name="payment_method" defaultValue={row?.payment_method || ''}><option value="">Select</option>{['Cash', 'Bank transfer', 'GCash', 'Maya', 'Card', 'Check', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
      <Field label="Reference no."><input className="input" name="reference_no" defaultValue={row?.reference_no || ''} /></Field>
      <Field label="Receipt reference"><input className="input" name="receipt_reference" defaultValue={row?.receipt_reference || ''} placeholder="OR / invoice number" /></Field>
      {costCenters.length > 0 && <Field label="Cost center"><select className="input" name="cost_center_id" defaultValue={row?.cost_center_id || ''}><option value="">Unassigned</option>{costCenters.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></Field>}
      <Field label="Asset (optional)"><select className="input" name="asset_id" defaultValue={row?.asset_id || ''}><option value="">None</option>{assets.map((a: any) => <option key={a.id} value={a.id}>{a.asset_no} — {a.name}</option>)}</select></Field>
      <Field label="Vehicle (optional)"><select className="input" name="fleet_vehicle_id" defaultValue={row?.fleet_vehicle_id || ''}><option value="">None</option>{vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.vehicle_no}{v.plate_no ? ` — ${v.plate_no}` : ''}</option>)}</select></Field>
      <div className="md:col-span-3 rounded-lg border bg-slate-50 p-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_yearly" checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> Yearly cost paid upfront (business permit, insurance, subscription…)</label>
        {yearly && <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">Spread over <input className="input w-20" type="number" name="spread_months" min={2} max={60} defaultValue={row?.spread_months || 12} /> months — Finance confirms when posting.</div>}
      </div>
      <div className="md:col-span-3"><Field label="Notes"><input className="input" name="notes" defaultValue={row?.notes || ''} /></Field></div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div><label className="label">{label}</label>{children}</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-medium mt-1 break-words">{value}</div></div>; }
function Tile({ title, value }: { title: string; value: number }) { return <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">{title}</div><div className="text-xl font-semibold mt-1">{peso(value)}</div></div>; }
