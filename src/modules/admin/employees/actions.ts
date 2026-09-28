'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { isAdminTier, type SessionProfile } from '@/core/auth/types';
import { scopeToBusiness } from '@/core/auth/businessScope';

type EmployeeStatus = 'active' | 'probationary' | 'on_leave' | 'suspended' | 'inactive' | 'separated';
type EmploymentType = 'regular' | 'probationary' | 'contractual' | 'part_time' | 'project_based' | 'intern';

// U015 — 'suspended' added to the DB enum (migration 20261030) to match what
// the UI has always offered; setEmployeeStatusAction previously rejected it
// with "Invalid employment status." the moment anyone selected it.
const STATUSES: EmployeeStatus[] = ['active', 'probationary', 'on_leave', 'suspended', 'inactive', 'separated'];
const TYPES: EmploymentType[] = ['regular', 'probationary', 'contractual', 'part_time', 'project_based', 'intern'];

function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  if (!value) throw appError(`${key.replaceAll('_', ' ')} is required.`);
  return value;
}
function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? '').trim();
  return value || null;
}
function validateEnum<T extends string>(value: string, values: T[], label: string): asserts value is T {
  if (!values.includes(value as T)) throw appError(`Invalid ${label}.`);
}

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  // Build 52: isAdminTier (super_admin OR business_admin), matching the page
  // gate — this was the one Admin action helper Build 41's isAdminTier sweep
  // missed, so a Business Super Admin could open /admin/employees but every
  // save was rejected with "Admin access required."
  if (!isAdminTier(profile) && profile.user.section_code !== 'admin' && !profile.access.some((a) => a.section_code === 'admin')) {
    throw appError('Admin access required.');
  }
  return profile;
}

// The user picker lists every user in the actor's business, but `users` RLS
// only lets an admin-section (non-business_admin) user read their own row, so
// the session client can't confirm the pick. Service role with an explicit
// business filter (core/auth/businessScope.ts pattern 1): the linked account
// must exist AND belong to the actor's own business.
async function assertLinkableUser(actor: SessionProfile, userId: string) {
  const svc = createAdminClient();
  const { data: user, error } = await scopeToBusiness(svc.from('users').select('id').eq('id', userId), actor).maybeSingle();
  if (error) throw appError(error.message);
  if (!user) throw appError('Selected user was not found.');
}

async function audit(actorId: string, employeeId: string, action: string, detail: Record<string, unknown>) {
  const admin = createClient();
  const { error } = await admin.from('audit_log').insert({
    actor_id: actorId,
    entity_table: 'employees',
    entity_id: employeeId,
    action,
    detail,
  });
  if (error) throw appError(error.message);
}

// U013/U014 — employee_no is no longer accepted from the form: the
// employees_guard_employee_no trigger (migration 20261030) generates it
// (EMP-####) on INSERT when omitted/blank and rejects any change on UPDATE,
// the same system-controlled-identifier pattern as pr_number/po_number/
// supplier_code. Department/position/work location are now selected from
// the controlled hr_departments/hr_positions/work_locations masters
// (department_id/position_id/work_location_id); the legacy free-text
// department/position_title columns are still accepted and kept in sync as
// a display fallback for records that predate the masters, exactly as
// Build 42 established.
// U009 — who may read/write the CONFIDENTIAL employees.notes field. Same rule
// as app/admin/employees/page.tsx's canViewConfidential.
function canEditConfidential(profile: SessionProfile) {
  return isAdminTier(profile) || profile.access.some((a) => a.section_code === 'admin' && a.workflow_role === 'approver');
}

function employeePayload(formData: FormData, includeNotes: boolean) {
  const firstName = required(formData, 'first_name');
  const lastName = required(formData, 'last_name');
  const employmentType = required(formData, 'employment_type');
  const employmentStatus = required(formData, 'employment_status');
  validateEnum(employmentType, TYPES, 'employment type');
  validateEnum(employmentStatus, STATUSES, 'employment status');

  const hireDate = optional(formData, 'hire_date');
  const separationDate = optional(formData, 'separation_date');
  if (hireDate && separationDate && separationDate < hireDate) {
    throw appError('Separation date cannot be before hire date.');
  }
  if (employmentStatus === 'separated' && !separationDate) {
    throw appError('A separation date is required when setting status to separated.');
  }

  return {
    department_id: optional(formData, 'department_id'),
    position_id: optional(formData, 'position_id'),
    work_location_id: optional(formData, 'work_location_id'),
    supervisor_employee_id: optional(formData, 'supervisor_employee_id'),
    first_name: firstName,
    middle_name: optional(formData, 'middle_name'),
    last_name: lastName,
    suffix: optional(formData, 'suffix'),
    preferred_name: optional(formData, 'preferred_name'),
    department: optional(formData, 'department'),
    position_title: optional(formData, 'position_title'),
    employment_type: employmentType,
    employment_status: employmentStatus,
    hire_date: hireDate,
    separation_date: separationDate,
    work_email: optional(formData, 'work_email'),
    personal_email: optional(formData, 'personal_email'),
    phone: optional(formData, 'phone'),
    address: optional(formData, 'address'),
    address_line1: optional(formData, 'address_line1'),
    address_line2: optional(formData, 'address_line2'),
    city: optional(formData, 'city'),
    province: optional(formData, 'province'),
    postal_code: optional(formData, 'postal_code'),
    emergency_contact_name: optional(formData, 'emergency_contact_name'),
    emergency_contact_phone: optional(formData, 'emergency_contact_phone'),
    // Build 52 fix: the notes textarea is only rendered for approvers, so a
    // non-approver's form never posts `notes` — previously this still wrote
    // notes = null and silently wiped the confidential notes on every
    // non-approver edit. Only touch notes when the actor may edit it AND the
    // field was actually posted.
    ...(includeNotes && formData.has('notes') ? { notes: optional(formData, 'notes') } : {}),
  };
}

