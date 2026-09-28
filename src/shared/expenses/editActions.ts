'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';

function required(fd: FormData, key: string) {
  const value = String(fd.get(key) ?? '').trim();
  if (!value) throw appError(`${key.replaceAll('_', ' ')} is required.`);
  return value;
}

function optional(fd: FormData, key: string) {
  const value = String(fd.get(key) ?? '').trim();
  return value || null;
}

export async function updateExpenseDraftAction(fd: FormData) {
  const id = required(fd, 'expense_id');
  const pathname = required(fd, 'pathname');
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw appError('Not authenticated.');

  const amount = Number(required(fd, 'amount'));
  if (!Number.isFinite(amount) || amount <= 0) throw appError('Amount must be greater than zero.');

  const { data: current, error: readError } = await supabase
    .from('expenses')
    .select('id,status,prepared_by,month_id')
    .eq('id', id)
    .single();
  if (readError || !current) throw appError('Expense not found.');
  if (current.status !== 'draft') throw appError('Only draft expenses can be edited.');
  if (current.prepared_by !== user.id) throw appError('Only the preparer can edit this draft.');

  const { error } = await supabase.from('expenses').update({
    description: required(fd, 'description'),
    amount,
    expense_date: required(fd, 'expense_date'),
    vendor: optional(fd, 'vendor'),
    supplier_id: optional(fd, 'supplier_id'),
    payment_method: optional(fd, 'payment_method'),
    reference_no: optional(fd, 'reference_no'),
    receipt_reference: optional(fd, 'receipt_reference'),
    category_id: optional(fd, 'category_id'),
    cost_center_id: optional(fd, 'cost_center_id'),
    accounting_classification: optional(fd, 'accounting_classification'),
    document_reference: optional(fd, 'document_reference'),
    notes: optional(fd, 'notes'),
  }).eq('id', id).eq('status', 'draft');
  if (error) throw error;

  revalidatePath(pathname);
  return { ok: true };
}
