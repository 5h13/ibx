'use client';
import { errorText } from '@/core/errors/appError';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import {
  upsertEmployeeGovernmentIdAction,
  deleteEmployeeGovernmentIdAction,
} from './confidentialActions';
import {
  updateOwnContactInfoAction,
  addOwnEmergencyContactAction,
  deleteOwnEmergencyContactAction,
} from '@/modules/profile/selfServiceActions';

type EmergencyContact = { id: string; name: string; relationship: string | null; phone: string; is_primary: boolean };
type GovernmentId = { id: string; id_type: string; id_number: string; issued_date: string | null; expiry_date: string | null };
type Driver = { id: string; license_no: string | null; license_type: string | null; license_expiry: string | null; authorized: boolean };
type ChangeEntry = {
  id: string; actor_name: string; entity_table: string; action: string;
  detail: { field_changes?: { field: string; old: unknown; new: unknown }[] } & Record<string, unknown>;
  created_at: string;
};
type Employee = {
  id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null;
  preferred_name: string | null; department: string | null; position_title: string | null;
  employment_type: string; employment_status: string; hire_date: string | null; separation_date: string | null;
  work_email: string | null; personal_email: string | null; phone: string | null;
  address: string | null; address_line1: string | null; address_line2: string | null; city: string | null; province: string | null; postal_code: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
  department_master: { name: string } | null; position_master: { name: string } | null; work_location_ref: { name: string } | null;
  supervisor: { employee_no: string; first_name: string; last_name: string; preferred_name: string | null } | null;
  notes: string | null; created_at: string; updated_at: string;
};
type EmployeeDocument = {
  id: string; document_name: string; document_number: string | null; issued_date: string | null; expiry_date: string | null;
  status: string; original_file_name: string | null; type: { name: string; confidential?: boolean } | null;
};

const TYPE_LABELS: Record<string, string> = { regular: 'Regular', probationary: 'Probationary', contractual: 'Contractual', part_time: 'Part-time', project_based: 'Project-based', intern: 'Intern' };
const STATUS_LABELS: Record<string, string> = { active: 'Active', probationary: 'Probationary', on_leave: 'On leave', suspended: 'Suspended', inactive: 'Inactive', separated: 'Separated' };

function personName(p: { preferred_name?: string | null; first_name: string; last_name: string } | null | undefined) {
  if (!p) return '—';
  return p.preferred_name || `${p.first_name} ${p.last_name}`;
}

const TABS = ['Personal', 'Employment', 'Contact', 'Emergency Contacts', 'Driver', 'Government / Confidential', 'Documents', 'Change History'] as const;
type Tab = (typeof TABS)[number];

export default function EmployeeProfile({
  employee, emergencyContacts, driver, governmentIds, changeHistory, documents, canViewConfidential, canViewChangeHistory, selfView = false,
}: {
  employee: Employee; emergencyContacts: EmergencyContact[]; driver: Driver | null; governmentIds: GovernmentId[];
  changeHistory: ChangeEntry[]; documents: EmployeeDocument[]; canViewConfidential: boolean; canViewChangeHistory: boolean; selfView?: boolean;
}) {
  const visibleTabs = TABS.filter((t) => t !== 'Change History' || canViewChangeHistory);
  const [tab, setTab] = useState<Tab>('Personal');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {!selfView && <Link href="/admin/employees" className="text-sm text-blue-700 hover:underline">← Back to employees</Link>}
          {selfView && <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">← Back to dashboard</Link>}
          <h1 className="mt-1 text-2xl font-bold">{selfView ? 'My Employee Profile' : personName(employee)}</h1>
          {selfView && <p className="text-sm text-slate-500">{personName(employee)}</p>}
          <p className="text-sm text-slate-500">
            {employee.employee_no} · {STATUS_LABELS[employee.employment_status] ?? employee.employment_status}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-slate-900 font-medium text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-white p-6">
        {tab === 'Personal' && <PersonalTab employee={employee} canViewConfidential={canViewConfidential} />}
        {tab === 'Employment' && <EmploymentTab employee={employee} />}
        {tab === 'Contact' && <ContactTab employee={employee} selfView={selfView} />}
        {tab === 'Emergency Contacts' && <EmergencyTab contacts={emergencyContacts} selfView={selfView} />}
        {tab === 'Driver' && <DriverTab driver={driver} canViewConfidential={canViewConfidential} />}
        {tab === 'Government / Confidential' && (
          <GovernmentTab employeeId={employee.id} governmentIds={governmentIds} canViewConfidential={canViewConfidential} />
        )}
        {tab === 'Documents' && <DocumentsTab documents={documents} />}
        {tab === 'Change History' && canViewChangeHistory && <ChangeHistoryTab entries={changeHistory} />}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-900">{value || '—'}</div>
    </div>
  );
}

