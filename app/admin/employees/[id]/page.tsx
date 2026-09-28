import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import EmployeeProfile from '@/modules/admin/employees/EmployeeProfile';
import { listEmployeeGovernmentIdsAction, listEmployeeChangeHistoryAction } from '@/modules/admin/employees/confidentialActions';

// U010 — General-tier column list, explicitly excluding the CONFIDENTIAL
// `notes` field (mirrors app/admin/employees/page.tsx from Group 1).
// Department/position/work-location/supervisor are resolved via the new
// Group 1 FK columns where populated; the legacy free-text columns are kept
// alongside them so a record that hasn't been assigned a controlled master
// yet still displays something.
const PROFILE_COLUMNS = [
  'id', 'employee_no', 'user_id', 'first_name', 'middle_name', 'last_name', 'suffix', 'preferred_name',
  'department', 'position_title', 'employment_type', 'employment_status',
  'hire_date', 'separation_date', 'work_email', 'personal_email', 'phone',
  'address', 'address_line1', 'address_line2', 'city', 'province', 'postal_code',
  'emergency_contact_name', 'emergency_contact_phone',
  'supervisor_employee_id', 'department_id', 'position_id', 'work_location_id',
  'created_at', 'updated_at',
  'department_master:hr_departments(id,name)',
  'position_master:hr_positions(id,name)',
  'work_location_ref:work_locations(id,name)',
  'supervisor:employees!supervisor_employee_id(id,employee_no,first_name,last_name,preferred_name)',
].join(',');

export default async function EmployeeProfilePage({ params }: { params: { id: string } }) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const canManage =
    isAdminTier(profile) ||
    profile.user.section_code === 'admin' ||
    profile.access.some((a) => a.section_code === 'admin');
  if (!canManage) redirect('/dashboard');

  // Gates the CONFIDENTIAL notes/license fields (business-scoped employee
  // data) — safe to extend to a Business Super Admin.
  const isApprover =
    isAdminTier(profile) ||
    profile.access.some((a) => a.section_code === 'admin' && a.workflow_role === 'approver');
  // Government-ID visibility is Global-only, deliberately (confidentialActions.ts's
  // own requireAdminApprover() gate, mirrored here, does NOT include
  // business_admin — calling that action as a business_admin would just
  // throw). Kept as its own literal check rather than isApprover/isAdminTier.
  const canViewGovernmentIds =
    profile.user.role === 'super_admin' ||
    profile.access.some((a) => a.section_code === 'admin' && a.workflow_role === 'approver');
  // Global-only, deliberately: audit_log change history stays super_admin-only
  // even for a Business Super Admin (audit_log's only SELECT policy is
  // super-admin-only and has no business_id column to scope by).
  const isSuperAdmin = profile.user.role === 'super_admin';

  // Build 52 (CC-01-class fix): session-scoped client, so business-isolation
  // RLS applies. Previously service role — any admin-section user could open
  // /admin/employees/<id> for an employee of ANY business by id. Now a
  // cross-business id resolves to no row and 404s below.
  const db = createClient();

  const { data: employee, error } = await db
    .from('employees')
    .select(PROFILE_COLUMNS)
    .eq('id', params.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!employee) notFound();

  // U009 — notes (CONFIDENTIAL): fetched separately, only for approvers.
  let notes: string | null = null;
  if (isApprover) {
    const { data: notesRow, error: notesError } = await db.from('employees').select('notes').eq('id', params.id).maybeSingle();
    if (notesError) throw new Error(notesError.message);
    notes = (notesRow as any)?.notes ?? null;
  }

  const { data: emergencyContacts, error: contactsError } = await db
    .from('employee_emergency_contacts')
    .select('id,name,relationship,phone,is_primary')
    .eq('employee_id', params.id)
    .order('is_primary', { ascending: false });
  if (contactsError) throw new Error(contactsError.message);

  // U008 — Driver tab reads from the EXISTING fleet_drivers table; no
  // duplicated license fields on employees. General fields only here;
  // license_no (CONFIDENTIAL) is fetched separately for approvers, mirroring
  // the Group 2 Fleet page pattern exactly.
  const { data: driver, error: driverError } = await db
    .from('fleet_drivers')
    .select('id,license_type,license_expiry,authorized,created_at')
    .eq('employee_id', params.id)
    .maybeSingle();
  if (driverError) throw new Error(driverError.message);

  let driverLicenseNo: string | null = null;
  if (driver && isApprover) {
    const { data: licenseRow, error: licenseError } = await db
      .from('fleet_drivers')
      .select('license_no')
      .eq('id', driver.id)
      .maybeSingle();
    if (licenseError) throw new Error(licenseError.message);
    driverLicenseNo = (licenseRow as any)?.license_no ?? null;
  }

  // U009 — government/statutory IDs (CONFIDENTIAL): the confidentialActions
  // helper already enforces its own approver check via RLS on a user-scoped
  // client; for a non-approver we skip the call entirely (it would throw)
  // and simply show nothing, since the UI shouldn't surface an error for a
  // section the viewer isn't authorized to see at all.
  const governmentIds = canViewGovernmentIds ? await listEmployeeGovernmentIdsAction(params.id) : [];

  // U024 — Documents tab: reuses the existing employee_documents feature
  // (app/admin/documents) rather than a parallel table. Confidential
  // document types are dropped from the array for a non-approver, mirroring
  // the government-ID pattern above (skip, don't error).
  const { data: documentsRaw, error: documentsError } = await db
    .from('employee_documents')
    .select('id,document_name,document_number,issued_date,expiry_date,status,original_file_name,type:employee_document_types(name,confidential)')
    .eq('employee_id', params.id)
    .order('expiry_date', { ascending: true, nullsFirst: false });
  if (documentsError) throw new Error(documentsError.message);
  const documents = (documentsRaw ?? []).filter((d: any) => isApprover || !d.type?.confidential);

  // U012 — Change History: Super Admin only, per the Group 2 audit-access
  // finding (audit_log's only SELECT policy is super-admin-only). Skipped
  // entirely for non-super-admins rather than calling and catching an error.
  const changeHistory = isSuperAdmin ? await listEmployeeChangeHistoryAction(params.id) : [];

  return (
    <AuthedShell profile={profile}>
      <EmployeeProfile
        employee={{ ...(employee as any), notes }}
        emergencyContacts={emergencyContacts ?? []}
        driver={driver ? { ...(driver as any), license_no: driverLicenseNo } : null}
        governmentIds={governmentIds as any}
        changeHistory={changeHistory as any}
        documents={documents as any}
        canViewConfidential={isApprover}
        canViewChangeHistory={isSuperAdmin}
      />
    </AuthedShell>
  );
}
