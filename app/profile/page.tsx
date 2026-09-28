import { redirect } from 'next/navigation';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthedShell } from '@/core/layout/AuthedShell';
import EmployeeProfile from '@/modules/admin/employees/EmployeeProfile';
import SuperAdminAccountProfile from '@/modules/profile/SuperAdminAccountProfile';

const PROFILE_COLUMNS = [
  'id', 'employee_no', 'user_id', 'first_name', 'middle_name', 'last_name', 'suffix', 'preferred_name',
  'department', 'position_title', 'employment_type', 'employment_status', 'hire_date', 'separation_date',
  'work_email', 'personal_email', 'phone', 'address', 'address_line1', 'address_line2', 'city', 'province', 'postal_code',
  'emergency_contact_name', 'emergency_contact_phone', 'supervisor_employee_id', 'department_id', 'position_id', 'work_location_id',
  'created_at', 'updated_at',
  'department_master:hr_departments(id,name)',
  'position_master:hr_positions(id,name)',
  'work_location_ref:work_locations(id,name)',
  'supervisor:employees!supervisor_employee_id(id,employee_no,first_name,last_name,preferred_name)',
].join(',');

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Global Super Admin', business_admin: 'Business Admin', admin: 'Admin', finance: 'Finance', logistics: 'Logistics', marketing: 'Marketing', sales: 'Sales',
};

export default async function MyProfilePage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');

  // Universal self-read: the employee record is resolved from the authenticated
  // user's employee link, never from a user-supplied employee id.
  // Build 52 audit: deliberately KEPT on the service-role client — not a
  // CC-01-class leak. Every query below is keyed to the caller's own user id
  // (or the employee id derived from it server-side), so it can only ever
  // return the caller's own data; and `employees` has no self-SELECT RLS
  // policy, so the session client would 404 every non-admin employee. Same
  // documented pattern as profile/selfServiceActions.ts (Build 48).
  const db = createAdminClient();
  const { data: employee, error } = await db
    .from('employees')
    .select(PROFILE_COLUMNS)
    .eq('user_id', profile.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  // U019 — Universal My Employee Profile. A Global Super Admin genuinely has
  // no `employees` row (employees.business_id is NOT NULL, and this account
  // deliberately has business_id = null — see
  // 20261015_a001_business_structure_seed.sql). Before this fix, every other
  // role got a working profile page while this one account got a 404 — the
  // opposite of "universal". Give it an honest account-level view instead of
  // pretending it has employee data, and reserve notFound() for the case this
  // was actually guarding against: a non-super-admin user whose employee link
  // is missing/broken, which is a real data problem worth surfacing as 404.
  if (!employee) {
    // Build 72 (U064): an account with no linked employee record gets the
    // account-level view (not a 404).
    const { data: userRow, error: userError } = await db
      .from('users')
      .select('created_at')
      .eq('id', profile.user.id)
      .single();
    if (userError) throw new Error(userError.message);
    let businessName: string | null = null;
    if (profile.user.role !== 'super_admin' && profile.user.business_id) {
      const { data: biz } = await db.from('businesses').select('legal_name,trade_name').eq('id', profile.user.business_id).maybeSingle();
      businessName = (biz as any)?.trade_name || (biz as any)?.legal_name || null;
    }
    return (
      <AuthedShell profile={profile}>
        <SuperAdminAccountProfile
          fullName={profile.user.full_name}
          email={profile.user.email}
          createdAt={(userRow as any).created_at}
          superAdmin={profile.user.role === 'super_admin'}
          roleLabel={ROLE_LABEL[profile.user.role] ?? profile.user.role}
          businessName={businessName}
        />
      </AuthedShell>
    );
  }

  const [{ data: emergencyContacts, error: contactsError }, { data: driver, error: driverError }, { data: documentsRaw, error: documentsError }] = await Promise.all([
    db.from('employee_emergency_contacts')
      .select('id,name,relationship,phone,is_primary')
      .eq('employee_id', (employee as any).id)
      .order('is_primary', { ascending: false }),
    db.from('fleet_drivers')
      .select('id,license_type,license_expiry,authorized')
      .eq('employee_id', (employee as any).id)
      .maybeSingle(),
    // U024 — a self-service viewer never sees confidential document types.
    db.from('employee_documents')
      .select('id,document_name,document_number,issued_date,expiry_date,status,original_file_name,type:employee_document_types(name,confidential)')
      .eq('employee_id', (employee as any).id)
      .order('expiry_date', { ascending: true, nullsFirst: false }),
  ]);
  if (contactsError) throw new Error(contactsError.message);
  if (driverError) throw new Error(driverError.message);
  if (documentsError) throw new Error(documentsError.message);
  const documents = (documentsRaw ?? []).filter((d: any) => !d.type?.confidential);

  return (
    <AuthedShell profile={profile}>
      <div className="mb-3 flex justify-end"><a href="/account/change-password" className="rounded border bg-white px-3 py-2 text-sm">Change password</a></div>
      <EmployeeProfile
        employee={{ ...(employee as any), notes: null }}
        emergencyContacts={emergencyContacts ?? []}
        driver={driver ? { ...(driver as any), license_no: null } : null}
        governmentIds={[]}
        changeHistory={[]}
        documents={documents as any}
        canViewConfidential={false}
        canViewChangeHistory={false}
        selfView
      />
    </AuthedShell>
  );
}
