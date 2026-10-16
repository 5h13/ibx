'use client';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import type { AppRole, WorkflowRole } from '@/core/auth/types';
import { APP_FUNCTIONS, functionsOfSection } from '@/core/auth/functions';
import { createUserAction, updateUserAction, resetUserPasswordAction, deactivateUserAction, deleteUserAction, reactivateUserAction, sendPasswordLinkAction, suggestUsernameAction } from './actions';

type Section = { id: string; code: string; name: string };
type AgentOpt = { id: string; agent_code: string; name: string; user_id: string | null };
type Business = { id: string; code: string; legal_name: string; trade_name: string | null; is_active: boolean };
type GrantMap = Record<string, WorkflowRole[]>;
type ManagedUser = {
  id: string; email: string; full_name: string | null; role: AppRole; is_active: boolean;
  first_name?: string | null; last_name?: string | null; username?: string | null; nickname?: string | null; email_is_login_only?: boolean;
  section_id: string | null; business_id: string | null; access: { section_id: string; workflow_role: WorkflowRole }[];
  /** Build 90 */ functions?: { function_code: string }[];
};

const roles: { value: AppRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin (Global)' }, { value: 'business_admin', label: 'Business Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'finance', label: 'Finance' }, { value: 'logistics', label: 'Logistics' },
  { value: 'marketing', label: 'Marketing' }, { value: 'sales', label: 'Sales' },
  { value: 'agent', label: 'Agent (freelance — agent portal only)' },
];
const workflowRoles: WorkflowRole[] = ['preparer', 'reviewer', 'approver'];

function grantsFromUser(user?: ManagedUser): GrantMap {
  const map: GrantMap = {};
  for (const a of user?.access ?? []) (map[a.section_id] ??= []).push(a.workflow_role);
  return map;
}