function PersonalTab({ employee, canViewConfidential }: { employee: Employee; canViewConfidential: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Employee no." value={employee.employee_no} />
      <Field label="First name" value={employee.first_name} />
      <Field label="Middle name" value={employee.middle_name} />
      <Field label="Last name" value={employee.last_name} />
      <Field label="Suffix" value={employee.suffix} />
      <Field label="Preferred name" value={employee.preferred_name} />
      <div className="sm:col-span-2 lg:col-span-3">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          Notes {!canViewConfidential && <span className="normal-case text-slate-300">(confidential — Admin approvers only)</span>}
        </div>
        <div className="whitespace-pre-wrap text-sm text-slate-900">
          {canViewConfidential ? employee.notes || '—' : '— (not visible to your role)'}
        </div>
      </div>
    </div>
  );
}

function EmploymentTab({ employee }: { employee: Employee }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Department" value={employee.department_master?.name || employee.department} />
      <Field label="Position" value={employee.position_master?.name || employee.position_title} />
      <Field label="Employment type" value={TYPE_LABELS[employee.employment_type] ?? employee.employment_type} />
      <Field label="Employment status" value={STATUS_LABELS[employee.employment_status] ?? employee.employment_status} />
      <Field label="Hire date" value={employee.hire_date} />
      <Field label="Separation date" value={employee.separation_date} />
      <Field label="Supervisor" value={employee.supervisor ? `${employee.supervisor.employee_no} — ${personName(employee.supervisor)}` : null} />
      <Field label="Work location" value={employee.work_location_ref?.name} />
    </div>
  );
}

function ContactTab({ employee, selfView }: { employee: Employee; selfView: boolean }) {
  const structuredAddress = [employee.address_line1, employee.address_line2, employee.city, employee.province, employee.postal_code].filter(Boolean).join(', ');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // U011 — Employee Self-Service: only the caller's own profile (selfView)
  // may edit, and only these fields — never employment fields, never notes.
  if (!selfView) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Work email" value={employee.work_email} />
        <Field label="Personal email" value={employee.personal_email} />
        <Field label="Phone" value={employee.phone} />
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Address" value={structuredAddress || employee.address} />
        </div>
      </div>
    );
  }

  async function submit(fd: FormData, close: () => void) {
    setBusy(true); setError('');
    try { await updateOwnContactInfoAction(fd); close(); router.refresh(); }
    catch (e: any) { setError(errorText(e) ?? 'Unable to save.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <ActionBar>
        <PopupAction label="Edit my contact info" title="Edit my contact info" notice={error || null}>
          {(close) => (
            <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget), close); }} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm">Phone<input name="phone" defaultValue={employee.phone ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Personal email<input name="personal_email" type="email" defaultValue={employee.personal_email ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Address line 1<input name="address_line1" defaultValue={employee.address_line1 ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Address line 2<input name="address_line2" defaultValue={employee.address_line2 ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">City<input name="city" defaultValue={employee.city ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Province<input name="province" defaultValue={employee.province ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Postal code<input name="postal_code" defaultValue={employee.postal_code ?? ''} className="mt-1 w-full rounded border px-3 py-2" /></label>
              </div>
              <div className="flex gap-2">
                <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">{busy ? 'Saving...' : 'Save'}</button>
                <button type="button" onClick={close} className="rounded border px-4 py-2 text-sm">Cancel</button>
              </div>
            </form>
          )}
        </PopupAction>
      </ActionBar>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Work email" value={employee.work_email} />
        <Field label="Personal email" value={employee.personal_email} />
        <Field label="Phone" value={employee.phone} />
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Address" value={structuredAddress || employee.address} />
        </div>
      </div>
    </div>
  );
}

