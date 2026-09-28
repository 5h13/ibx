'use server';
import { appError } from '@/core/errors/appError';

// U011 — Employee Self-Service.
//
// Deliberately narrow: a signed-in employee may edit only their own contact
// details (phone, personal email, structured address) and their own
// emergency contacts — never employment fields (department, position,
// status, hire/separation dates), never the CONFIDENTIAL fields (notes,
// government IDs), and never any OTHER employee's record.
//
// employees' only SELECT/UPDATE RLS policies are admin-or-super-admin (there
// is no self-row policy — confirmed by inspection, consistent with the
// Group 2 finding that self-service never got one), so a self-service write
// through the user-scoped client would simply be rejected by RLS. Rather
// than add a genuine self-row RLS UPDATE policy (RLS is row-level, not
// column-level, so it could not by itself stop a self-service user from
// writing to employment_status, notes, etc.), this follows the codebase's
// existing, established convention for a non-confidential field-level
// restriction: a service-role write, gated by an app-layer ownership check
// and a hardcoded field allowlist — the same shape as employees.ts's own
// requireAdmin()-gated actions, just scoped to "self" instead of "admin".
// The write always targets the caller's OWN employee row, resolved
// server-side from getSessionProfile(), never from a client-supplied
// employee id, and the .eq(...) ownership clauses below are kept as a
// second, redundant guard even though the service-role client does not
// need them to succeed.

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  return value || null;
}

async function requireOwnEmployee() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  const admin = createAdminClient();
  const { data: employee, error } = await admin.from('employees').select('id').eq('user_id', profile.user.id).maybeSingle();
  if (error) throw appError(error.message);
  if (!employee) throw appError('No employee record is linked to your account.');
  return { profile, employeeId: employee.id as string };
}

async function auditSelf(actorId: string, employeeId: string, action: string, detail: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin.from('audit_log').insert({ actor_id: actorId, entity_table: 'employees', entity_id: employeeId, action, detail });
  if (error) throw appError(error.message);
}

const SELF_SERVICE_FIELDS = ['phone', 'personal_email', 'address_line1', 'address_line2', 'city', 'province', 'postal_code'] as const;

export async function updateOwnContactInfoAction(formData: FormData) {
  const { profile, employeeId } = await requireOwnEmployee();
  const payload: Record<string, string | null> = {};
  for (const field of SELF_SERVICE_FIELDS) payload[field] = optional(formData, field);

  const admin = createAdminClient();
  const { error } = await admin.from('employees').update(payload).eq('id', employeeId).eq('user_id', profile.user.id);
  if (error) throw appError(error.message);

  await auditSelf(profile.user.id, employeeId, 'self_edited', { fields: Object.keys(payload) });
  revalidatePath('/profile');
  return { ok: true };
}

export async function addOwnEmergencyContactAction(formData: FormData) {
  const { profile, employeeId } = await requireOwnEmployee();
  const name = String(formData.get('name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  if (!name) throw appError('Contact name is required.');
  if (!phone) throw appError('Contact phone is required.');
  const relationship = optional(formData, 'relationship');
  const isPrimary = formData.get('is_primary') === 'on';

  const admin = createAdminClient();
  if (isPrimary) {
    await admin.from('employee_emergency_contacts').update({ is_primary: false }).eq('employee_id', employeeId);
  }
  const { error } = await admin.from('employee_emergency_contacts').insert({ employee_id: employeeId, name, relationship, phone, is_primary: isPrimary });
  if (error) throw appError(error.message);

  await auditSelf(profile.user.id, employeeId, 'self_edited', { emergency_contact: 'added' });
  revalidatePath('/profile');
  return { ok: true };
}

export async function deleteOwnEmergencyContactAction(formData: FormData) {
  const { profile, employeeId } = await requireOwnEmployee();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw appError('Contact id is required.');

  const admin = createAdminClient();
  // Scoped to the caller's own employee_id so a self-service user can never
  // delete another employee's emergency contact by guessing an id.
  const { error } = await admin.from('employee_emergency_contacts').delete().eq('id', id).eq('employee_id', employeeId);
  if (error) throw appError(error.message);

  await auditSelf(profile.user.id, employeeId, 'self_edited', { emergency_contact: 'removed' });
  revalidatePath('/profile');
  return { ok: true };
}
