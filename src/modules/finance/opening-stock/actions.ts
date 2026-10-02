'use server';
// Build 76 (LOG-46) — approve or reject an opening count. The database
// function checks the role (Business Admin), the store and no self-approval.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

export async function decideOpeningCountAction(countId: string, approve: boolean, note?: string) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const { data, error } = await createClient().rpc('inventory_opening_count_decide', { p_count: countId, p_approve: approve, p_note: note ?? null });
  if (error) throw appError(error.message);
  revalidatePath('/finance/opening-stock');
  return data as { status: string; raised?: number; lowered?: number; lines?: number };
}
