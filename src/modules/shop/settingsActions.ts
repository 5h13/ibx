'use server';
// Build 136 — the store's online shop settings (contacts by the Business Admin; on / off by the Super Admin).
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

export async function saveShopSettingsAction(businessId: string, settings: Record<string, string | boolean>) {
  const p = await getSessionProfile();
  if (!p?.user.is_active || !isAdminTier(p)) throw appError('Only the Business Admin or the Super Admin changes the online shop settings.');
  const { error } = await createClient().rpc('shop_settings_save', { p_business: businessId, p: settings });
  if (error) throw appError(error.message);
  revalidatePath('/sales/online-shop'); revalidatePath('/shop', 'layout');
  return { ok: true };
}
