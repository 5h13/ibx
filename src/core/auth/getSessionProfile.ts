// src/core/auth/getSessionProfile.ts
//
// Loads public.users + public.user_access for the current session.
// Use in server components / route handlers to build a SessionProfile.

import { createClient } from './supabaseServer';
import { cache } from 'react';
import type { SessionProfile } from './types';
import { getActingBusinessId } from './actingBusiness';

export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  // Build 57 — role audit: an expired audit session is restored before the
  // profile is built, so an auditor is never left in the audited role.
  const { data: auditRow } = await supabase
    .from('role_audit_sessions')
    .select('audit_roles, audit_business_id, expires_at, original_role')
    .eq('user_id', authUser.id)
    .maybeSingle();
  let audit: SessionProfile['audit'] = null;
  if (auditRow) {
    if (new Date(auditRow.expires_at).getTime() <= Date.now()) {
      await supabase.rpc('end_role_audit');
    } else {
      audit = { roles: auditRow.audit_roles, businessId: auditRow.audit_business_id, expiresAt: auditRow.expires_at, originalRole: auditRow.original_role };
    }
  }

  // These two queries don't depend on each other, so fire them together
  // instead of waiting on one before starting the next.
  const [{ data: userRow, error: userErr }, { data: accessRows }] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, full_name, role, section_id, is_active, business_id, sections(code)')
      .eq('id', authUser.id)
      .single(),
    supabase
      .from('user_access')
      .select('section_id, workflow_role, sections(code)')
      .eq('user_id', authUser.id),
  ]);

  if (userErr || !userRow || !userRow.is_active) return null;

  // A001 completion: the Global Super Admin has no business of their own
  // (business_id is null in the database, by design). If they've picked an
  // "acting business" (see actingBusiness.ts), reflect it here so every
  // existing write path that reads profile.user.business_id — none of
  // which needed to change — now tags new rows with the selected business
  // instead of silently relying on a column default. This never touches
  // the real users.business_id column. Build 59: the same selection also
  // filters their reads at the database (migration 20261112).
  let effectiveBusinessId = userRow.business_id as string | null;
  if (userRow.role === 'super_admin') {
    effectiveBusinessId = await getActingBusinessId();
  }

  return {
    user: { ...userRow, business_id: effectiveBusinessId, section_code: (userRow as any).sections?.code ?? null },
    access: (accessRows ?? []).map((row: any) => ({ ...row, section_code: row.sections?.code ?? null })),
    audit,
  };
});
