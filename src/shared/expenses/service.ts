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
}

async function getSectionId(sectionCode: SectionCode): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sections')
    .select('id')
    .eq('code', sectionCode)
    .single();
  if (error || !data) throw new Error(`Unknown section: ${sectionCode}`);
  return data.id;
}

export async function listExpenses(sectionCode: SectionCode, monthId: string): Promise<ExpenseRow[]> {
  const supabase = createClient();
  const sectionId = await getSectionId(sectionCode);

  const { data, error } = await supabase
    .from('expenses')
    .select('*')
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
  amount: number
) {
  const supabase = createClient();
  const sectionId = await getSectionId(sectionCode);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('expenses').insert({
    section_id: sectionId,
    month_id: monthId,
    description,
    amount,
    status: 'draft',
    prepared_by: user.id,
  });
  if (error) throw error;
}

/** Preparer: draft/prepared -> prepared, stamps prepared_by/at. */
export async function submitForReview(expenseId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('expenses')
    .update({ status: 'prepared', prepared_by: user?.id, prepared_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}

/** Reviewer: prepared -> reviewed. */
export async function markReviewed(expenseId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('expenses')
    .update({ status: 'reviewed', reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}

/** Approver: reviewed -> approved. */
export async function markApproved(expenseId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('expenses')
    .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
    .eq('id', expenseId);
  if (error) throw error;
}
