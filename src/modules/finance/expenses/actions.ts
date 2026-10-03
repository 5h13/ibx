'use server';
// Build 80 (EXP-01): Finance's side of expenses — the all-department
// register, categories, posting / paying (into the ledger) and the monthly
// spread of prepaid costs, accruals and the 13th month. The database
// functions check who may do what (Finance approver / Business Admin).
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

export type RegisterRow = {
  id: string; expense_date: string; section_code: string; section_name: string; description: string; amount: number; status: string;
  category_id: string | null; category_name: string | null; gl_account_code: string | null; suggested_category: string | null;
  supplier_id: string | null; supplier_name: string | null; vendor: string | null; cost_center: string | null; reference_no: string | null;
  payment_method: string | null; is_yearly: boolean; spread_months: number | null; accrual_schedule_id: string | null; prepared_by_name: string | null;
  approved_at: string | null; posted_at: string | null; paid_at: string | null; journal_number: string | null; rejection_reason: string | null;
};
export type ScheduleRow = {
  id: string; kind: 'prepaid' | 'accrual' | 'thirteenth'; description: string; category_name: string | null; expense_account_code: string; balance_account_code: string;
  total_amount: number | null; months: number; start_month: string; status: string; booked: number; months_booked: number; remaining: number | null;
  last_period: string | null; source_expense_id: string | null; settled_expense_id: string | null;
};
export type MonthRunRow = { schedule: string; period: string; amount: number; journal_number: string };

async function signedIn() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  return p;
}
function done() { revalidatePath('/finance/expenses/register'); revalidatePath('/finance/expenses'); }
const str = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s || null; };

export async function registerAction(from: string, to: string) {
  await signedIn();
  const { data, error } = await createClient().rpc('expense_register', { p_from: from, p_to: to });
  if (error) throw appError(error.message);
  return (data ?? []) as RegisterRow[];
}

export async function setCategoryAction(expenseId: string, categoryId: string) {
  await signedIn();
  const { error } = await createClient().rpc('expense_set_category', { p_expense: expenseId, p_category: categoryId });
  if (error) throw appError(error.message);
  done();
}

/** Save a category; with expense_id, the new category is also given to that expense (accepting a suggestion). */
export async function saveCategoryAction(fd: FormData) {
  await signedIn();
  const db = createClient();
  const flags = fd.getAll('active').map(String);
  const active = flags.length === 0 ? true : flags.includes('on') || flags.includes('true');
  const { data, error } = await db.rpc('expense_category_save', {
    p_id: str(fd.get('id')), p_code: str(fd.get('code')), p_name: str(fd.get('name')), p_description: str(fd.get('description')),
    p_gl_code: str(fd.get('gl_account_code')) || '5200', p_active: active,
  });
  if (error) throw appError(error.message);
  const expenseId = str(fd.get('expense_id'));
  if (expenseId) {
    const { error: e2 } = await db.rpc('expense_set_category', { p_expense: expenseId, p_category: data as string });
    if (e2) throw appError(e2.message);
  }
  done();
  revalidatePath('/admin/expenses'); revalidatePath('/sales/expenses'); revalidatePath('/logistics/expenses'); revalidatePath('/marketing/expenses');
  return data as string;
}

export async function postExpenseAction(fd: FormData) {
  await signedIn();
  const spread = Number(fd.get('spread_months') || 1);
  const start = str(fd.get('start_month'));
  const { data, error } = await createClient().rpc('expense_post', {
    p_expense: str(fd.get('expense_id')), p_category: str(fd.get('category_id')),
    p_spread_months: Number.isFinite(spread) && spread > 0 ? Math.round(spread) : 1,
    p_start: start ? `${start}-01` : null, p_accrual: str(fd.get('accrual_id')),
  });
  if (error) throw appError(error.message);
  done();
  return data as string;
}

export async function payExpenseAction(fd: FormData) {
  await signedIn();
  const { error } = await createClient().rpc('expense_pay', { p_expense: str(fd.get('expense_id')), p_bank_account: str(fd.get('bank_account_id')), p_date: str(fd.get('payment_date')) });
  if (error) throw appError(error.message);
  done();
}

export async function schedulesAction() {
  await signedIn();
  const { data, error } = await createClient().rpc('expense_schedules');
  if (error) throw appError(error.message);
  return (data ?? []) as ScheduleRow[];
}

export async function createAccrualAction(fd: FormData) {
  await signedIn();
  const start = str(fd.get('start_month'));
  const { error } = await createClient().rpc('expense_accrual_create', {
    p_description: str(fd.get('description')), p_category: str(fd.get('category_id')), p_total: Number(fd.get('total_amount') || 0),
    p_months: Number(fd.get('months') || 12), p_start: start ? `${start}-01` : null,
  });
  if (error) throw appError(error.message);
  done();
}

export async function cancelScheduleAction(id: string) {
  await signedIn();
  const { error } = await createClient().rpc('expense_schedule_cancel', { p_schedule: id });
  if (error) throw appError(error.message);
  done();
}

export async function monthRunAction(month: string) {
  await signedIn();
  if (!/^\d{4}-\d{2}$/.test(month)) throw appError('Choose a month.');
  const { data, error } = await createClient().rpc('expense_month_run', { p_month: `${month}-01` });
  if (error) throw appError(error.message);
  done();
  revalidatePath('/finance/accounting'); revalidatePath('/dashboard'); revalidatePath('/finance/dashboard');
  return (data ?? []) as MonthRunRow[];
}
