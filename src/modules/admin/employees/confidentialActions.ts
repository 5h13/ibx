'use server';
import { appError } from '@/core/errors/appError';

// U009 — Confidential Employee Information: government/statutory IDs.
//
// Unlike the rest of src/modules/admin/*/actions.ts, these actions use the
// USER-SCOPED client (createClient(), anon key + session cookie) rather than
// createClient() (service role). This is deliberate: the service-role
// client bypasses Postgres RLS entirely, which is how every other "admin
// all" policy in this system is already implicitly enforced only at the
// application layer, not the database layer (see the implementation report
// for this finding — it applies system-wide, not just here).
//
// For a CONFIDENTIAL table, that's not acceptable: RLS has to be the actual
// boundary, which means the query must run as the authenticated user so
// employee_government_ids_approver_all (is_super_admin() OR
// has_workflow_role(admin, 'approver')) is genuinely evaluated by Postgres,
// not skipped. A JS-level check is layered on top purely to give a clearer
// error message before the round-trip, not as the real gate.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

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

async function requireAdminApprover() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  const isApprover =
    profile.user.role === 'super_admin' ||
    profile.access.some((a) => a.section_code === 'admin' && a.workflow_role === 'approver');
  if (!isApprover) throw appError('Only an Admin approver or Super Admin may access confidential employee identification records.');
  return profile;
}

// Audit trail for confidential-table changes: written via the service-role
// client into the same shared audit_log table employees.ts uses, but the
// id_number VALUE is never written — only that a record of this id_type was
// added/changed/removed, per the approved redaction rule. This mirrors the
// employees.ts audit() contract (adds a field_changes-style entry without
// altering the existing detail shape other server actions rely on).
async function auditConfidential(actorId: string, employeeId: string, action: string, idType: string) {
  const admin = createClient();
  const { error } = await admin.from('audit_log').insert({
    actor_id: actorId,
    entity_table: 'employee_government_ids',
    entity_id: employeeId,
    action,
    detail: { id_type: idType, id_number: '[redacted]' },
  });
  if (error) throw appError(error.message);
}

export async function listEmployeeGovernmentIdsAction(employeeId: string) {
  await requireAdminApprover();
  const db = createClient(); // user-scoped — RLS enforced
  const { data, error } = await db
    .from('employee_government_ids')
    .select('id,employee_id,id_type,id_number,issued_date,expiry_date,created_at,updated_at')
    .eq('employee_id', employeeId)
    .order('id_type');
  if (error) throw appError(error.message);
  return data ?? [];
}

export async function upsertEmployeeGovernmentIdAction(formData: FormData) {
  const actor = await requireAdminApprover();
  const employeeId = required(formData, 'employee_id');
  const idType = required(formData, 'id_type');
  const idNumber = required(formData, 'id_number');
  const issuedDate = optional(formData, 'issued_date');
  const expiryDate = optional(formData, 'expiry_date');

  const db = createClient(); // user-scoped — RLS enforced, this is the real boundary
  const { error } = await db
    .from('employee_government_ids')
    .upsert(
      {
        ...biz(actor),
        employee_id: employeeId,
        id_type: idType,
        id_number: idNumber,
        issued_date: issuedDate,
        expiry_date: expiryDate,
        created_by: actor.user.id,
      },
      { onConflict: 'employee_id,id_type' }
    );
  if (error) throw appError(error.message);

  await auditConfidential(actor.user.id, employeeId, 'edited', idType);
  revalidatePath('/admin/employees');
  return { ok: true };
}

export async function deleteEmployeeGovernmentIdAction(formData: FormData) {
  const actor = await requireAdminApprover();
  const id = required(formData, 'id');
  const employeeId = required(formData, 'employee_id');
  const idType = required(formData, 'id_type');

  const db = createClient(); // user-scoped — RLS enforced
  const { error } = await db.from('employee_government_ids').delete().eq('id', id);
  if (error) throw appError(error.message);

  await auditConfidential(actor.user.id, employeeId, 'deleted', idType);
  revalidatePath('/admin/employees');
  return { ok: true };
}

// ----------------------------------------------------------------------------
// U012 — Employee Change History.
//
// Group 2 finding: audit_log's ONLY select policy in the schema is
// `audit_select_super_admin` (is_super_admin() only) — there is no
// section-scoped read policy despite a stale comment nearby suggesting one.
// The one existing consumer of audit_log for display (app/integration/page.tsx)
// is itself gated to super_admin only, confirming this is the actual,
// already-established system-wide access model, not something new here.
//
// Per the Group 2 authorization: "if the existing audit architecture cannot
// safely provide this distinction, STOP and report the limitation rather
// than creating a broad new audit-access policy." Admin approvers/preparers/
// reviewers do NOT get Change History in this group — only Super Admin does,
// matching the existing model exactly. Broadening this to Admin approvers
// would require a deliberate new audit_log access decision, which is not
// made unilaterally here. Flagged in the implementation report.
//
// The user-scoped client is used specifically so this restriction is
// DB-enforced (RLS), not just an app-layer check duplicating it.
export async function listEmployeeChangeHistoryAction(employeeId: string) {
  const profile = await getSessionProfile();
  if (!profile || profile.user.role !== 'super_admin') {
    throw appError('Only Super Admin may view employee change history in this build.');
  }

  const db = createClient(); // user-scoped — audit_select_super_admin RLS is the real gate
  const { data, error } = await db
    .from('audit_log')
    .select('id,actor_id,entity_table,action,from_status,to_status,detail,created_at')
    .eq('entity_id', employeeId)
    .in('entity_table', ['employees', 'employee_government_ids'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw appError(error.message);

  const rows = data ?? [];
  const actorIds = Array.from(new Set(rows.map((r: any) => r.actor_id).filter(Boolean)));
  let actorNames = new Map<string, string>();
  if (actorIds.length) {
    // Actor display names are not confidential; a plain service-role lookup
    // here is consistent with how the rest of the app resolves user names.
    const admin = createClient();
    const { data: users } = await admin.from('users').select('id,full_name,email').in('id', actorIds);
    actorNames = new Map((users ?? []).map((u: any) => [u.id, u.full_name || u.email]));
  }

  return rows.map((r: any) => ({ ...r, actor_name: actorNames.get(r.actor_id) ?? 'Unknown' }));
}
