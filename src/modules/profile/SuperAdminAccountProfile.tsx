// U019 — Universal My Employee Profile.
//
// A Global Super Admin ("5H13 Business Solutions" identity) has no
// `employees` row: employees.business_id is NOT NULL, and the Global Super
// Admin deliberately has business_id = null (see
// 20261015_a001_business_structure_seed.sql) — they operate above every
// business, not inside one, so there is no business to attach an employee
// record to. Before this fix, /profile called notFound() for this account,
// meaning the one account this whole app is organized around ("Universal"
// per the requirement) could not open its own profile page at all. This is
// the graceful, honest account-level view for that case: it never invents
// employee fields (department, hire date, etc.) that do not exist for this
// account, and says plainly why there is no employee record to show.

type Props = {
  fullName: string | null;
  email: string;
  createdAt: string;
};

export default function SuperAdminAccountProfile({ fullName, email, createdAt }: Props) {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Account</h1>
        <p className="text-sm text-slate-500">Global Super Admin account details.</p>
      </div>

      <div className="rounded bg-white p-6 shadow-sm space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium text-slate-500">Name</div>
            <div className="text-sm text-slate-900">{fullName || '—'}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Email</div>
            <div className="text-sm text-slate-900">{email}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Role</div>
            <div className="text-sm text-slate-900">Global Super Admin</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Account since</div>
            <div className="text-sm text-slate-900">{new Date(createdAt).toLocaleDateString()}</div>
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          This account represents 5H13 Business Solutions and operates above every
          individual business (Pili, Aton, Ishabella), so it has no employee
          record in any one business — there is nothing to show under Personal,
          Employment, or Documents for this account. Use the business switcher
          above to view or work within a specific business.
        </div>
      </div>
    </div>
  );
}
