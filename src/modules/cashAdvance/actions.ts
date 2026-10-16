'use server';
// Build 126 (UIA-44) — employee cash advances. The rules (limit of half a month's pay, 1–12 payments,
// one open advance, who approves and releases) live in the database functions; these actions call
// them with the signed-in user's session and send the notifications.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { notifyUsers, notifyWorkflowRole } from '@/shared/notifications/service';

const peso = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function refresh() { revalidatePath('/profile'); revalidatePath('/admin/cash-advances'); revalidatePath('/finance/cash-advances'); }

async function session() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  return p;
}

async function advance(id: string) {
  const { data } = await createClient().from('employee_cash_advances').select('id,business_id,advance_number,amount,requested_by,employee_id').eq('id', id).maybeSingle();
  return data as any;
}

export async function loadMyCashAdvance() {
  const { data, error } = await createClient().rpc('my_cash_advance');
  if (error) return null;
  return data as any;
}

export async function loadCashAdvances() {
  const { data, error } = await createClient().rpc('cash_advances_list');
  if (error) throw appError(error.message);
  return (data ?? []) as any[];
}

export async function requestCashAdvanceAction(fd: FormData) {
  const p = await session();
  const amount = Number(fd.get('amount')); const payments = Number(fd.get('payments'));
  const { data: id, error } = await createClient().rpc('cash_advance_request', { p_amount: amount, p_payments: payments, p_reason: String(fd.get('reason') ?? '') });
  if (error) throw appError(error.message);
  const a = await advance(id as string);
  const { data: admins } = await createClient().rpc('cash_advance_notify_targets_for', { p_advance: id });
  if (Array.isArray(admins) && admins.length) {
    await notifyUsers(admins as string[], a?.business_id ?? p.user.business_id, { title: 'Cash advance request', message: `${p.user.full_name || 'An employee'} asks for ${peso(amount)} in ${payments} payment(s).`, entity_table: 'employee_cash_advances', entity_id: id as string, action_url: '/admin/cash-advances' });
  }
  refresh();
  return { ok: true };
}

export async function cancelCashAdvanceAction(id: string) {
  await session();
  const { error } = await createClient().rpc('cash_advance_cancel', { p_id: id });
  if (error) throw appError(error.message);
  refresh();
  return { ok: true };
}

export async function decideCashAdvanceAction(id: string, approve: boolean, reason?: string) {
  await session();
  const { error } = await createClient().rpc('cash_advance_decide', { p_id: id, p_approve: approve, p_reason: reason ?? null });
  if (error) throw appError(error.message);
  const a = await advance(id);
  if (a?.requested_by) {
    await notifyUsers([a.requested_by], a.business_id, approve
      ? { title: 'Cash advance approved', message: `${a.advance_number} for ${peso(a.amount)} is approved; Finance will release it.`, entity_table: 'employee_cash_advances', entity_id: id, action_url: '/profile' }
      : { title: 'Cash advance not approved', message: reason || 'Your cash advance request was rejected.', entity_table: 'employee_cash_advances', entity_id: id, action_url: '/profile' });
  }
  if (approve && a) await notifyWorkflowRole(a.business_id, 'finance', 'approver', { title: 'Cash advance to release', message: `${a.advance_number} for ${peso(a.amount)} is approved and waiting to be released.`, entity_table: 'employee_cash_advances', entity_id: id, action_url: '/finance/cash-advances' });
  refresh();
  return { ok: true };
}

export async function releaseCashAdvanceAction(id: string, bankAccountId: string | null, method: string) {
  await session();
  const { error } = await createClient().rpc('cash_advance_release', { p_id: id, p_bank_account: bankAccountId || null, p_method: method || 'cash' });
  if (error) throw appError(error.message);
  const a = await advance(id);
  if (a?.requested_by) await notifyUsers([a.requested_by], a.business_id, { title: 'Cash advance released', message: `${a.advance_number} for ${peso(a.amount)} has been released. It is deducted from your pay in instalments.`, entity_table: 'employee_cash_advances', entity_id: id, action_url: '/profile' });
  refresh();
  return { ok: true };
}
