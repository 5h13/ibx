'use server';
import { appError } from '@/core/errors/appError';

// Build 57 — Role audit mode ("Switch role"). The database functions
// start_role_audit / end_role_audit do the real work and enforce who may
// switch (real Super Admin / Business Admin only; Business Admin within its
// own business); these actions just call them for the signed-in user.

import { revalidatePath } from 'next/cache';
import { createClient } from './supabaseServer';

import { ROLE_PRESETS } from './roleAuditPresets';

export async function startRoleAuditAction(roles: string[], businessId: string | null, minutes = 60) {
  const allowed = ROLE_PRESETS.map((p) => p.code as string);
  const clean = roles.filter((r) => allowed.includes(r));
  if (!clean.length) throw appError('Choose at least one role.');
  const { error } = await createClient().rpc('start_role_audit', { p_roles: clean, p_business_id: businessId, p_minutes: minutes });
  if (error) throw appError(error.message);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function endRoleAuditAction() {
  const { error } = await createClient().rpc('end_role_audit');
  if (error) throw appError(error.message);
  revalidatePath('/', 'layout');
  return { ok: true };
}
