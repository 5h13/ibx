'use client';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDialog } from '@/core/ui/Dialog';
import { createEmployeeAction, deleteEmployeeAction, setEmployeeStatusAction, updateEmployeeAction } from './actions';

type Employee = {
  id: string; employee_no: string; user_id: string | null; first_name: string; middle_name: string | null;
  last_name: string; suffix: string | null; preferred_name: string | null; department: string | null;
  position_title: string | null; employment_type: string; employment_status: string; hire_date: string | null;
  separation_date: string | null; work_email: string | null; personal_email: string | null; phone: string | null;
  address: string | null; address_line1: string | null; address_line2: string | null; city: string | null; province: string | null; postal_code: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null; notes: string | null;
  department_id: string | null; position_id: string | null; work_location_id: string | null; supervisor_employee_id: string | null;
};
type User = { id: string; email: string; full_name: string | null; role: string; is_active: boolean };
type Master = { id: string; name: string; active: boolean };

const empty = { employee_no:'', user_id:'', first_name:'', middle_name:'', last_name:'', suffix:'', preferred_name:'', department:'', position_title:'', employment_type:'regular', employment_status:'active', hire_date:'', separation_date:'', work_email:'', personal_email:'', phone:'', address:'', address_line1:'', address_line2:'', city:'', province:'', postal_code:'', emergency_contact_name:'', emergency_contact_phone:'', notes:'', department_id:'', position_id:'', work_location_id:'', supervisor_employee_id:'' };
const statusLabels: Record<string,string> = { active:'Active', probationary:'Probationary', on_leave:'On leave', suspended:'Suspended', inactive:'Inactive', separated:'Separated' };
const typeLabels: Record<string,string> = { regular:'Regular', probationary:'Probationary', contractual:'Contractual', part_time:'Part-time', project_based:'Project-based', intern:'Intern' };

