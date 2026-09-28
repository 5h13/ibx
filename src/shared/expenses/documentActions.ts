// src/shared/expenses/documentActions.ts
//
// U041: expense receipt/document attachments. Same pattern as
// finance/procurement's supplier-document actions (storage has no
// storage.objects RLS of its own, so uploads/reads go through the
// service-role admin client for the file itself; the metadata row still
// goes through the session-scoped client so finance_expense_documents'
// RLS -- preparer-owns-draft-expense -- is actually enforced).
'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

const EXPENSE_PATHS = new Set([
  '/admin/expenses',
  '/finance/expenses',
  '/logistics/expenses',
  '/marketing/expenses',
  '/sales/expenses',
]);

function revalidateExpensePage(pathname: string) {
  if (!EXPENSE_PATHS.has(pathname)) throw appError('Invalid expense page');
  revalidatePath(pathname);
}

export async function uploadExpenseDocumentAction(fd: FormData) {
  const profile = await getSessionProfile();
  if (!profile?.user.is_active) throw appError('Authentication required.');
  const expenseId = String(fd.get('expense_id') || '').trim();
  const pathname = String(fd.get('pathname') || '').trim();
  if (!expenseId) throw appError('Missing expense reference.');
  const file = fd.get('document');
  if (!(file instanceof File) || file.size === 0) throw appError('Select a receipt/document to upload.');
  if (file.size > 10 * 1024 * 1024) throw appError('Expense documents must be 10 MB or smaller.');
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
  if (file.type && !allowed.includes(file.type)) throw appError('Unsupported document type. Use PDF, JPG, PNG or Word.');

  const admin = createAdminClient();
  const db = createClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const path = `${expenseId}/${crypto.randomUUID()}-${safe}`;
  const { error: uploadError } = await admin.storage.from('expense-documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (uploadError) throw appError(uploadError.message);

  const { data, error } = await db.from('finance_expense_documents').insert({
    expense_id: expenseId,
    document_name: file.name,
    storage_path: path,
    notes: String(fd.get('notes') || '').trim() || null,
    uploaded_by: profile.user.id,
  }).select('id').single();
  if (error || !data) {
    await admin.storage.from('expense-documents').remove([path]);
    throw appError(error?.message || 'Unable to save the expense document. Only the preparer, while the expense is still a draft, can attach one.');
  }
  if (pathname) revalidateExpensePage(pathname);
  return { ok: true };
}

export async function getExpenseDocumentUrlAction(id: string) {
  const profile = await getSessionProfile();
  if (!profile?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const { data, error } = await db.from('finance_expense_documents').select('storage_path,document_name').eq('id', id).single();
  if (error || !data) throw appError('Document not found.');
  const admin = createAdminClient();
  const { data: urlData, error: urlError } = await admin.storage.from('expense-documents').createSignedUrl(data.storage_path, 300);
  if (urlError || !urlData?.signedUrl) throw appError(urlError?.message || 'Unable to create document link.');
  return { url: urlData.signedUrl, name: data.document_name };
}

export async function deleteExpenseDocumentAction(id: string, pathname: string) {
  const db = createClient();
  const { data: row, error: readError } = await db.from('finance_expense_documents').select('storage_path').eq('id', id).single();
  if (readError || !row) throw appError('Document not found, or you no longer have permission to remove it.');
  const { error } = await db.from('finance_expense_documents').delete().eq('id', id);
  if (error) throw appError(error.message);
  const admin = createAdminClient();
  await admin.storage.from('expense-documents').remove([row.storage_path]);
  revalidateExpensePage(pathname);
  return { ok: true };
}
