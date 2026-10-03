import { appError } from '@/core/errors/appError';
// src/shared/expenses/service.ts
//
// Generic expenses service used by every department module
// (admin/finance/logistics/marketing/sales). RLS on public.expenses
// already scopes reads/writes by section + workflow role (see
// supabase/schema.sql) — this layer just shapes the queries and the
// Prepare -> Review -> Approve transitions.

import { createClient } from '@/core/auth/supabaseServer';
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

// Build 80: posting and paying moved to Finance (expense_post / expense_pay RPCs,
// src/modules/finance/expenses/actions.ts); they now book the ledger too.
