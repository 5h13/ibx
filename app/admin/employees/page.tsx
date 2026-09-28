import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { scopeToBusiness } from '@/core/auth/businessScope';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import EmployeeManagement from '@/modules/admin/employees/EmployeeManagement';

export default async function EmployeesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const canManage = isAdminTier(profile) || profile.user.section_code === 'admin' || profile.access.some((a) => a.section_code === 'admin');
  if (!canManage) redirect('/dashboard');
  const canViewConfidential = isAdminTier(profile) || profile.access.some((a) => a.section_code === 'admin' && a.workflow_role === 'approver');

  // Build 52 (CC-01-class fix): employees + HR masters now read through the
  // session client so business-isolation RLS applies (previously service role,
  // which listed every business's employees).
  const db = createClient();
  // The employee<->user-account link picker needs every user in the business,
  // but `users` RLS only lets an admin-section (non-business_admin) user see
  // their own row. Sanctioned exception: service role with an explicit
  // business filter (see core/auth/businessScope.ts), minimal columns only.
  const admin = createAdminClient();
  const [{ data: employees, error: employeeError }, { data: users, error: usersError }, { data: departments, error: deptError }, { data: positions, error: posError }, { data: workLocations, error: locError }] = await Promise.all([
    db.from('employees').select('*').order('last_name').order('first_name'),
    scopeToBusiness(admin.from('users').select('id,email,full_name,role,is_active'), profile).order('email'),
    db.from('hr_departments').select('id,name,active').order('name'),
    db.from('hr_positions').select('id,name,active').order('name'),
    db.from('work_locations').select('id,name,active').order('name'),
  ]);
  if (employeeError) throw new Error(employeeError.message);
  if (usersError) throw new Error(usersError.message);
  if (deptError) throw new Error(deptError.message);
  if (posError) throw new Error(posError.message);
  if (locError) throw new Error(locError.message);

  // U009 — CONFIDENTIAL notes: the form hides the field for non-approvers, but
  // the value was still shipped in the page payload. Strip it server-side.
  const visibleEmployees = canViewConfidential ? (employees ?? []) : (employees ?? []).map((e: any) => ({ ...e, notes: null }));

  return <AuthedShell profile={profile}><EmployeeManagement employees={visibleEmployees as any} users={(users ?? []) as any} departments={(departments ?? []) as any} positions={(positions ?? []) as any} workLocations={(workLocations ?? []) as any} canDelete={isAdminTier(profile)} canViewConfidential={canViewConfidential} /></AuthedShell>;
}
