'use server';
// Build 86 — AGT-01 Part A: add / edit sales agents (Business Admins, Super Admin).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { appError } from '@/core/errors/appError';

export async function saveAgentAction(id: string | null, input: { name: string; phone?: string; email?: string; gcash_number?: string; notes?: string; active?: boolean }) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const { data, error } = await createClient().rpc('sales_agent_save', { p_id: id, p: input });
  if (error) throw appError(error.message);
  revalidatePath('/sales/agents');
  return data as string;
}

// ---------------------------------------------------------------------------
// Build 91 — price tiers and agent expense approval (Business Admin).

export async function saveTiersAction(t2: number, t3: number, t4: number) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!p.user.business_id) throw appError('Select a business in "Acting as" first — tiers are per store.');
  const { error } = await createClient().rpc('sales_price_tiers_save', { p_business: p.user.business_id, p_t2: t2, p_t3: t3, p_t4: t4 });
  if (error) throw appError(error.message);
  revalidatePath('/sales/agents');
}

/** Approve → an approved Sales expense for Finance to pay (the receipt photo is copied to it); reject needs a reason. */
export async function decideAgentExpenseAction(id: string, approve: boolean, note?: string) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const { data: list, error: le } = await db.rpc('agent_expenses_review');
  if (le) throw appError(le.message);
  const row = ((list ?? []) as any[]).find((x) => x.id === id);
  if (!row) throw appError('Agent expense not found in this store.');
  const { data: expenseId, error } = await db.rpc('agent_expense_decide', { p_id: id, p_approve: approve, p_note: note ?? null });
  if (error) throw appError(error.message);
  if (approve && expenseId && row.photo_path) {
    const admin = createAdminClient();
    const name = String(row.photo_path).split('/').pop() || 'receipt.jpg';
    const target = `${expenseId}/${crypto.randomUUID()}-${name}`;
    const { data: file } = await admin.storage.from('agent-files').download(row.photo_path);
    if (file) {
      const { error: ue } = await admin.storage.from('expense-documents').upload(target, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (!ue) await admin.from('finance_expense_documents').insert({ expense_id: expenseId, document_name: `Receipt — ${row.expense_number}`, storage_path: target, uploaded_by: p.user.id });
    }
  }
  revalidatePath('/sales/agents');
  return expenseId as string | null;
}

export async function agentExpensePhotoAction(id: string) {
  const { data: list, error } = await createClient().rpc('agent_expenses_review');
  if (error) throw appError(error.message);
  const row = ((list ?? []) as any[]).find((x) => x.id === id);
  if (!row?.photo_path) throw appError('No receipt photo on this expense.');
  const { data, error: se } = await createAdminClient().storage.from('agent-files').createSignedUrl(row.photo_path, 300);
  if (se || !data) throw appError(se?.message || 'Unable to open the photo.');
  return data.signedUrl;
}
