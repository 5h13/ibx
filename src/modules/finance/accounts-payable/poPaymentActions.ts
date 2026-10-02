'use server';
// Build 77 — DOC-08: supplier payment by PO (full prepayment, deposit or
// partial). Recorded as a draft by the database (ap_po_payment_create, system
// numbered <CODE>-APP-YYYY-######), then prepared → reviewed → approved with
// the existing AP payment actions, and posted here (ap_post_po_payment, Finance
// approver). Posted PO payments count toward the PO's supplier invoice when it
// is registered (approved) in AP — the database applies them.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

async function finance() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!isAdminTier(p) && p.user.role !== 'finance' && !p.access.some((a) => a.section_code === 'finance')) throw appError('Finance access required.');
  return p;
}
const refresh = () => { revalidatePath('/finance/accounts-payable'); revalidatePath('/approvals'); revalidatePath('/sales/revenue'); };

export async function createPoPaymentAction(fd: FormData) {
  await finance();
  const v = (k: string) => String(fd.get(k) ?? '').trim();
  if (!v('purchase_order_id')) throw appError('Choose the purchase order.');
  const { data, error } = await createClient().rpc('ap_po_payment_create', {
    p: {
      purchase_order_id: v('purchase_order_id'), kind: v('kind') || 'deposit', amount: v('amount') === '' ? null : Number(v('amount')),
      payment_date: v('payment_date') || null, payment_method: v('payment_method'), reference_number: v('reference_number') || null,
      bank_account: v('bank_account') || null, notes: v('notes') || null,
    },
  });
  if (error) throw appError(error.message);
  refresh();
  return data as { id: string; payment_number: string; amount: number };
}

export async function postPoPaymentAction(paymentId: string) {
  await finance();
  const { error } = await createClient().rpc('ap_post_po_payment', { p_payment: paymentId });
  if (error) throw appError(error.message);
  refresh();
}