export async function createEmployeeAction(formData: FormData) {
  const actor = await requireAdmin();
  const userId = optional(formData, 'user_id');
  const payload = employeePayload(formData, canEditConfidential(actor));
  const admin = createClient();

  if (userId) {
    const { data: linked } = await admin.from('employees').select('id').eq('user_id', userId).maybeSingle();
    if (linked) throw appError('That user is already linked to an employee record.');
    await assertLinkableUser(actor, userId);
  }

  // employee_no omitted deliberately -- the DB trigger generates it.
  const { data, error } = await admin.from('employees').insert({ ...biz(actor), ...payload, user_id: userId }).select('id,employee_no').single();
  if (error || !data) throw appError(error?.message ?? 'Unable to create employee.');
  await audit(actor.user.id, data.id, 'created', { employee_no: data.employee_no, user_id: userId });
  revalidatePath('/admin/employees');
  return { ok: true };
}

export async function updateEmployeeAction(formData: FormData) {
  const actor = await requireAdmin();
  const employeeId = required(formData, 'employee_id');
  const userId = optional(formData, 'user_id');
  const payload = employeePayload(formData, canEditConfidential(actor));
  const admin = createClient();

  if (userId) {
    const { data: linked } = await admin.from('employees').select('id').eq('user_id', userId).neq('id', employeeId).maybeSingle();
    if (linked) throw appError('That user is already linked to another employee record.');
    await assertLinkableUser(actor, userId);
  }
  if (payload.supervisor_employee_id === employeeId) {
    throw appError('An employee cannot be their own supervisor.');
  }

  // employee_no intentionally excluded -- immutable, DB-enforced.
  const { error } = await admin.from('employees').update({ ...payload, user_id: userId }).eq('id', employeeId);
  if (error) throw appError(error.message);
  await audit(actor.user.id, employeeId, 'edited', { user_id: userId, status: payload.employment_status });
  revalidatePath('/admin/employees');
  return { ok: true };
}

export async function deleteEmployeeAction(formData: FormData) {
  const actor = await requireAdmin();
  if (actor.user.role !== 'super_admin') throw appError('Only Super Admin can permanently delete employee records.');
  const employeeId = required(formData, 'employee_id');
  const admin = createClient();
  const { data: employee } = await admin.from('employees').select('id,employee_no').eq('id', employeeId).maybeSingle();
  if (!employee) throw appError('Employee not found.');
  const { error } = await admin.from('employees').delete().eq('id', employeeId);
  if (error) throw appError(error.message);
  await audit(actor.user.id, employeeId, 'deleted', { employee_no: employee.employee_no });
  revalidatePath('/admin/employees');
  return { ok: true };
}

export async function setEmployeeStatusAction(formData: FormData) {
  const actor = await requireAdmin();
  const employeeId = required(formData, 'employee_id');
  const status = required(formData, 'employment_status');
  validateEnum(status, STATUSES, 'employment status');
  const separationDate = optional(formData, 'separation_date');
  const admin = createClient();
  // U015 — the DB's guard_employee_status_transition trigger requires a
  // separation_date whenever status is set to 'separated', and requires it
  // cleared when moving OUT of 'separated'. Provide both cases here so the
  // quick-status dropdown gets a clear application error instead of a raw
  // Postgres one.
  const patch: Record<string, unknown> = { employment_status: status };
  if (status === 'separated') {
    if (!separationDate) throw appError('A separation date is required when setting status to separated.');
    patch.separation_date = separationDate;
  } else {
    const { data: current } = await admin.from('employees').select('employment_status,separation_date').eq('id', employeeId).maybeSingle();
    if (current?.employment_status === 'separated' && current.separation_date) patch.separation_date = null;
  }
  const { error } = await admin.from('employees').update(patch).eq('id', employeeId);
  if (error) throw appError(error.message);
  await audit(actor.user.id, employeeId, 'edited', { employment_status: status });
  revalidatePath('/admin/employees');
  return { ok: true };
}
