'use server';
// Build 86 — AGT-01 Part A: add / edit sales agents (Business Admins, Super Admin).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { appError } from '@/core/errors/appError';

export async function saveAgentAction(id: string | null, input: { name: string; phone?: string; email?: string; gcash_number?: string; notes?: string; active?: boolean }) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const { data, error } = await createClient().rpc('sales_agent_save', { p_id: id, p: input });
  if (error) throw appError(error.message);
  revalidatePath('/sales/agents');
  return data as string;
}
