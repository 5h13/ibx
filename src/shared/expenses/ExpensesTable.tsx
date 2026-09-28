// src/shared/expenses/ExpensesTable.tsx
'use client';
import { errorText } from '@/core/errors/appError';

import { useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/core/utils/statusBadge';
import type { ExpenseRow } from './service';
import type { SessionProfile } from '@/core/auth/types';
import { hasWorkflowRole } from '@/core/auth/types';
import { submitForReviewAction, markReviewedAction, markApprovedAction, postExpenseAction, markExpensePaidAction, deleteExpenseDraftAction } from './actions';
import { updateExpenseDraftAction } from './editActions';
import { uploadExpenseDocumentAction, getExpenseDocumentUrlAction, deleteExpenseDocumentAction } from './documentActions';
import { useDialog } from '@/core/ui/Dialog';

export function ExpensesTable({ rows, profile, pathname, categories = [], bankAccounts = [], suppliers = [] }: { rows: ExpenseRow[]; profile: SessionProfile; pathname: string; categories?: Array<{ id: string; code: string; name: string }>; bankAccounts?: Array<{ id: string; account_code: string; account_name: string }>; suppliers?: Array<{ id: string; supplier_code: string; legal_name: string }> }) {
  const dialog = useDialog();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [editError, setEditError] = useState('');
  const [paying, setPaying] = useState<ExpenseRow | null>(null);

  const runAction = (id: string, action: () => Promise<void>) => {
    setPendingId(id);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <>
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left border-b border-slate-200 text-slate-500">
          <th className="py-2 pr-4">Description</th>
          <th className="py-2 pr-4">Amount</th>
          <th className="py-2 pr-4">Status</th>
          <th className="py-2 pr-4">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const canReview = hasWorkflowRole(profile, row.section_id, 'reviewer') && row.status === 'prepared';
          const canApprove = hasWorkflowRole(profile, row.section_id, 'approver') && row.status === 'reviewed';
          const canSubmit =
            hasWorkflowRole(profile, row.section_id, 'preparer') &&
            row.prepared_by === profile.user.id &&
            row.status === 'draft';
          const rowPending = isPending && pendingId === row.id;

          return (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2 pr-4"><button type="button" className="font-medium text-left hover:underline" onClick={() => setSelected(row)}>{row.description}</button></td>
              <td className="py-2 pr-4">{row.amount.toLocaleString(undefined, { style: 'currency', currency: 'PHP' })}</td>
              <td className="py-2 pr-4"><StatusBadge status={row.status} /></td>
              <td className="py-2 pr-4 space-x-2">
                {row.status === 'draft' && row.prepared_by === profile.user.id && (
                  <button disabled={rowPending} onClick={() => { setEditError(''); setEditing(row); }} className="text-xs font-semibold text-slate-700 hover:underline disabled:opacity-50">Edit</button>
                )}
                {row.status === 'draft' && row.prepared_by === profile.user.id && (
                  <button disabled={rowPending} onClick={() => { dialog.confirm('Discard this draft expense? This cannot be undone.', { tone: 'danger', confirmLabel: 'Discard' }).then((ok) => { if (ok) runAction(row.id, () => deleteExpenseDraftAction(row.id, pathname)); }); }} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">Clear draft</button>
                )}
                {canSubmit && (
                  <button
                    disabled={rowPending}
                    onClick={() => runAction(row.id, () => submitForReviewAction(row.id, pathname))}
                    className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {rowPending ? 'Submitting…' : 'Submit for review'}
                  </button>
                )}
                {canReview && (
                  <button
                    disabled={rowPending}
                    onClick={() => runAction(row.id, () => markReviewedAction(row.id, pathname))}
                    className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {rowPending ? 'Saving…' : 'Mark reviewed'}
                  </button>
                )}
                {canApprove && (
                  <button
                    disabled={rowPending}
                    onClick={() => runAction(row.id, () => markApprovedAction(row.id, pathname))}
                    className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {rowPending ? 'Saving…' : 'Approve'}
                  </button>
                )}
                {row.status === 'approved' && (
                  <button disabled={rowPending} onClick={() => runAction(row.id, () => postExpenseAction(row.id, pathname))} className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50">Post</button>
                )}
                {row.status === 'posted' && bankAccounts.length > 0 && (
                  <button disabled={rowPending} onClick={() => setPaying(row)} className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-50">Mark paid</button>
                )}
                {row.status === 'posted' && bankAccounts.length === 0 && (
                  <button disabled={rowPending} onClick={() => runAction(row.id, () => markExpensePaidAction(row.id, pathname))} className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-50">Mark paid</button>
                )}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="py-6 text-center text-slate-400">
              No entries for this month.
            </td>
          </tr>
        )}
      </tbody>
    </table>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Expense detail</h3><p className="text-sm text-slate-500">{selected.description}</p></div><button type="button" className="button-secondary" onClick={() => setSelected(null)}>Close</button></div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Detail label="Date" value={selected.expense_date || '—'} /><Detail label="Amount" value={selected.amount.toLocaleString(undefined,{style:'currency',currency:'PHP'})} /><Detail label="Status" value={selected.status} /><Detail label="Vendor" value={(suppliers.find((s) => s.id === selected.supplier_id)?.legal_name) || selected.vendor || '—'} /><Detail label="Category" value={categories.find((c) => c.id === selected.category_id)?.name || '—'} /><Detail label="Cost center" value={selected.cost_center_id || '—'} /><Detail label="Accounting classification" value={selected.accounting_classification || '—'} /><Detail label="Document reference" value={selected.document_reference || '—'} /><Detail label="Created" value={new Date(selected.created_at).toLocaleString()} />
            </div>
            {selected.notes && <div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="font-medium">Notes</div><div>{selected.notes}</div></div>}
            <div className="space-y-2">
              <div className="font-medium text-sm">Receipts / documents</div>
              {(selected.documents || []).length === 0 && <div className="text-sm text-slate-400">No documents attached.</div>}
              <ul className="space-y-1">
                {(selected.documents || []).map((d) => (
                  <li key={d.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                    <button type="button" className="font-medium hover:underline text-left" onClick={() => { getExpenseDocumentUrlAction(d.id).then((r) => window.open(r.url, '_blank', 'noopener,noreferrer')).catch((e) => dialog.alert(e instanceof Error ? errorText(e) : 'Unable to open document.', { tone: 'danger' })); }}>{d.document_name}</button>
                    {selected.status === 'draft' && selected.prepared_by === profile.user.id && (
                      <button type="button" className="text-red-600 hover:underline" onClick={() => runAction(d.id, async () => { await deleteExpenseDocumentAction(d.id, pathname); })}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
              {selected.status === 'draft' && selected.prepared_by === profile.user.id && (
                <form
                  action={(fd) => { fd.set('expense_id', selected.id); fd.set('pathname', pathname); startTransition(async () => { try { await uploadExpenseDocumentAction(fd); } catch (e) { dialog.alert(e instanceof Error ? errorText(e) : 'Unable to upload document.', { tone: 'danger' }); } }); }}
                  className="flex flex-wrap items-end gap-2"
                  encType="multipart/form-data"
                >
                  <input className="input" type="file" name="document" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" required />
                  <button className="button-secondary" disabled={isPending}>Attach</button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <form action={(fd) => startTransition(async () => { try { await updateExpenseDraftAction(fd); setEditing(null); } catch (e) { setEditError(e instanceof Error ? errorText(e) : 'Unable to save expense.'); } })} className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl space-y-4">
            <input type="hidden" name="expense_id" value={editing.id}/><input type="hidden" name="pathname" value={pathname}/>
            <h3 className="text-lg font-semibold">Edit expense draft</h3>{editError && <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm">{editError}</div>}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Date"><input className="input" type="date" name="expense_date" defaultValue={editing.expense_date || ''} required/></Field>
              <Field label="Amount"><input className="input" type="number" step="0.01" min="0.01" name="amount" defaultValue={editing.amount}/></Field>
              <div className="sm:col-span-2"><Field label="Description"><input className="input" name="description" defaultValue={editing.description} required/></Field></div>
              <Field label="Vendor / Payee (free text)"><input className="input" name="vendor" defaultValue={(editing as any).vendor || ''}/></Field>
              {suppliers.length > 0 && <Field label="Or select a known supplier"><select className="input" name="supplier_id" defaultValue={(editing as any).supplier_id || ''}><option value="">Not a listed supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>)}</select></Field>}
              <Field label="Payment method"><input className="input" name="payment_method" defaultValue={(editing as any).payment_method || ''}/></Field>
              <Field label="Reference no."><input className="input" name="reference_no" defaultValue={(editing as any).reference_no || ''}/></Field>
              <Field label="Receipt reference"><input className="input" name="receipt_reference" defaultValue={(editing as any).receipt_reference || ''}/></Field>
              <Field label="Cost center ID"><input className="input" name="cost_center_id" defaultValue={editing.cost_center_id || ''}/></Field>
              <Field label="Category"><select className="input" name="category_id" defaultValue={editing.category_id || ''}><option value="">Uncategorised</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Accounting classification"><input className="input" name="accounting_classification" defaultValue={editing.accounting_classification || ''}/></Field>
              <Field label="Document reference"><input className="input" name="document_reference" defaultValue={editing.document_reference || ''}/></Field>
              <div className="sm:col-span-2"><Field label="Notes"><textarea className="input min-h-20" name="notes" defaultValue={editing.notes || ''}/></Field></div>
            </div>
            <div className="flex gap-2 justify-end"><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button" disabled={isPending}>Save changes</button></div>
          </form>
        </div>
      )}
      {paying && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <form
            action={(fd) => {
              const bankAccountId = String(fd.get('bank_account_id') || '');
              const transactionDate = String(fd.get('transaction_date') || '');
              runAction(paying.id, () => markExpensePaidAction(paying.id, pathname, bankAccountId, transactionDate));
              setPaying(null);
            }}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-4"
          >
            <h3 className="text-lg font-semibold">Record payment</h3>
            <p className="text-sm text-slate-500">{paying.description} — {paying.amount.toLocaleString(undefined, { style: 'currency', currency: 'PHP' })}</p>
            <Field label="Paid from account">
              <select className="input" name="bank_account_id" required>
                <option value="">Select account</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>)}
              </select>
            </Field>
            <Field label="Payment date"><input className="input" type="date" name="transaction_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
            <div className="flex gap-2 justify-end"><button type="button" className="button-secondary" onClick={() => setPaying(null)}>Cancel</button><button className="button" disabled={isPending}>Mark paid</button></div>
          </form>
        </div>
      )}
    </>
  );
}

function Detail({label,value}:{label:string;value:string}){return <div className="rounded-lg border p-3"><div className="text-xs text-slate-500">{label}</div><div className="font-medium mt-1 break-words">{value}</div></div>}
function Field({label,children}:{label:string;children:ReactNode}){return <div><label className="label">{label}</label>{children}</div>}
