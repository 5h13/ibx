'use server';
// Build 113 — MODE-01: operating modes per store. Super Admin only (enforced again in the database).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { appError } from '@/core/errors/appError';

export type ModeKey = 'full' | 'skeletal' | 'single' | 'custom';
export type PointSetting = 'two_step' | 'one_step' | 'auto';

export async function setOperatingModeAction(businessId: string, mode: ModeKey, points?: Record<string, PointSetting>) {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  if (profile.user.role !== 'super_admin') throw appError('Only the Super Admin can change a store\'s operating mode.');
  const { data, error } = await createClient().rpc('workflow_set_mode', { p_business: businessId, p_mode: mode, p_points: mode === 'custom' ? points ?? {} : null });
  if (error) throw appError(error.message);
  revalidatePath('/admin/operating-modes');
  return data as { mode: ModeKey; points: Record<string, PointSetting> };
}