export default function UserManagement({ sections, users, businesses, actingRole, currentUserId, agents = [] }: { sections: Section[]; users: ManagedUser[]; businesses: Business[]; actingRole: AppRole; currentUserId: string; agents?: AgentOpt[] }) {
  const dialog = useDialog();
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Build 96: deactivated logins (e.g. old test accounts) are hidden unless asked for
  const [showInactive, setShowInactive] = useState(false);
  const inactiveCount = users.filter(u => !u.is_active).length;
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
      if (result?.temporaryPassword) { setPassword(result.temporaryPassword); if (result?.username) setMessage(`User created. Username: ${result.username}`); }
      else if (result?.invited) { setMessage(`Invitation sent to ${result.invited}. Username: ${result.username ?? '—'}. They set their own password from the email link.`); setEditing(null); setCreating(false); router.refresh(); onClose?.(); }
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
    const [onboarding, setOnboarding] = useState<'invite' | 'password'>('invite');
    // Build 121: the password being typed lives in this form. It was kept on the outer screen, so every keystroke
    // redrew the screen, rebuilt this form (focus lost after one character) and reset its other choices.
    const [typedPassword, setTypedPassword] = useState('');
    // Build 104 — first name + surname, username, optional email
    const [first, setFirst] = useState(user?.first_name ?? (user?.full_name ?? '').trim().split(/\s+/)[0] ?? '');
    const [last, setLast] = useState(user?.last_name ?? ((user?.full_name ?? '').trim().includes(' ') ? (user?.full_name ?? '').trim().replace(/^\S+\s+/, '') : ''));
    const [uname, setUname] = useState(user?.username ?? '');
    const [mail, setMail] = useState(user && !user.email_is_login_only ? user.email : '');
    const [suggested, setSuggested] = useState('');
    const suggest = () => { if (user || !first.trim() || !last.trim()) return; suggestUsernameAction(first, last).then(setSuggested).catch(() => {}); };
    const inviteOk = !!mail.trim();
    // Build 90 — function limits inside Finance / Sales
    const initialFns = (user?.functions ?? []).map(f => f.function_code);
    const [fns, setFns] = useState<string[]>(initialFns);
    const [limited, setLimited] = useState<Record<string, boolean>>(() => Object.fromEntries(['finance', 'sales'].map(code => [code, functionsOfSection(code).some(f => initialFns.includes(f.code))])));
    const toggleFn = (code: string) => setFns(f => f.includes(code) ? f.filter(x => x !== code) : [...f, code]);
    const sectionCode = (id: string) => sections.find(x => x.id === id)?.code ?? '';
    // Build 91 — an Agent login is linked to one freelance agent
    const [agentId, setAgentId] = useState<string>(agents.find(a => a.user_id && a.user_id === user?.id)?.id ?? '');

    const toggleSection = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
    const toggleGrant = (sectionId: string, wr: WorkflowRole) => setGrants(g => {
      const current = g[sectionId] ?? [];
      return { ...g, [sectionId]: current.includes(wr) ? current.filter(x => x !== wr) : [...current, wr] };
    });

    return <Form className="space-y-5" onSubmit={async e => { e.preventDefault(); setFormError(''); if (role !== 'super_admin' && !businessId) { setFormError('Select a business for this user.'); return; } const form = e.currentTarget; form.querySelectorAll('input[data-generated]').forEach(n => n.remove()); const add = (name: string, value: string) => { const i=document.createElement('input'); i.type='hidden'; i.name=name; i.value=value; i.dataset.generated='true'; form.appendChild(i); }; add('section_ids', JSON.stringify(role === 'super_admin' || role === 'agent' ? [] : selected)); add('grants', JSON.stringify(role === 'super_admin' || role === 'agent' ? {} : grants)); const fnSections = selected.map(sectionCode).filter(c => limited[c] && functionsOfSection(c).length); const emptyLimit = fnSections.find(c => !functionsOfSection(c).some(f => fns.includes(f.code))); if (role !== 'super_admin' && role !== 'business_admin' && role !== 'agent' && emptyLimit) { setFormError(`Tick at least one ${emptyLimit === 'finance' ? 'Finance' : 'Sales'} function, or choose "All functions".`); return; } add('functions', JSON.stringify(role === 'super_admin' || role === 'business_admin' || role === 'agent' ? [] : fns.filter(code => fnSections.some(c => functionsOfSection(c).some(f => f.code === code))))); add('role', role); if (role !== 'super_admin') add('agent_id', agentId); add('is_active', String(active)); if (role !== 'super_admin') add('business_id', businessId); if (user) add('user_id', user.id); try { await submit(form, user ? updateUserAction : createUserAction, onClose); } catch (err) { setFormError(err instanceof Error ? errorText(err) : 'Operation failed.'); } }}>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="block text-sm"><span className="text-slate-600">First name</span><input name="first_name" required value={first} onChange={e => setFirst(e.target.value)} onBlur={suggest} className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm"><span className="text-slate-600">Surname</span><input name="last_name" required value={last} onChange={e => setLast(e.target.value)} onBlur={suggest} className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm"><span className="text-slate-600">Username (to sign in)</span><input name="username" required={!!user} value={uname} onChange={e => setUname(e.target.value)} placeholder={suggested || 'Made from the name, e.g. A.Santiago'} autoCapitalize="none" spellCheck={false} className="mt-1 w-full rounded border p-2" /><span className="text-xs text-slate-400">{user ? 'Letters, numbers, dot, dash, underscore.' : suggested ? `Leave blank to use ${suggested}.` : 'Leave blank to make it from the name.'}</span></label>
        <label className="block text-sm"><span className="text-slate-600">Email <span className="text-slate-400">(optional)</span></span><input name="email" type="email" value={mail} onChange={e => setMail(e.target.value)} placeholder="No email — signs in with the username" className="mt-1 w-full rounded border p-2" /><span className="text-xs text-slate-400">{user?.email_is_login_only ? 'No email yet; it can be added here or by the user in My Profile.' : 'Can be added later, here or by the user in My Profile.'}</span></label>
      </div>
      <label className="block text-sm"><span className="text-slate-600">System role</span><select value={role} onChange={e => setRole(e.target.value as AppRole)} className="mt-1 w-full rounded border p-2">{selectableRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      {role !== 'super_admin' && <label className="block text-sm"><span className="text-slate-600">Business</span>{businessLocked
        ? <div className="mt-1 w-full rounded border bg-slate-100 p-2 text-slate-600">{businesses.find(b => b.id === businessId)?.trade_name || businesses.find(b => b.id === businessId)?.legal_name || businesses[0]?.trade_name || businesses[0]?.legal_name || '—'}</div>
        : <select value={businessId} onChange={e => setBusinessId(e.target.value)} required className="mt-1 w-full rounded border p-2"><option value="" disabled>Select a business…</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.trade_name || b.legal_name}</option>)}</select>}
        <span className="text-xs text-slate-400">{businessLocked ? 'Business Super Admins manage users within their own business only.' : 'Every role except Super Admin belongs to exactly one business.'}</span></label>}
      {!user && <div className="space-y-2 text-sm"><input type="hidden" name="onboarding" value={inviteOk ? onboarding : 'password'} /><div className="text-slate-600">How the user gets in</div>
        <label className={`flex items-start gap-2 ${inviteOk ? '' : 'opacity-50'}`}><input type="radio" disabled={!inviteOk} checked={inviteOk && onboarding === 'invite'} onChange={() => setOnboarding('invite')} className="mt-1" /><span><b>Email an invitation</b> — the user receives a link and sets their own password.{!inviteOk && ' (Needs an email.)'}</span></label>
        <label className="flex items-start gap-2"><input type="radio" checked={!inviteOk || onboarding === 'password'} onChange={() => setOnboarding('password')} className="mt-1" /><span><b>Set a temporary password</b> — you give it to the user; they must change it at first sign-in.</span></label>
        {(!inviteOk || onboarding === 'password') && <label className="block"><span className="text-slate-600">Temporary password <span className="text-slate-400">(leave blank to generate; at least 8 characters)</span></span><input name="password" value={typedPassword} onChange={e => setTypedPassword(e.target.value)} autoComplete="new-password" className="mt-1 w-full rounded border p-2" /></label>}
      </div>}
      {role === 'agent' && <label className="block text-sm"><span className="text-slate-600">Agent this login is for</span><select value={agentId} onChange={e => setAgentId(e.target.value)} className="mt-1 w-full rounded border p-2" required><option value="">Choose the agent…</option>{agents.filter(a => !a.user_id || a.user_id === user?.id).map(a => <option key={a.id} value={a.id}>{a.agent_code} — {a.name}</option>)}</select><span className="text-xs text-slate-400">Store or freelance agents from Sales → Agents (not the store's walk-in account). The agent sees only the agent portal: his clients, the catalogue, orders, payments and expenses.</span></label>}
      {role !== 'super_admin' && role !== 'agent' && <label className="block text-sm"><span className="text-slate-600">Also an agent? <span className="text-slate-400">(optional)</span></span><select value={agentId} onChange={e => setAgentId(e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">No — staff only</option>{agents.filter(a => !a.user_id || a.user_id === user?.id).map(a => <option key={a.id} value={a.id}>{a.agent_code} — {a.name}</option>)}</select><span className="text-xs text-slate-400">For staff who also sell: with one login they switch between these screens and the agent app (“Agent app” button in the header, “Back to office” in the agent menu). Their rights do not mix.</span></label>}
      {role !== 'super_admin' && role !== 'agent' && <div><div className="text-sm font-medium mb-2">Section access & workflow permissions</div><div className="space-y-2">{sections.map(s => <div key={s.id} className="rounded border p-3"><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggleSection(s.id)} /> <span className="font-medium">{s.name}</span></label>{selected.includes(s.id) && <div className="mt-2 ml-6 flex gap-4 text-xs">{workflowRoles.map(wr => <label key={wr} className="flex items-center gap-1"><input type="checkbox" checked={(grants[s.id] ?? []).includes(wr)} onChange={() => toggleGrant(s.id, wr)} /> {wr}</label>)}</div>}{selected.includes(s.id) && role !== 'business_admin' && functionsOfSection(s.code).length > 0 && <div className="mt-3 ml-6 space-y-2 rounded bg-slate-50 p-2 text-xs">
        <div className="flex flex-wrap gap-4"><span className="font-medium text-slate-600">Functions:</span>
          <label className="flex items-center gap-1"><input type="radio" checked={!limited[s.code]} onChange={() => setLimited(l => ({ ...l, [s.code]: false }))} /> All of {s.name}</label>
          <label className="flex items-center gap-1"><input type="radio" checked={!!limited[s.code]} onChange={() => setLimited(l => ({ ...l, [s.code]: true }))} /> Only these</label></div>
        {limited[s.code] && <div className="grid gap-1 sm:grid-cols-2">{functionsOfSection(s.code).map(f => <label key={f.code} className="flex items-start gap-1" title={f.hint}><input type="checkbox" className="mt-0.5" checked={fns.includes(f.code)} onChange={() => toggleFn(f.code)} /><span><b className="font-medium">{f.label}</b><span className="block text-slate-500">{f.hint}</span></span></label>)}</div>}
        {limited[s.code] && role === s.code && <div className="text-amber-700">The limits apply to this department even though the system role is {s.name}.</div>}
      </div>}</div>)}</div></div>}
      {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active account</label>}
      {(formError || message) && <div className="rounded bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">{formError || message}</div>}
      {password && user === undefined && message === '' && onboarding === 'password' && <div className="rounded bg-emerald-50 border border-emerald-200 p-3 text-sm"><strong>Temporary password:</strong> {password}<div className="text-xs mt-1">Give this to the user securely. It will not be shown again; they must change it at their first sign-in.</div></div>}
      <div className="flex gap-2"><button disabled={busy} className="rounded bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}</button><button type="button" onClick={() => {setEditing(null);setCreating(false);setMessage('');onClose?.()}} className="rounded border px-4 py-2 text-sm">Cancel</button></div>
    </Form>;
  }

  async function run(action: (fd: FormData) => Promise<any>, userId: string, confirmText: string) {
    if (!(await dialog.confirm(confirmText, { tone: 'danger' }))) return;
    const fd = new FormData(); fd.set('user_id', userId); setBusy(true); setMessage('');
    try { const result = await action(fd); if (result?.temporaryPassword) { setPassword(result.temporaryPassword); setMessage('Password reset. The user must change it at the next sign-in.'); } else if (result?.emailed) { setMessage(`Email sent to ${result.emailed} with a link to set a new password.`); } else if (result?.deleted) { setMessage(`${result.deleted} deleted.`); router.refresh(); } else { setMessage('Saved.'); router.refresh(); } } catch (e) { setMessage(e instanceof Error ? errorText(e) : 'Operation failed.'); } finally { setBusy(false); }
  }

  if (creating || editing) return <div className="bg-white rounded-lg shadow-sm p-6"><h2 className="text-lg font-semibold mb-5">{creating ? 'Add user' : `Edit ${editing?.full_name || editing?.email}`}</h2><UserForm user={editing ?? undefined} /></div>;

  return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">User Management</h2><p className="text-sm text-slate-500">Super Admin controls identity, role, section access and workflow permissions.</p></div></div><ActionBar><PopupAction label="+ Add user" title="Add user" wide onOpen={() => setPassword('')}>{(close) => <UserForm onClose={close} />}</PopupAction><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!showInactive} onChange={e => setShowInactive(!e.target.checked)} /> Hide inactive users{inactiveCount > 0 ? ` (${inactiveCount})` : ''}</label></ActionBar>{message && <div className="rounded bg-emerald-50 border border-emerald-200 p-3 text-sm">{message}{password && <div className="font-mono mt-1">Temporary password: {password}</div>}</div>}<div className="overflow-x-auto bg-white rounded-lg shadow-sm"><table className="w-full text-sm"><thead><tr className="text-left border-b text-slate-500"><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Business</th><th className="p-3">Sections</th><th className="p-3">Workflow</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{users.filter(u => showInactive || u.is_active).map(u => { const sectionIds=[...new Set(u.access.map(a=>a.section_id).concat(u.section_id ? [u.section_id] : []))]; return <tr key={u.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{u.full_name || '—'}{u.nickname && <span className="font-normal text-slate-500"> “{u.nickname}”</span>}</div><div className="text-xs text-slate-500"><span className="font-mono">{u.username}</span> · {u.email_is_login_only ? 'no email' : u.email}</div></td><td className="p-3 uppercase text-xs">{u.role}</td><td className="p-3">{u.role==='super_admin' ? 'All (Global)' : (businesses.find(b=>b.id===u.business_id)?.trade_name || businesses.find(b=>b.id===u.business_id)?.legal_name || '—')}</td><td className="p-3">{(u.role==='super_admin'||u.role==='business_admin') ? 'All' : sectionIds.map(id=>sections.find(s=>s.id===id)?.name).filter(Boolean).join(', ') || '—'}{!!u.functions?.length && u.role!=='super_admin' && u.role!=='business_admin' && <div className="mt-1 text-xs text-amber-700" title={u.functions.map(f=>APP_FUNCTIONS.find(x=>x.code===f.function_code)?.label ?? f.function_code).join(', ')}>Limited: {u.functions.map(f=>APP_FUNCTIONS.find(x=>x.code===f.function_code)?.label ?? f.function_code).join(', ')}</div>}</td><td className="p-3 text-xs">{(u.role==='super_admin'||u.role==='business_admin') ? 'Full access' : u.access.map(a=>`${sections.find(s=>s.id===a.section_id)?.code}: ${a.workflow_role}`).join(' · ') || 'None'}</td><td className="p-3">{u.is_active ? <span className="text-emerald-700">Active</span> : <span className="text-slate-400">Inactive</span>}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button onClick={() => setEditing(u)} className="rounded border px-2 py-1">Edit</button><button disabled={busy} onClick={() => run(sendPasswordLinkAction,u.id,'Email this user a link to set a new password?')} className="rounded border px-2 py-1">Email password link</button><button disabled={busy} onClick={() => run(resetUserPasswordAction,u.id,'Reset this user’s password to a temporary one (they must change it at the next sign-in)?')} className="rounded border px-2 py-1">Temporary password</button>{u.is_active ? <button disabled={busy || u.id===currentUserId} onClick={() => run(deactivateUserAction,u.id,'Deactivate this user?')} className="rounded border border-red-200 text-red-700 px-2 py-1">Deactivate</button> : <button disabled={busy} onClick={() => run(reactivateUserAction,u.id,'Reactivate this user?')} className="rounded border border-emerald-200 text-emerald-700 px-2 py-1">Reactivate</button>}{u.id!==currentUserId && <button disabled={busy} onClick={() => run(deleteUserAction,u.id,`Delete ${u.full_name || u.email} permanently? This works only for a login that has never done anything in the app; otherwise deactivate it.`)} className="rounded border border-red-300 bg-red-50 text-red-800 px-2 py-1">Delete</button>}</div></td></tr>})}</tbody></table></div></div>;
}
