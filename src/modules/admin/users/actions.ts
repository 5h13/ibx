'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier, type AppRole, type WorkflowRole, type SessionProfile } from '@/core/auth/types';

const ROLES: AppRole[] = ['super_admin', 'business_admin', 'admin', 'finance', 'logistics', 'marketing', 'sales'];
const ADMIN_TIER_ROLES: AppRole[] = ['super_admin', 'business_admin'];
const WORKFLOW_ROLES: WorkflowRole[] = ['preparer', 'reviewer', 'approver'];

function requiredString(value: FormDataEntryValue | null, name: string) {
  const text = String(value ?? '').trim();
  if (!text) throw appError(`${name} is required.`);
  return text;
}

function parseIds(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) throw appError();
    return parsed as string[];
  } catch {
    throw appError('Invalid section assignment.');
  }
}

function parseGrants(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Record<string, string[]>;
    for (const [sectionId, roles] of Object.entries(parsed)) {
      if (!Array.isArray(roles) || roles.some((r) => !WORKFLOW_ROLES.includes(r as WorkflowRole))) {
        throw appError();
      }
    }
    return parsed;
  } catch {
    throw appError('Invalid workflow assignment.');
  }
}

function validateRole(role: string): asserts role is AppRole {
  if (!ROLES.includes(role as AppRole)) throw appError('Invalid role.');
}

/** A001 completion: Global Super Admin or Business Super Admin. A Business
 * Super Admin's reach is meant to stop at their own business, but two of
 * the calls below (Supabase's Auth Admin API — password reset, ban/unban)
 * have no concept of business_id at all and bypass RLS entirely, so every
 * caller of this must also explicitly re-check target ownership with
 * assertManageableTarget() before touching the Auth Admin API — the
 * database policies alone do not cover that surface. */
async function requireAdminTier() {
  const profile = await getSessionProfile();
  if (!profile || !isAdminTier(profile) || !profile.user.is_active) {
    throw appError('Admin access required.');
  }
  return profile;
}

/** Re-fetches the target user through the session-scoped (RLS-enforced)
 * client and confirms the acting admin is actually allowed to manage them:
 * a Global Super Admin can manage anyone; a Business Super Admin can only
 * manage a non-admin-tier user in their own business. Returns the target
 * row, or throws a uniform "not found" (never a distinct "forbidden") so a
 * Business Super Admin can't use this to probe for other businesses' users. */
async function assertManageableTarget(actor: SessionProfile, db: ReturnType<typeof createClient>, userId: string) {
  let query = db.from('users').select('id,email,role,is_active,business_id').eq('id', userId);
  if (actor.user.role === 'business_admin') {
    query = query.eq('business_id', actor.user.business_id ?? '').not('role', 'in', `(${ADMIN_TIER_ROLES.join(',')})`);
  }
  const { data: target, error } = await query.maybeSingle();
  if (error) throw appError(error.message);
  if (!target) throw appError('User not found.');
  return target;
}

async function writeAudit(
  actorId: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown>
) {
  const db = createClient();
  await db.from('audit_log').insert({
    actor_id: actorId,
    entity_table: 'users',
    entity_id: entityId,
    action,
    detail,
  });
}