function EmergencyTab({ contacts, selfView }: { contacts: EmergencyContact[]; selfView: boolean }) {
  const dialog = useDialog();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(fd: FormData, close: () => void) {
    setBusy(true); setError('');
    try { await addOwnEmergencyContactAction(fd); close(); router.refresh(); }
    catch (e: any) { setError(errorText(e) ?? 'Unable to save.'); }
    finally { setBusy(false); }
  }
  async function remove(c: EmergencyContact) {
    if (!(await dialog.confirm(`Remove ${c.name}?`, { tone: 'danger' }))) return;
    setBusy(true); setError('');
    const fd = new FormData(); fd.set('id', c.id);
    try { await deleteOwnEmergencyContactAction(fd); router.refresh(); }
    catch (e: any) { setError(errorText(e) ?? 'Unable to remove.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {selfView && (
        <ActionBar>
          <PopupAction label="+ Add emergency contact" title="Add emergency contact" notice={error || null}>
            {(close) => (
              <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget), close); }} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Name<input name="name" required className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Relationship<input name="relationship" className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">Phone<input name="phone" required className="mt-1 w-full rounded border px-3 py-2" /></label>
                <label className="mt-6 flex items-center gap-2 text-sm"><input name="is_primary" type="checkbox" /> Primary contact</label>
                <div className="flex gap-2 sm:col-span-2">
                  <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">{busy ? 'Saving...' : 'Save'}</button>
                  <button type="button" onClick={close} className="rounded border px-4 py-2 text-sm">Cancel</button>
                </div>
              </form>
            )}
          </PopupAction>
        </ActionBar>
      )}
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {contacts.length === 0 && <p className="text-sm text-slate-500">No emergency contacts on file.</p>}
      {contacts.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded border px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {c.is_primary && <span className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white">Primary</span>}
            </div>
            <div className="text-sm text-slate-500">{c.relationship || 'Relationship not specified'} · {c.phone}</div>
          </div>
          {selfView && <button disabled={busy} onClick={() => remove(c)} className="text-sm text-red-700 hover:underline">Remove</button>}
        </div>
      ))}
    </div>
  );
}

function DriverTab({ driver, canViewConfidential }: { driver: Driver | null; canViewConfidential: boolean }) {
  if (!driver) return <p className="text-sm text-slate-500">This employee is not a registered fleet driver. Driver registration is managed in Fleet.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Authorized" value={driver.authorized ? 'Yes' : 'No'} />
      <Field label="License type" value={driver.license_type} />
      <Field label="License expiry" value={driver.license_expiry} />
      <Field
        label={`License number${canViewConfidential ? '' : ' (confidential — Admin approvers only)'}`}
        value={canViewConfidential ? driver.license_no : '—'}
      />
      <p className="text-xs text-slate-400 sm:col-span-2 lg:col-span-3">Sourced from Fleet's driver record — not duplicated here.</p>
    </div>
  );
}

