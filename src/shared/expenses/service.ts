import { appError } from '@/core/errors/appError';
// src/shared/expenses/service.ts
//
// Generic expenses service used by every department module
// (admin/finance/logistics/marketing/sales). RLS on public.expenses
// already scopes reads/writes by section + workflow role (see
// supabase/schema.sql) — this layer just shapes the queries and the
// Prepare -> Review -> Approve transitions.

import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import type { EntryStatus, SectionCode } from '@/core/auth/types';

export interface ExpenseRow {
  id: string;
  section_id: string;
  month_id: string;
  description: string;
  amount: number;
  status: EntryStatus;
  prepared_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  expense_date?: string | null;
  category_id?: string | null;
  cost_center_id?: string | null;
  accounting_classification?: string | null;
  document_reference?: string | null;
  posted_by?: string | null;
  posted_at?: string | null;
  paid_by?: string | null;
  paid_at?: string | null;
  vendor?: string | null;
  supplier_id?: string | null;
  payment_method?: string | null;
  reference_no?: string | null;
  receipt_reference?: string | null;
  rejection_reason?: string | null;
  documents?: Array<{ id: string; document_name: string; created_at: string }>;
}

async function getSectionId(sectionCode: SectionCode): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sections')
    .select('id')
    .eq('code', sectionCode)
    .single();
  if (error || !data) throw appError(`Unknown section: ${sectionCode}`);
  return data.id;
}