export default function EmployeeManagement({ employees, users, departments, positions, workLocations, canDelete, canViewConfidential }: { employees: Employee[]; users: User[]; departments: Master[]; positions: Master[]; workLocations: Master[]; canDelete: boolean; canViewConfidential: boolean }) {
  const dialog = useDialog();
  const [editing, setEditing] = useState<Employee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const filtered = useMemo(() => employees.filter(e => {
    const hay = [e.employee_no,e.first_name,e.middle_name,e.last_name,e.preferred_name,e.department,e.position_title,e.work_email].filter(Boolean).join(' ').toLowerCase();
    return (!query || hay.includes(query.toLowerCase())) && (status === 'all' || e.employment_status === status);
  }), [employees, query, status]);

  async function submit(form: FormData) {
    setBusy(true); setError('');
    try { if (editing) { form.set('employee_id', editing.id); await updateEmployeeAction(form); } else await createEmployeeAction(form); router.refresh(); setShowForm(false); setEditing(null); }
    catch (e) { setError(e instanceof Error ? errorText(e) : 'Unable to save employee.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!(await dialog.confirm('Permanently delete this employee record? Historical references may prevent deletion.', { tone: 'danger', title: 'Delete employee' }))) return;
    const form = new FormData(); form.set('employee_id', id); setBusy(true); setError('');
    try { await deleteEmployeeAction(form); router.refresh(); } catch (e) { setError(e instanceof Error ? errorText(e) : 'Unable to delete employee.'); } finally { setBusy(false); }
  }

  async function changeStatus(id: string, next: string) {
    const form = new FormData(); form.set('employee_id', id); form.set('employment_status', next);
    // U015 — the DB now requires a separation_date whenever status becomes
    // 'separated' (guard_employee_status_transition trigger).
    if (next === 'separated') {
      const date = await dialog.prompt('Separation date (YYYY-MM-DD):', { required: true });
      if (!date) return;
      form.set('separation_date', date);
    }
    setBusy(true); setError('');
    try { await setEmployeeStatusAction(form); router.refresh(); } catch (e) { setError(e instanceof Error ? errorText(e) : 'Unable to update status.'); } finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-xl font-semibold">Employees</h2><p className="text-sm text-slate-500">HR-lite employee records linked to IBX users when applicable.</p></div>
      <button onClick={() => { setEditing(null); setShowForm(true); setError(''); }} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">+ Add employee</button>
    </div>
    {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row">
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, employee no., department..." className="flex-1 rounded border px-3 py-2 text-sm" />
      <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded border px-3 py-2 text-sm"><option value="all">All statuses</option>{Object.entries(statusLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    </div>

    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Department / Position</th><th className="px-4 py-3">Employment</th><th className="px-4 py-3">Login account</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
      <tbody>{filtered.map(e => <tr key={e.id} className="border-t align-top"><td className="px-4 py-3"><div className="font-medium">{e.preferred_name || `${e.first_name} ${e.last_name}`}</div><div className="text-xs text-slate-500">{e.employee_no}</div></td><td className="px-4 py-3"><div>{e.department || '—'}</div><div className="text-xs text-slate-500">{e.position_title || '—'}</div></td><td className="px-4 py-3">{typeLabels[e.employment_type] ?? e.employment_type}<div className="text-xs text-slate-500">{e.hire_date || 'No hire date'}</div></td><td className="px-4 py-3">{e.user_id ? users.find(u=>u.id===e.user_id)?.email ?? 'Linked user' : <span className="text-slate-400">Unlinked</span>}</td><td className="px-4 py-3"><select disabled={busy} value={e.employment_status} onChange={ev=>changeStatus(e.id,ev.target.value)} className="rounded border px-2 py-1 text-xs">{Object.entries(statusLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></td><td className="px-4 py-3 whitespace-nowrap"><Link href={`/admin/employees/${e.id}`} className="mr-2 text-blue-700 hover:underline">Profile</Link><button onClick={()=>{setEditing(e);setShowForm(true);setError('')}} className="mr-2 text-blue-700 hover:underline">Edit</button><Link href={`/admin/documents?employee=${e.id}`} className="mr-2 text-blue-700 hover:underline">Documents</Link>{canDelete && <button onClick={()=>remove(e.id)} disabled={busy} className="text-red-700 hover:underline">Delete</button>}</td></tr>)}{filtered.length===0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No employee records found.</td></tr>}</tbody></table>
    </div>

    {showForm && <EmployeeForm initial={editing} users={users} employees={employees} departments={departments} positions={positions} workLocations={workLocations} busy={busy} canViewConfidential={canViewConfidential} onClose={()=>setShowForm(false)} onSubmit={submit} />}
  </div>;
}

function EmployeeForm({ initial, users, employees, departments, positions, workLocations, busy, canViewConfidential, onClose, onSubmit }: { initial: Employee | null; users: User[]; employees: Employee[]; departments: Master[]; positions: Master[]; workLocations: Master[]; busy:boolean; canViewConfidential:boolean; onClose:()=>void; onSubmit:(f:FormData)=>void }) {
  const value = (key: keyof typeof empty) => initial ? String((initial as any)[key] ?? '') : empty[key];
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"><Form onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }} className="w-full max-w-4xl rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between border-b px-6 py-4"><div><h3 className="font-semibold">{initial ? 'Edit employee' : 'Add employee'}</h3><p className="text-xs text-slate-500">Employee records are independent of login accounts.</p></div><button type="button" onClick={onClose} className="text-slate-500">✕</button></div><div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
    {initial && <label className="text-sm">Employee no.<input value={initial.employee_no} disabled className="mt-1 w-full rounded border bg-slate-50 px-3 py-2 text-slate-500" /><span className="text-xs text-slate-400">System-assigned, immutable.</span></label>}
    {!initial && <p className="text-sm text-slate-400 sm:col-span-2 lg:col-span-3">Employee no. will be assigned automatically (EMP-####) on save.</p>}
    <Field name="first_name" label="First name" defaultValue={value('first_name')} required /><Field name="middle_name" label="Middle name" defaultValue={value('middle_name')} /><Field name="last_name" label="Last name" defaultValue={value('last_name')} required /><Field name="suffix" label="Suffix" defaultValue={value('suffix')} /><Field name="preferred_name" label="Preferred name" defaultValue={value('preferred_name')} />
    <label className="text-sm">Department<select name="department_id" defaultValue={value('department_id')} className="mt-1 w-full rounded border px-3 py-2"><option value="">— Unassigned —</option>{departments.filter(d=>d.active || d.id===initial?.department_id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    <label className="text-sm">Position<select name="position_id" defaultValue={value('position_id')} className="mt-1 w-full rounded border px-3 py-2"><option value="">— Unassigned —</option>{positions.filter(p=>p.active || p.id===initial?.position_id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="text-sm">Work location<select name="work_location_id" defaultValue={value('work_location_id')} className="mt-1 w-full rounded border px-3 py-2"><option value="">— Unassigned —</option>{workLocations.filter(w=>w.active || w.id===initial?.work_location_id).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
    <label className="text-sm">Supervisor<select name="supervisor_employee_id" defaultValue={value('supervisor_employee_id')} className="mt-1 w-full rounded border px-3 py-2"><option value="">— None —</option>{employees.filter(e=>e.id!==initial?.id).map(e=><option key={e.id} value={e.id}>{e.employee_no} — {e.preferred_name||`${e.first_name} ${e.last_name}`}</option>)}</select></label>
    <Field name="department" label="Department (legacy free text)" defaultValue={value('department')} /><Field name="position_title" label="Position / title (legacy free text)" defaultValue={value('position_title')} />
    <Select name="employment_type" label="Employment type" defaultValue={value('employment_type')} options={Object.entries(typeLabels)} /><Select name="employment_status" label="Employment status" defaultValue={value('employment_status')} options={Object.entries(statusLabels)} /><Field name="hire_date" label="Hire date" type="date" defaultValue={value('hire_date')} /><Field name="separation_date" label="Separation date" type="date" defaultValue={value('separation_date')} /><Field name="work_email" label="Work email" type="email" defaultValue={value('work_email')} /><Field name="personal_email" label="Personal email" type="email" defaultValue={value('personal_email')} /><Field name="phone" label="Phone" defaultValue={value('phone')} />
    <label className="text-sm sm:col-span-2 lg:col-span-3">Login account<select name="user_id" defaultValue={value('user_id')} className="mt-1 w-full rounded border px-3 py-2"><option value="">No linked account</option>{users.filter(u=>u.is_active || u.id===initial?.user_id).map(u=><option key={u.id} value={u.id}>{u.full_name || u.email} — {u.email}</option>)}</select></label>
    <Field name="address_line1" label="Address line 1" defaultValue={value('address_line1')} /><Field name="address_line2" label="Address line 2" defaultValue={value('address_line2')} /><Field name="city" label="City" defaultValue={value('city')} /><Field name="province" label="Province" defaultValue={value('province')} /><Field name="postal_code" label="Postal code" defaultValue={value('postal_code')} />
    <label className="text-sm sm:col-span-2 lg:col-span-3">Address (legacy free text, shown only if no structured address)<textarea name="address" defaultValue={value('address')} rows={2} className="mt-1 w-full rounded border px-3 py-2" /></label>
    <Field name="emergency_contact_name" label="Emergency contact (legacy single field)" defaultValue={value('emergency_contact_name')} /><Field name="emergency_contact_phone" label="Emergency contact phone" defaultValue={value('emergency_contact_phone')} />
    {canViewConfidential && <label className="text-sm sm:col-span-2 lg:col-span-3">Notes <span className="font-normal text-slate-400">(confidential — visible to Admin approvers only)</span><textarea name="notes" defaultValue={value('notes')} rows={3} className="mt-1 w-full rounded border px-3 py-2" /></label>}
  </div><div className="flex justify-end gap-3 border-t px-6 py-4"><button type="button" onClick={onClose} className="rounded border px-4 py-2 text-sm">Cancel</button><button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">{busy?'Saving...':initial?'Save changes':'Create employee'}</button></div></Form></div>;
}
function Field({name,label,type='text',defaultValue,required=false}:{name:string;label:string;type?:string;defaultValue?:string;required?:boolean}) { return <label className="text-sm">{label}{required&&' *'}<input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 w-full rounded border px-3 py-2" /></label>; }
function Select({name,label,defaultValue,options}:{name:string;label:string;defaultValue?:string;options:[string,string][]}) { return <label className="text-sm">{label}<select name={name} defaultValue={defaultValue} className="mt-1 w-full rounded border px-3 py-2">{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>; }