export async function createUserAction(formData: FormData) {
  const actor = await requireAdminTier();
  const email = requiredString(formData.get('email'), 'Email').toLowerCase();
  const fullName = requiredString(formData.get('full_name'), 'Full name');
  const role = requiredString(formData.get('role'), 'Role');
  validateRole(role);
  const sectionIds = parseIds(formData.get('section_ids'));
  const grants = parseGrants(formData.get('grants'));

  if (role === 'super_admin' && sectionIds.length !== 0) {
    // Super admins do not need section grants; keeping them empty makes the bypass explicit.
    throw appError('Super Admin accounts do not require section assignments.');
  }
  if (role !== 'super_admin' && sectionIds.length === 0) {
    throw appError('Assign at least one section.');
  }

  // A Business Super Admin can never create another admin-tier account —
  // that decision stays with the Global Super Admin. Checked here for a
  // clear error message; the RLS insert policy enforces the same rule as a
  // second line of defense regardless.
  if (actor.user.role === 'business_admin' && ADMIN_TIER_ROLES.includes(role as AppRole)) {
    throw appError('Only the Global Super Admin can create Super Admin or Business Super Admin accounts.');
  }

  const admin = createAdminClient();
  const db = createClient();

  // business_id assignment: now that more than one business exists, the
  // creating Global Super Admin must explicitly pick which business a new
  // non-super_admin user belongs to. A Business Super Admin has no choice
  // to make at all — their own business_id is the only valid answer, so we
  // use it directly rather than trusting whatever the form submitted.
  let newUserBusinessId: string | null = null;
  if (role !== 'super_admin') {
    const businessId = actor.user.role === 'business_admin'
      ? actor.user.business_id ?? ''
      : requiredString(formData.get('business_id'), 'Business');
    const { data: business, error: bizError } = await db
      .from('businesses')
      .select('id,is_active')
      .eq('id', businessId)
      .maybeSingle();
    if (bizError) throw appError(bizError.message);
    if (!business || !business.is_active) throw appError('Select a valid, active business for this user.');
    newUserBusinessId = business.id;
  }

  const temporaryPassword = String(formData.get('password') ?? '').trim() || crypto.randomUUID().slice(0, 8) + 'Aa1!';
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authError || !authData.user) throw appError(authError?.message ?? 'Unable to create auth user.');

  const homeSectionId = sectionIds[0] ?? null;
  const { error: userError } = await db.from('users').insert({
    id: authData.user.id,
    email,
    full_name: fullName,
    role,
    section_id: homeSectionId,
    business_id: newUserBusinessId,
    is_active: true,
  });
  if (userError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    throw appError(userError.message);
  }

  const rows = sectionIds.flatMap((sectionId) =>
    (grants[sectionId] ?? []).map((workflowRole) => ({
      user_id: authData.user!.id,
      section_id: sectionId,
      workflow_role: workflowRole,
    }))
  );
  if (rows.length) {
    const { error } = await db.from('user_access').insert(rows);
    if (error) {
      await db.from('users').delete().eq('id', authData.user.id);
      await admin.auth.admin.deleteUser(authData.user.id);
      throw appError(error.message);
    }
  }

  await writeAudit(actor.user.id, authData.user.id, 'created', { email, role, section_ids: sectionIds });
  revalidatePath('/settings/users');
  return { ok: true, temporaryPassword };
}

