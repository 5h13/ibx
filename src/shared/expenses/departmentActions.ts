'use server';
// Build 80 (EXP-01): one set of expense actions for every department page
// (Admin, Finance, Logistics, Marketing, Sales). Row-level security decides
// who may write: the department's preparer adds and edits own drafts, its
// reviewer / approver move the steps. Posting and paying are Finance's
// (src/modules/finance/expenses/actions.ts).
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { getMonthId } from '@/core/utils/currentMonth';
import type { SectionCode } from '@/core/auth/types';

const PATHS: Record<SectionCode, string> = {
  admin: '/admin/expenses', finance: '/finance/expenses', logistics: '/logistics/expenses', marketing: '/marketing/expenses', sales: '/sales/expenses',
};
const SECTIONS = Object.keys(PATHS) as SectionCode[];

function req(fd: FormData, key: string, label: string) { const v = String(fd.get(key) ?? '').trim(); if (!v) throw appError(`${label} is required.`); return v; }
function opt(fd: FormData, key: string) { const v = String(fd.get(key) ?? '').trim(); return v || null; }
function section(fd: FormData): SectionCode { const s = String(fd.get('section') ?? '') as SectionCode; if (!SECTIONS.includes(s)) throw appError('Invalid department.'); return s; }

/** Category select: an id, or "suggest" with a typed name for Finance to add / map. */
function readCategory(fd: FormData) {
  const raw = opt(fd, 'category_id');
  if (raw === 'suggest') {
    const name = req(fd, 'suggested_category', 'Suggested category name');
    if (name.length > 80) throw appError('Keep the suggested category name under 80 characters.');
    return { category_id: null, suggested_category: name };
  }
  return { category_id: raw, suggested_category: null };
}

function readYearly(fd: FormData) {
  const yearly = String(fd.get('is_yearly') ?? '') === 'on' || String(fd.get('is_yearly') ?? '') === 'true';
  if (!yearly) return { is_yearly: false, spread_months: null };
  const months = Number(fd.get('spread_months') || 12);
  if (!Number.isInteger(months) || months < 2 || months > 60) throw appError('Spread a yearly cost over 2 to 60 months.');
  return { is_yearly: true, spread_months: months };
}

function readAmount(fd: FormData) {
  const amount = Number(req(fd, 'amount', 'Amount'));
  if (!Number.isFinite(amount) || amount <= 0) throw appError('Amount must be greater than zero.');
  return Math.round(amount * 100) / 100;
}

async function audit(actor: string, id: string, action: string, detail: Record<string, unknown>) {
  const { error } = await createClient().from('audit_log').insert({ actor_id: actor, entity_table: 'expenses', entity_id: id, action, detail });
  if (error) throw appError(error.message);
}

export async function createDepartmentExpenseAction(fd: FormData) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!p.user.business_id) throw appError('Select a business in "Acting as" first.');
  const sec = section(fd); const db = createClient();
  const expenseDate = req(fd, 'expense_date', 'Expense date');
  const [y, m] = expenseDate.split('-').map(Number);
  if (!y || !m) throw appError('Invalid expense date.');
  const monthId = await getMonthId(p.user.business_id, y, m, true);
  const { data: s } = await db.from('sections').select('id').eq('code', sec).single();
  if (!s) throw appError('Department is not configured.');
  const amount = readAmount(fd);
  const { data, error } = await db.from('expenses').insert({
    business_id: p.user.business_id, section_id: s.id, month_id: monthId, status: 'draft', prepared_by: p.user.id,
    description: req(fd, 'description', 'Description'), amount, expense_date: expenseDate,
    ...readCategory(fd), ...readYearly(fd),
    cost_center_id: opt(fd, 'cost_center_id'), vendor: opt(fd, 'vendor'), supplier_id: opt(fd, 'supplier_id'),
    payment_method: opt(fd, 'payment_method'), reference_no: opt(fd, 'reference_no'), receipt_reference: opt(fd, 'receipt_reference'),
    asset_id: opt(fd, 'asset_id'), fleet_vehicle_id: opt(fd, 'fleet_vehicle_id'), notes: opt(fd, 'notes'),
  }).select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to save the expense. Only the department\'s preparers can add expenses.');
  await audit(p.user.id, data.id, 'expense_created', { section: sec, amount });
  revalidatePath(PATHS[sec]);
  return { ok: true };
}

export async function updateDepartmentExpenseAction(fd: FormData) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const sec = section(fd); const db = createClient(); const id = req(fd, 'expense_id', 'Expense');
  const { data: cur } = await db.from('expenses').select('status,prepared_by').eq('id', id).maybeSingle();
  if (!cur) throw appError('Expense not found.');
  if (cur.status !== 'draft') throw appError('Only draft expenses can be edited.');
  if (cur.prepared_by !== p.user.id) throw appError('Only the preparer can edit this draft.');
  const expenseDate = req(fd, 'expense_date', 'Expense date');
  const [y, m] = expenseDate.split('-').map(Number);
  const monthId = p.user.business_id ? await getMonthId(p.user.business_id, y, m, true) : undefined;
  const { error } = await db.from('expenses').update({
    description: req(fd, 'description', 'Description'), amount: readAmount(fd), expense_date: expenseDate, ...(monthId ? { month_id: monthId } : {}),
    ...readCategory(fd), ...readYearly(fd),
    cost_center_id: opt(fd, 'cost_center_id'), vendor: opt(fd, 'vendor'), supplier_id: opt(fd, 'supplier_id'),
    payment_method: opt(fd, 'payment_method'), reference_no: opt(fd, 'reference_no'), receipt_reference: opt(fd, 'receipt_reference'),
    asset_id: opt(fd, 'asset_id'), fleet_vehicle_id: opt(fd, 'fleet_vehicle_id'), notes: opt(fd, 'notes'), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'draft');
  if (error) throw appError(error.message);
  await audit(p.user.id, id, 'expense_edited', {});
  revalidatePath(PATHS[sec]);
  return { ok: true };
}

/** Reviewer / approver returns a prepared or reviewed expense to the preparer. */
export async function returnDepartmentExpenseAction(fd: FormData) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const sec = section(fd); const db = createClient(); const id = req(fd, 'expense_id', 'Expense');
  const reason = req(fd, 'rejection_reason', 'Reason');
  const { data: cur } = await db.from('expenses').select('status').eq('id', id).maybeSingle();
  if (!cur || !['prepared', 'reviewed'].includes(cur.status)) throw appError('This expense is not waiting for review or approval.');
  const { data, error } = await db.from('expenses').update({ status: 'draft', rejection_reason: reason }).eq('id', id).eq('status', cur.status).select('id');
  if (error) throw appError(error.message);
  if (!data?.length) throw appError('You cannot return this expense (reviewer or approver of the department only).');
  await audit(p.user.id, id, 'expense_returned', { reason });
  revalidatePath(PATHS[sec]);
  revalidatePath('/approvals');
  return { ok: true };
}
