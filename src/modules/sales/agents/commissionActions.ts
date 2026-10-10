'use server';
// Build 92 — agent commission (staff side): statements, adjustments, closing a month, the matrix.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw appError(error.message);
  return data as T;
}
const refresh = () => revalidatePath('/sales/agent-commissions');

export async function commissionStatementAction(agentId: string, month: string) {
  return rpc<any>('agent_commission_statement', { p_agent: agentId, p_month: month });
}
export async function commissionAdjustAction(agentId: string, month: string, amount: number, note: string) {
  await rpc('agent_commission_adjust', { p_agent: agentId, p_month: month, p_amount: amount, p_note: note });
  refresh();
}
export async function commissionAdjustDeleteAction(id: string) {
  await rpc('agent_commission_adjust_delete', { p_id: id });
  refresh();
}
export async function commissionCloseAction(agentId: string, month: string) {
  const r = await rpc<{ payable: number; expense_id: string | null }>('agent_commission_close', { p_agent: agentId, p_month: month });
  refresh();
  return r;
}
export async function commissionSettingsAction(input: { default_rate: number; max_rate: number; start_date: string; rates: { category: string; rate: number }[]; brackets: { min_paid: number; points: number }[];
  online_rate?: number; savings_rate?: number; deduct_agent_expenses?: boolean }) {
  const p = await getSessionProfile();
  if (!p?.user.business_id) throw appError('Select a business in "Acting as" first — the matrix is per store.');
  await rpc('agent_commission_settings_save', { p_business: p.user.business_id, p: input });
  // Build 93: online agents, savings, agent expenses deducted
  await rpc('agent_commission_options_save', { p_business: p.user.business_id, p_online_rate: input.online_rate ?? null, p_savings_rate: input.savings_rate ?? null, p_deduct: input.deduct_agent_expenses ?? null });
  refresh();
}
export async function agentOnlineAction(agentId: string, online: boolean) {
  await rpc('sales_agent_set_online', { p_agent: agentId, p_online: online });
  refresh(); revalidatePath('/sales/agents');
}
export async function savingsReleaseAction(agentId: string, amount: number, note: string) {
  await rpc('agent_savings_release', { p_agent: agentId, p_amount: amount, p_note: note });
  refresh();
}

// Build 93 — back office commission
const refreshBo = () => revalidatePath('/sales/back-office-commission');
export async function boSetupAction(input: Record<string, unknown>) {
  await rpc('bo_commission_setup_save', { p: input });
  refreshBo();
}
export async function boCloseAction(month: string) {
  const r = await rpc<{ total: number; people: number }>('bo_commission_close', { p_month: month });
  refreshBo();
  return r;
}
