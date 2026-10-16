'use server';
// Build 127 — Sales Manager app: reads (database functions manager_*) and decisions. Every
// decision goes through the same action the office app uses, so the same checks apply.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { reviewQuotationAction, approveQuotationAction } from '@/modules/sales/revenueActions';
import { decideApprovalAction } from '@/modules/approvals/actions';
import { approveSaleAction, cancelSaleAction, decideCancelAction, decideClosingAction } from '@/modules/sales/storefront/actions';
import { notifyUsers } from '@/shared/notifications/service';
import { canUseManagerApp } from './access';

async function manager() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!canUseManagerApp(p)) throw appError('The Sales Manager app is for Sales approvers and the Business Admin.');
  return p;
}
async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw appError(error.message);
  return data as T;
}
function refresh() {
  for (const p of ['/manager', '/manager/approvals', '/manager/team', '/manager/sales', '/manager/collections']) revalidatePath(p);
  revalidatePath('/approvals'); revalidatePath('/sales/revenue'); revalidatePath('/sales/storefront');
}

// ------------------------------------------------------------------- reads --
export async function loadToday() { await manager(); return rpc('manager_today'); }
export async function loadApprovals() { await manager(); return rpc<any[]>('manager_approvals'); }
export async function loadQuote(id: string) { await manager(); return rpc('manager_quote', { p_quote: id }); }
export async function loadMonth(year: number, month: number) { await manager(); return rpc('manager_month', { p_year: year, p_month: month }); }
export async function loadTeam(year: number, month: number) { await manager(); return rpc<any[]>('manager_team', { p_year: year, p_month: month }); }
export async function loadClient(id: string) { await manager(); return rpc('manager_client', { p_customer: id }); }
export async function loadCollections() { await manager(); return rpc('manager_collections'); }

// --------------------------------------------------------------- decisions --
export type Kind = 'quote' | 'order' | 'price' | 'cancel' | 'closing';

/** Approve: a quotation / sales order waiting for review is reviewed and then approved, as far as
 *  the user's role allows; counter items are decided in one step. Returns what happened. */
export async function approveItemAction(kind: Kind, id: string): Promise<{ ok: true; note?: string }> {
  await manager();
  const db = createClient();
  if (kind === 'quote' || kind === 'order') {
    const table = kind === 'quote' ? 'sales_quotations' : 'sales_orders';
    const { data: row } = await db.from(table).select('status').eq('id', id).maybeSingle();
    if (!row) throw appError('Not found — refresh the list.');
    let status = String((row as any).status);
    if (status === 'prepared') {
      if (kind === 'quote') await reviewQuotationAction(id, true); else await decideApprovalAction('sales_orders', id, 'review');
      status = 'reviewed';
    }
    if (status !== 'reviewed') throw appError('This item is no longer waiting for approval.');
    try {
      if (kind === 'quote') await approveQuotationAction(id); else await decideApprovalAction('sales_orders', id, 'approve');
    } catch (e) {
      refresh();
      return { ok: true, note: `Reviewed. Approval needs another approver: ${e instanceof Error ? e.message : ''}` };
    }
  } else if (kind === 'price') {
    await approveSaleAction(id);
  } else if (kind === 'cancel') {
    await decideCancelAction(id, true);
  } else if (kind === 'closing') {
    await decideClosingAction(id, true);
  }
  refresh();
  return { ok: true };
}

/** Return / reject with a reason the preparer sees. */
export async function returnItemAction(kind: Kind, id: string, reason: string) {
  const p = await manager();
  const why = String(reason ?? '').trim();
  if (!why) throw appError('Say why it goes back.');
  const db = createClient();
  if (kind === 'quote') {
    const { data: q } = await db.from('sales_quotations').select('status,prepared_by,created_by,quotation_number,business_id').eq('id', id).maybeSingle();
    if (!q || !['prepared', 'reviewed'].includes(String((q as any).status))) throw appError('This quotation is no longer waiting for approval.');
    const { data, error } = await db.from('sales_quotations').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', id).eq('status', (q as any).status).select('id');
    if (error) throw appError(error.message);
    if (!data?.length) throw appError('The quotation changed meanwhile — refresh.');
    await db.from('audit_log').insert({ actor_id: p.user.id, entity_table: 'sales_quotations', entity_id: id, action: 'returned', detail: { reason: why, from: (q as any).status } });
    const to = (q as any).prepared_by || (q as any).created_by;
    if (to) await notifyUsers([to], (q as any).business_id, { title: `Quotation ${(q as any).quotation_number} returned`, message: why, entity_table: 'sales_quotations', entity_id: id, action_url: '/sales/revenue' }).catch(() => undefined);
  } else if (kind === 'order') {
    await decideApprovalAction('sales_orders', id, 'return', why);
  } else if (kind === 'price') {
    await cancelSaleAction(id);
    await db.from('audit_log').insert({ actor_id: p.user.id, entity_table: 'storefront_sales', entity_id: id, action: 'rejected', detail: { reason: why } });
  } else if (kind === 'cancel') {
    await decideCancelAction(id, false, why);
  } else if (kind === 'closing') {
    await decideClosingAction(id, false, why);
  }
  refresh();
  return { ok: true };
}

export async function setTargetAction(input: { year: number; month: number; agent_id?: string | null; user_id?: string | null; amount: number }) {
  await manager();
  await rpc('manager_set_target', { p_year: input.year, p_month: input.month, p_agent: input.agent_id ?? null, p_user: input.user_id ?? null, p_amount: input.amount });
  refresh();
  return { ok: true };
}

export async function logPromiseAction(input: { customer_id: string; date: string; amount: number; note?: string }) {
  await manager();
  await rpc('manager_log_promise', { p_customer: input.customer_id, p_date: input.date, p_amount: input.amount, p_note: input.note ?? null });
  refresh();
  revalidatePath(`/manager/clients/${input.customer_id}`);
  return { ok: true };
}