export async function updateUserAction(formData: FormData) {
  const actor = await requireAdminTier();
  const userId = requiredString(formData.get('user_id'), 'User');
  const role = requiredString(formData.get('role'), 'Role');
  validateRole(role);
  const sectionIds = parseIds(formData.get('section_ids'));
  const grants = parseGrants(formData.get('grants'));
  const isActive = String(formData.get('is_active')) === 'true';

  if (userId === actor.user.id && (role !== actor.user.role || !isActive)) {
    throw appError(`You cannot remove or deactivate your own ${actor.user.role === 'super_admin' ? 'Super Admin' : 'Business Super Admin'} access.`);
  }
  if (role === 'super_admin' && sectionIds.length) throw appError('Super Admin accounts do not require section assignments.');
  if (role !== 'super_admin' && sectionIds.length === 0) throw appError('Assign at least one section.');

  // A Business Super Admin can never touch an admin-tier account (their own
  // aside, handled above) nor promote anyone into one — same rule as
  // creation, same reasoning: that decision stays with the Global Super
  // Admin. assertManageableTarget's own query already excludes admin-tier
  // targets for a business_admin actor, so an attempt against one simply
  // reads as "not found" below; this check catches the other direction —
  // promoting an ordinary user INTO an admin tier.
  if (actor.user.role === 'business_admin' && ADMIN_TIER_ROLES.includes(role as AppRole)) {
    throw appError('Only the Global Super Admin can grant Super Admin or Business Super Admin access.');
  }

  const admin = createAdminClient();
  const db = createClient();
  const target = await assertManageableTarget(actor, db, userId);

  // business_id: super_admin stays null (Global Super Admin operates above
  // every business). A Business Super Admin can only ever move a user
  // within their own business — again, use their own business_id directly
  // rather than trusting the form. The Global Super Admin picks explicitly,
  // or the edit preserves whatever the user already had if the form omitted
  // the field (e.g. an older UI still submitting without it).
  let targetBusinessId: string | null = null;
  if (role !== 'super_admin') {
    if (actor.user.role === 'business_admin') {
      targetBusinessId = actor.user.business_id;
    } else {
      const submittedBusinessId = formData.get('business_id');
      if (submittedBusinessId) {
        const businessId = requiredString(submittedBusinessId, 'Business');
        const { data: business, error: bizError } = await db
          .from('businesses')
          .select('id,is_active')
          .eq('id', businessId)
          .maybeSingle();
        if (bizError) throw appError(bizError.message);
        if (!business || !business.is_active) throw appError('Select a valid, active business for this user.');
        targetBusinessId = business.id;
      } else {
        targetBusinessId = target.business_id;
        if (!targetBusinessId) throw appError('Select a business for this user.');
      }
    }
  }

  if (target.role === 'super_admin' && (role !== 'super_admin' || !isActive)) {
    const { count, error } = await db.from('users').select('id', { count: 'exact', head: true }).eq('role', 'super_admin').eq('is_active', true);
    if (error) throw appError(error.message);
    if ((count ?? 0) <= 1) throw appError('At least one active Super Admin must remain.');
  }

  const { error: userError } = await db.from('users').update({
    full_name: requiredString(formData.get('full_name'), 'Full name'),
    role,
    section_id: sectionIds[0] ?? null,
    business_id: targetBusinessId,
    is_active: isActive,
  }).eq('id', userId);
  if (userError) throw appError(userError.message);

  await db.from('user_access').delete().eq('user_id', userId);
  const rows = sectionIds.flatMap((sectionId) =>
    (grants[sectionId] ?? []).map((workflowRole) => ({ user_id: userId, section_id: sectionId, workflow_role: workflowRole }))
  );
  if (rows.length) {
    const { error } = await db.from('user_access').insert(rows);
    if (error) throw appError(error.message);
  }

  const authUpdate = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { full_name: requiredString(formData.get('full_name'), 'Full name') },
    ...(isActive ? { ban_duration: 'none' } : { ban_duration: '876000h' }),
  });
  if (authUpdate.error) throw appError(authUpdate.error.message);

  await writeAudit(actor.user.id, userId, 'edited', {
    role,
    section_ids: sectionIds,
    is_active: isActive,
  });
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function resetUserPasswordAction(formData: FormData) {
  const actor = await requireAdminTier();
  const userId = requiredString(formData.get('user_id'), 'User');
  const db = createClient();
  await assertManageableTarget(actor, db, userId); // Auth Admin API below has no business_id of its own — this is the check that actually stops cross-business password resets.
  const admin = createAdminClient();
  const temporaryPassword = crypto.randomUUID().slice(0, 8) + 'Aa1!';
  const { error } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
  if (error) throw appError(error.message);
  await writeAudit(actor.user.id, userId, 'edited', { action: 'password_reset' });
  return { ok: true, temporaryPassword };
}

export async function deactivateUserAction(formData: FormData) {
  const actor = await requireAdminTier();
  const userId = requiredString(formData.get('user_id'), 'User');
  if (userId === actor.user.id) throw appError('You cannot deactivate your own account.');
  const db = createClient();
  const target = await assertManageableTarget(actor, db, userId); // also the check that stops cross-business ban via the Auth Admin API below
  if (target.role === 'super_admin' && target.is_active) {
    const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('role', 'super_admin').eq('is_active', true);
    if ((count ?? 0) <= 1) throw appError('At least one active Super Admin must remain.');
  }
  const admin = createAdminClient();
  const { error: dbError } = await db.from('users').update({ is_active: false }).eq('id', userId);
  if (dbError) throw appError(dbError.message);
  const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  if (authError) throw appError(authError.message);
  await writeAudit(actor.user.id, userId, 'edited', { action: 'deactivated' });
  revalidatePath('/settings/users');
  return { ok: true };
}

export async function reactivateUserAction(formData: FormData) {
  const actor = await requireAdminTier();
  const userId = requiredString(formData.get('user_id'), 'User');
  const db = createClient();
  await assertManageableTarget(actor, db, userId); // also the check that stops cross-business unban via the Auth Admin API below
  const admin = createAdminClient();
  const { error: dbError } = await db.from('users').update({ is_active: true }).eq('id', userId);
  if (dbError) throw appError(dbError.message);
  const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (authError) throw appError(authError.message);
  await writeAudit(actor.user.id, userId, 'edited', { action: 'reactivated' });
  revalidatePath('/settings/users');
  return { ok: true };
}
