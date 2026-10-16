'use server';
// Build 91 — expense allowances: a monthly limit per employee and expense category
// (Build 125, UIA-45: employees only — agents are not given allowances). Going over is flagged for the approver, not blocked.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

async function admin() {
  const p = await getSessionProfile();
  if (!p?.user.is_active || !isAdminTier(p)) throw appError('Allowances are set by the Business Admin.');
  if (!p.user.business_id) throw appError('Select a business in "Acting as" first — allowances are per store.');
  return p;
}

export async function saveAllowanceAction(input: { id?: string | null; person: string; category_id: string; monthly_limit: number; notes?: string }) {
  const p = await admin();
  const limit = Number(input.monthly_limit);
  if (!Number.isFinite(limit) || limit < 0) throw appError('Enter the monthly limit (₱0 or more).');
  const db = createClient();
  if (input.id) {
    const { error } = await db.from('expense_allowances').update({ monthly_limit: limit, notes: input.notes || null, active: true, updated_at: new Date().toISOString() }).eq('id', input.id);
    if (error) throw appError(error.message);
  } else {
    const [kind, id] = String(input.person).split(':');
    if (kind === 'agent') throw appError('Allowances are for employees only; agents are not given allowances.');
    if (!id || kind !== 'user') throw appError('Choose the employee.');
    if (!input.category_id) throw appError('Choose the expense category.');
    const { error } = await db.from('expense_allowances').insert({ business_id: p.user.business_id, user_id: kind === 'user' ? id : null, agent_id: null,
      category_id: input.category_id, monthly_limit: limit, notes: input.notes || null, created_by: p.user.id });
    if (error) throw appError(error.code === '23505' ? 'This person already has an allowance for that category — edit it instead.' : error.message);
  }
  revalidatePath('/admin/allowances');
}

export async function deleteAllowanceAction(id: string) {
  await admin();
  const { error } = await createClient().from('expense_allowances').delete().eq('id', id);
  if (error) throw appError(error.message);
  revalidatePath('/admin/allowances');
}
