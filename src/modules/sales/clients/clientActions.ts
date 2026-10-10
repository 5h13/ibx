'use server';
// Build 96 — Clients list actions (checks are in the database functions).
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
const refresh = () => { revalidatePath('/sales/clients'); revalidatePath('/finance/accounts-receivable'); revalidatePath('/sales/agents'); };

export type ClientInput = {
  legal_name: string; trade_name?: string; contact_person?: string; phone?: string; email?: string; address?: string; tax_id?: string; payment_terms?: string;
  credit_limit?: string; notes?: string; price_tier?: number; agent_id?: string; move_note?: string; active?: boolean;
};
export async function saveClientAction(id: string | null, input: ClientInput) {
  const r = await rpc<string>('sales_client_save', { p_id: id, p: input });
  refresh();
  return r;
}
export async function moveClientsAction(ids: string[], agentId: string, note?: string) {
  const n = await rpc<number>('sales_clients_move', { p_customers: ids, p_agent: agentId, p_note: note?.trim() || null });
  refresh();
  return n;
}
