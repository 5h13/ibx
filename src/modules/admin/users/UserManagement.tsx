'use client';
import { errorText } from '@/core/errors/appError';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import type { AppRole, WorkflowRole } from '@/core/auth/types';
import { createUserAction, updateUserAction, resetUserPasswordAction, deactivateUserAction, reactivateUserAction } from './actions';

type Section = { id: string; code: string; name: string };
type Business = { id: string; code: string; legal_name: string; trade_name: string | null; is_active: boolean };
type GrantMap = Record<string, WorkflowRole[]>;
type ManagedUser = {
  id: string; email: string; full_name: string | null; role: AppRole; is_active: boolean;
  section_id: string | null; business_id: string | null; access: { section_id: string; workflow_role: WorkflowRole }[];
};

const roles: { value: AppRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin (Global)' }, { value: 'business_admin', label: 'Business Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'finance', label: 'Finance' }, { value: 'logistics', label: 'Logistics' },
  { value: 'marketing', label: 'Marketing' }, { value: 'sales', label: 'Sales' },
];
const workflowRoles: WorkflowRole[] = ['preparer', 'reviewer', 'approver'];

function grantsFromUser(user?: ManagedUser): GrantMap {
  const map: GrantMap = {};
  for (const a of user?.access ?? []) (map[a.section_id] ??= []).push(a.workflow_role);
  return map;
}