function GovernmentTab({ employeeId, governmentIds, canViewConfidential }: { employeeId: string; governmentIds: GovernmentId[]; canViewConfidential: boolean }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canViewConfidential) {
    return <p className="text-sm text-slate-500">Government/statutory IDs are confidential and visible only to Admin approvers and Super Admin.</p>;
  }

  async function submit(fd: FormData, close: () => void) {
    setBusy(true); setError('');
    fd.set('employee_id', employeeId);
    try { await upsertEmployeeGovernmentIdAction(fd); close(); }
    catch (e: any) { setError(errorText(e) ?? 'Unable to save.'); }
    finally { setBusy(false); }
  }
  async function remove(row: GovernmentId) {
    if (!(await dialog.confirm(`Remove ${row.id_type}?`, { tone: 'danger' }))) return;
    setBusy(true); setError('');
    const fd = new FormData();
    fd.set('id', row.id); fd.set('employee_id', employeeId); fd.set('id_type', row.id_type);
    try { await deleteEmployeeGovernmentIdAction(fd); }
    catch (e: any) { setError(errorText(e) ?? 'Unable to remove.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <ActionBar>
        <PopupAction label="+ Add government ID" title="Add government ID" notice={error || null}>
          {(close) => (
            <form
              onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget), close); }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <label className="text-sm">ID type<input name="id_type" required className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label className="text-sm">ID number<input name="id_number" required className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label className="text-sm">Issued date<input name="issued_date" type="date" className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label className="text-sm">Expiry date<input name="expiry_date" type="date" className="mt-1 w-full rounded border px-3 py-2" /></label>
              <div className="flex gap-2 sm:col-span-2">
                <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">{busy ? 'Saving...' : 'Save'}</button>
                <button type="button" onClick={close} className="rounded border px-4 py-2 text-sm">Cancel</button>
              </div>
            </form>
          )}
        </PopupAction>
      </ActionBar>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {governmentIds.length === 0 && <p className="text-sm text-slate-500">No government/statutory IDs on file.</p>}
      {governmentIds.map((g) => (
        <div key={g.id} className="flex items-center justify-between rounded border px-4 py-3">
          <div>
            <div className="font-medium">{g.id_type}</div>
            <div className="text-sm text-slate-500">
              {g.id_number} {g.issued_date && `· issued ${g.issued_date}`} {g.expiry_date && `· expires ${g.expiry_date}`}
            </div>
          </div>
          <button disabled={busy} onClick={() => remove(g)} className="text-sm text-red-700 hover:underline">Remove</button>
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ documents }: { documents: EmployeeDocument[] }) {
  // U024 — reuses the existing employee_documents feature (Admin →
  // Documents) rather than a parallel table; confidential document types
  // have already been filtered out server-side for a non-approver viewer.
  // Upload/verify/reject actions stay in Admin → Documents (this tab is a
  // read-only summary for the employee's own profile view).
  if (!documents.length) {
    return (
      <p className="text-sm text-slate-500">
        No documents on file. Documents are uploaded and managed in{' '}
        <Link href="/admin/documents" className="text-blue-700 hover:underline">Admin → Documents</Link>.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {documents.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded border px-4 py-3">
          <div>
            <div className="font-medium">
              {d.document_name}
              {d.type?.confidential && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Confidential</span>}
            </div>
            <div className="text-sm text-slate-500">
              {d.type?.name}{d.document_number ? ` · ${d.document_number}` : ''}
              {d.expiry_date ? ` · expires ${d.expiry_date}` : ''}
            </div>
          </div>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs capitalize text-slate-600">{d.status}</span>
        </div>
      ))}
      <Link href="/admin/documents" className="inline-block text-sm text-blue-700 hover:underline">Manage documents →</Link>
    </div>
  );
}

const CONFIDENTIAL_FIELD_NAMES = new Set(['notes', 'id_number']);

function ChangeHistoryTab({ entries }: { entries: ChangeEntry[] }) {
  if (!entries.length) return <p className="text-sm text-slate-500">No change history recorded yet.</p>;
  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div key={e.id} className="rounded border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{e.actor_name}</span>
            <span className="text-slate-400">{new Date(e.created_at).toLocaleString()}</span>
          </div>
          <div className="text-sm text-slate-500">{e.entity_table === 'employee_government_ids' ? 'Government ID record' : 'Employee record'} — {e.action}</div>
          {e.detail?.field_changes && e.detail.field_changes.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {e.detail.field_changes.map((fc, i) => {
                const redacted = CONFIDENTIAL_FIELD_NAMES.has(fc.field) || fc.old === '[redacted]' || fc.new === '[redacted]';
                return (
                  <li key={i} className="text-slate-700">
                    <span className="font-medium">{fc.field}:</span>{' '}
                    {redacted ? (
                      <span className="text-slate-400">confidential value changed</span>
                    ) : (
                      <>
                        <span className="text-slate-400">{String(fc.old ?? '—')}</span> → <span>{String(fc.new ?? '—')}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
