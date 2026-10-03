'use server';
import { appError } from '@/core/errors/appError';

// Server actions for the Global Super Admin's "acting business" selector.
// See actingBusiness.ts for what this does and doesn't affect.

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getSessionProfile } from './getSessionProfile';
import { createClient } from './supabaseServer';
import { actingBusinessCookieName } from './actingBusiness';

async function saveActingBusiness(businessId: string | null) {
  const db = createClient();
  const { error } = await db.rpc('set_acting_business', { p_business_id: businessId });
  if (error) throw appError(error.message);
  (await cookies()).delete(actingBusinessCookieName()); // legacy cookie no longer used
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function setActingBusinessAction(formData: FormData) {
  const profile = await getSessionProfile();
  if (!profile || profile.user.role !== 'super_admin') {
    throw appError('Only the Global Super Admin can select an acting business.');
  }
  const businessId = String(formData.get('business_id') ?? '').trim();
  return saveActingBusiness(businessId || null);
}

export async function clearActingBusinessAction() {
  const profile = await getSessionProfile();
  if (!profile || profile.user.role !== 'super_admin') {
    throw appError('Only the Global Super Admin can clear the acting business.');
  }
  return saveActingBusiness(null);
}