export default function UserManagement({ sections, users, businesses, actingRole, currentUserId }: { sections: Section[]; users: ManagedUser[]; businesses: Business[]; actingRole: AppRole; currentUserId: string }) {
  const dialog = useDialog();
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const router = useRouter();

  // A Business Super Admin can never see or grant the admin-tier roles
  // themselves — that stays a Global Super Admin decision (enforced again,
  // server-side, in actions.ts). businesses is also already RLS-scoped to
  // exactly this actor's own business when actingRole is business_admin, so
  // it will contain exactly one row.
  const selectableRoles = actingRole === 'business_admin'
    ? roles.filter(r => r.value !== 'super_admin' && r.value !== 'business_admin')
    : roles;
  const businessLocked = actingRole === 'business_admin';

  async function submit(form: HTMLFormElement, action: (fd: FormData) => Promise<any>, onClose?: () => void) {
    setBusy(true); setMessage('');
    try {
      const result = await action(new FormData(form));
      if (result?.temporaryPassword) setPassword(result.temporaryPassword);
      else { setMessage('Saved.'); setEditing(null); setCreating(false); router.refresh(); onClose?.(); }
    } catch (e) { setMessage(e instanceof Error ? errorText(e) : 'Operation failed.'); }
    finally { setBusy(false); }
  }

  // Build 65: onClose is passed when the form sits in the "+ Add user" pop-up (closes it on Cancel / on a save without a temporary password).
  function UserForm({ user, onClose }: { user?: ManagedUser; onClose?: () => void }) {
    const initialGrants = grantsFromUser(user);
    const [role, setRole] = useState<AppRole>(user?.role ?? 'sales');
    const [selected, setSelected] = useState<string[]>(user ? user.access.length ? [...new Set(user.access.map(a => a.section_id))] : (user.section_id ? [user.section_id] : []) : []);
    const [grants, setGrants] = useState<GrantMap>(initialGrants);
    const [active, setActive] = useState(user?.is_active ?? true);
    const [businessId, setBusinessId] = useState<string>(user?.business_id ?? businesses[0]?.id ?? '');
    const [formError, setFormError] = useState('');

    const toggleSection = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
    const toggleGrant = (sectionId: string, wr: WorkflowRole) => setGrants(g => {
      const current = g[sectionId] ?? [];
      return { ...g, [sectionId]: current.includes(wr) ? current.filter(x => x !== wr) : [...current, wr] };
    });

    return <form className="space-y-5" onSubmit={async e => { e.preventDefault(); setFormError(''); if (role !== 'super_admin' && !businessId) { setFormError('Select a business for this user.'); return; } const form = e.currentTarget; form.querySelectorAll('input[data-generated]').forEach(n => n.remove()); const add = (name: string, value: string) => { const i=document.createElement('input'); i.type='hidden'; i.name=name; i.value=value; i.dataset.generated='true'; form.appendChild(i); }; add('section_ids', JSON.stringify(role === 'super_admin' ? [] : selected)); add('grants', JSON.stringify(role === 'super_admin' ? {} : grants)); add('role', role); add('is_active', String(active)); if (role !== 'super_admin') add('business_id', businessId); if (user) add('user_id', user.id); try { await submit(form, user ? updateUserAction : createUserAction, onClose); } catch (err) { setFormError(err instanceof Error ? errorText(err) : 'Operation failed.'); } }}>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="block text-sm"><span className="text-slate-600">Full name</span><input name="full_name" required defaultValue={user?.full_name ?? ''} className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm"><span className="text-slate-600">Email</span><input name="email" type="email" required={!user} disabled={!!user} defaultValue={user?.email ?? ''} className="mt-1 w-full rounded border p-2 disabled:bg-slate-100" /></label>
      </div>
      <label className="block text-sm"><span className="text-slate-600">System role</span><select value={role} onChange={e => setRole(e.target.value as AppRole)} className="mt-1 w-full rounded border p-2">{selectableRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      {role !== 'super_admin' && <label className="block text-sm"><span className="text-slate-600">Business</span>{businessLocked
        ? <div className="mt-1 w-full rounded border bg-slate-100 p-2 text-slate-600">{businesses.find(b => b.id === businessId)?.trade_name || businesses.find(b => b.id === businessId)?.legal_name || businesses[0]?.trade_name || businesses[0]?.legal_name || '—'}</div>
        : <select value={businessId} onChange={e => setBusinessId(e.target.value)} required className="mt-1 w-full rounded border p-2"><option value="" disabled>Select a business…</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.trade_name || b.legal_name}</option>)}</select>}
        <span className="text-xs text-slate-400">{businessLocked ? 'Business Super Admins manage users within their own business only.' : 'Every role except Super Admin belongs to exactly one business.'}</span></label>}
      {!user && <label className="block text-sm"><span className="text-slate-600">Initial password <span className="text-slate-400">(leave blank to generate)</span></span><input name="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>}
      {role !== 'super_admin' && <div><div className="text-sm font-medium mb-2">Section access & workflow permissions</div><div className="space-y-2">{sections.map(s => <div key={s.id} className="rounded border p-3"><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggleSection(s.id)} /> <span className="font-medium">{s.name}</span></label>{selected.includes(s.id) && <div className="mt-2 ml-6 flex gap-4 text-xs">{workflowRoles.map(wr => <label key={wr} className="flex items-center gap-1"><input type="checkbox" checked={(grants[s.id] ?? []).includes(wr)} onChange={() => toggleGrant(s.id, wr)} /> {wr}</label>)}</div>}</div>)}</div></div>}
      {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active account</label>}
      {(formError || message) && <div className="rounded bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">{formError || message}</div>}
      {password && user === undefined && message === '' && <div className="rounded bg-emerald-50 border border-emerald-200 p-3 text-sm"><strong>Temporary password:</strong> {password}<div className="text-xs mt-1">Give this to the user securely. It will not be shown again.</div></div>}
      <div className="flex gap-2"><button disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}</button><button type="button" onClick={() => {setEditing(null);setCreating(false);setMessage('');onClose?.()}} className="rounded border px-4 py-2 text-sm">Cancel</button></div>
    </form>;
  }

  async function run(action: (fd: FormData) => Promise<any>, userId: string, confirmText: string) {
    if (!(await dialog.confirm(confirmText, { tone: 'danger' }))) return;
    const fd = new FormData(); fd.set('user_id', userId); setBusy(true); setMessage('');
    try { const result = await action(fd); if (result?.temporaryPassword) setPassword(result.temporaryPassword); else { setMessage('Saved.'); router.refresh(); } } catch (e) { setMessage(e instanceof Error ? errorText(e) : 'Operation failed.'); } finally { setBusy(false); }
  }

  if (creating || editing) return <div className="bg-white rounded-lg shadow-sm p-6"><h2 className="text-lg font-semibold mb-5">{creating ? 'Add user' : `Edit ${editing?.full_name || editing?.email}`}</h2><UserForm user={editing ?? undefined} /></div>;

  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">User Management</h2><p className="text-sm text-slate-500">Super Admin controls identity, role, section access and workflow permissions.</p></div></div><ActionBar><PopupAction label="+ Add user" title="Add user" wide onOpen={() => setPassword('')}>{(close) => <UserForm onClose={close} />}</PopupAction></ActionBar>{message && <div className="rounded bg-emerald-50 border border-emerald-200 p-3 text-sm">{message}{password && <div className="font-mono mt-1">Temporary password: {password}</div>}</div>}<div className="overflow-x-auto bg-white rounded-lg shadow-sm"><table className="w-full text-sm"><thead><tr className="text-left border-b text-slate-500"><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Business</th><th className="p-3">Sections</th><th className="p-3">Workflow</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{users.map(u => { const sectionIds=[...new Set(u.access.map(a=>a.section_id).concat(u.section_id ? [u.section_id] : []))]; return <tr key={u.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{u.full_name || '—'}</div><div className="text-xs text-slate-500">{u.email}</div></td><td className="p-3 uppercase text-xs">{u.role}</td><td className="p-3">{u.role==='super_admin' ? 'All (Global)' : (businesses.find(b=>b.id===u.business_id)?.trade_name || businesses.find(b=>b.id===u.business_id)?.legal_name || '—')}</td><td className="p-3">{(u.role==='super_admin'||u.role==='business_admin') ? 'All' : sectionIds.map(id=>sections.find(s=>s.id===id)?.name).filter(Boolean).join(', ') || '—'}</td><td className="p-3 text-xs">{(u.role==='super_admin'||u.role==='business_admin') ? 'Full access' : u.access.map(a=>`${sections.find(s=>s.id===a.section_id)?.code}: ${a.workflow_role}`).join(' · ') || 'None'}</td><td className="p-3">{u.is_active ? <span className="text-emerald-700">Active</span> : <span className="text-slate-400">Inactive</span>}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button onClick={() => setEditing(u)} className="rounded border px-2 py-1">Edit</button><button disabled={busy} onClick={() => run(resetUserPasswordAction,u.id,'Reset this user’s password?')} className="rounded border px-2 py-1">Reset password</button>{u.is_active ? <button disabled={busy || u.id===currentUserId} onClick={() => run(deactivateUserAction,u.id,'Deactivate this user?')} className="rounded border border-red-200 text-red-700 px-2 py-1">Deactivate</button> : <button disabled={busy} onClick={() => run(reactivateUserAction,u.id,'Reactivate this user?')} className="rounded border border-emerald-200 text-emerald-700 px-2 py-1">Reactivate</button>}</div></td></tr>})}</tbody></table></div></div>;
}