export async function listExpenses(sectionCode: SectionCode, monthId: string): Promise<ExpenseRow[]> {
  const supabase = createClient();
  const sectionId = await getSectionId(sectionCode);

  const { data, error } = await supabase
    .from('expenses')
    .select('*, documents:finance_expense_documents(id,document_name,created_at)')
    .eq('section_id', sectionId)
    .eq('month_id', monthId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createExpenseDraft(
  sectionCode: SectionCode,
  monthId: string,
  description: string,
  amount: number,
  costCenterId?: string | null,
  categoryId?: string | null,
  supplierId?: string | null
) {
  // U047: this generic path (used by finance/logistics/marketing/sales'
  // NewExpenseForm) previously had no server-side validation at all beyond
  // the HTML `required`/`min` attributes on the client — a crafted request
  // could insert a zero/negative-amount or blank-description draft. The
  // admin and edit-draft paths already validate; this brings the generic
  // path in line with them.
  if (!description || !description.trim()) throw appError('Description is required.');
  if (!Number.isFinite(amount) || amount <= 0) throw appError('Amount must be greater than zero.');

  const supabase = createClient();
  const sectionId = await getSectionId(sectionCode);
  const profile = await getSessionProfile();
  if (!profile) throw appError('Not authenticated');
  const user = profile.user;

  const { error } = await supabase.from('expenses').insert({
    ...(user.business_id ? { business_id: user.business_id } : {}),
    section_id: sectionId,
    month_id: monthId,
    description,
    amount,
    status: 'draft',
    prepared_by: user.id,
    cost_center_id: costCenterId || null,
    category_id: categoryId || null,
    supplier_id: supplierId || null,
  });
  if (error) throw error;
}

/** Preparer: draft/prepared -> prepared, stamps prepared_by/at. */
export async function submitForReview(expenseId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated');
  const { data: row, error: readError } = await supabase.from('expenses').select('status').eq('id', expenseId).single();
  if (readError || !row || row.status !== 'draft') throw appError('Expense is not in Draft status.');
  const { error } = await supabase
    .from('expenses')
    .update({ status: 'prepared', prepared_by: user.id, prepared_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}

/** Reviewer: prepared -> reviewed. */
export async function markReviewed(expenseId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated');
  const { data: row, error: readError } = await supabase.from('expenses').select('status').eq('id', expenseId).single();
  if (readError || !row || row.status !== 'prepared') throw appError('Expense is not in Prepared status.');
  const { error } = await supabase
    .from('expenses')
    .update({ status: 'reviewed', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}

/** Approver: reviewed -> approved. */
export async function markApproved(expenseId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated');
  const { data: row, error: readError } = await supabase.from('expenses').select('status').eq('id', expenseId).single();
  if (readError || !row || row.status !== 'reviewed') throw appError('Expense is not in Reviewed status.');
  const { error } = await supabase
    .from('expenses')
    .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}

export async function postExpense(expenseId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated');
  const { error } = await supabase.from('expenses').update({ status:'posted', posted_by:user.id, posted_at:new Date().toISOString() }).eq('id',expenseId).eq('status','approved');
  if (error) throw error;
}

/** U005: discard a still-draft expense entirely (RLS: preparer's own draft rows only). */
export async function deleteExpenseDraft(expenseId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated');
  const { data: row, error: readError } = await supabase.from('expenses').select('status,prepared_by').eq('id', expenseId).single();
  if (readError || !row) throw appError('Expense not found.');
  if (row.status !== 'draft') throw appError('Only draft expenses can be cleared.');
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId).eq('status', 'draft');
  if (error) throw error;
}

// U043/U044: previously this only flipped a status flag -- an expense
// marked "paid" never produced any actual financial record, so it
// dead-ended with no link to AP/cash. finance_cash_transactions already
// has source_module/source_record_id columns built for exactly this kind
// of cross-module traceability (see finance_bank_accounts/bank-cash), so
// this now optionally books a real cash-out transaction against it.
//
// bankAccountId is optional rather than required: only Finance-section
// users can even see finance_bank_accounts under RLS (bank accounts are a
// Finance-controlled resource), while "mark paid" itself is available to
// any department's own approver for their own expenses (existing RLS:
// expenses_update_finance_post allows is_super_admin() OR
// has_workflow_role(section_id,'approver') -- section_id is the expense's
// own department, not necessarily 'finance'). Requiring a bank account
// unconditionally would have silently broken every non-finance department's
// existing ability to mark their own expenses paid. So: when a bank
// account is supplied (the Finance expenses page always offers one), the
// real cash-transaction linkage is created; otherwise the status-only
// behavior is unchanged from before this build. This is a genuine,
// documented reduced scope for non-finance departments' expenses, not a
// silently-incomplete fix -- closing it further would mean routing every
// department's expense payment through Finance, which is a workflow
// redesign beyond this item's scope.
export async function markExpensePaid(expenseId: string, bankAccountId?: string | null, transactionDate?: string | null) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated');

  const { data: expense, error: readError } = await supabase
    .from('expenses')
    .select('id,business_id,amount,description,vendor,status')
    .eq('id', expenseId)
    .single();
  if (readError || !expense) throw appError('Expense not found.');
  if (expense.status !== 'posted') throw appError('Only posted expenses can be marked paid.');

  if (bankAccountId) {
    const txnNumber = `EXP-PAY-${expenseId.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const { data: txn, error: txnError } = await supabase.from('finance_cash_transactions').insert({
      ...(expense.business_id ? { business_id: expense.business_id } : {}),
      transaction_number: txnNumber,
      bank_account_id: bankAccountId,
      transaction_date: transactionDate || new Date().toISOString().slice(0, 10),
      transaction_type: 'withdrawal',
      amount: expense.amount,
      direction: 'out',
      description: `Expense payment: ${expense.description}`,
      counterparty: expense.vendor || null,
      source_module: 'expenses',
      source_record_id: expenseId,
      status: 'posted',
      posted_by: user.id,
      posted_at: new Date().toISOString(),
      created_by: user.id,
    }).select('id').single();
    if (txnError || !txn) throw appError(txnError?.message || 'Unable to record the cash payment for this expense.');
  }

  const { error } = await supabase.from('expenses').update({ status:'paid', paid_by:user.id, paid_at:new Date().toISOString() }).eq('id',expenseId).eq('status','posted');
  if (error) throw error;
}
