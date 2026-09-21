// app/settings/users/page.tsx
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isSuperAdmin } from '@/core/auth/types';

export default async function UsersPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isSuperAdmin(profile)) redirect('/dashboard');

  const supabase = createClient();
  const { data: users } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, sections(name)')
    .order('email');

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Users</h2>
      <table className="w-full text-sm bg-white rounded shadow-sm">
        <thead>
          <tr className="text-left border-b border-slate-200 text-slate-500">
            <th className="py-2 px-4">Email</th>
            <th className="py-2 px-4">Name</th>
            <th className="py-2 px-4">Role</th>
            <th className="py-2 px-4">Section</th>
            <th className="py-2 px-4">Active</th>
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u: any) => (
            <tr key={u.id} className="border-b border-slate-100">
              <td className="py-2 px-4">{u.email}</td>
              <td className="py-2 px-4">{u.full_name}</td>
              <td className="py-2 px-4 uppercase text-xs">{u.role}</td>
              <td className="py-2 px-4">{u.sections?.name ?? '—'}</td>
              <td className="py-2 px-4">{u.is_active ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-4">
        Real user provisioning belongs here once real users replace the test accounts — currently
        creation only happens via supabase/seed-users.mjs (Admin API required for auth.users writes).
      </p>
    </AuthedShell>
  );
}
