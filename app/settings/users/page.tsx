import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier } from '@/core/auth/types';
import UserManagement from '@/modules/admin/users/UserManagement';

export default async function UsersPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile)) redirect('/dashboard');

  // Session-scoped client, not the service-role admin client: a Global
  // Super Admin still sees everything (is_super_admin() bypasses RLS), and
  // a Business Super Admin is now correctly scoped to their own business's
  // users/businesses by the RLS policies added for that role, rather than
  // this page having to filter anything itself.
  const db = createClient();
  const [{ data: sections, error: sectionsError }, { data: users, error: usersError }, { data: businesses, error: businessesError }] = await Promise.all([
    db.from('sections').select('id, code, name').order('name'),
    db.from('users').select('id, email, full_name, role, section_id, business_id, is_active, access:user_access(section_id, workflow_role), functions:user_functions!user_functions_user_id_fkey(function_code)').order('email'),
    db.from('businesses').select('id, code, legal_name, trade_name, is_active').eq('is_active', true).order('trade_name'),
  ]);
  // Build 91: freelance agents an Agent login can be linked to
  const { data: agents } = await db.from('sales_agents').select('id, agent_code, name, user_id').eq('kind', 'freelance').eq('active', true).order('name');
  if (sectionsError) throw new Error(sectionsError.message);
  if (usersError) throw new Error(usersError.message);
  if (businessesError) throw new Error(businessesError.message);

  return <AuthedShell profile={profile}><UserManagement sections={sections ?? []} users={(users ?? []) as any} businesses={businesses ?? []} actingRole={profile.user.role} currentUserId={profile.user.id} agents={(agents ?? []) as any} /></AuthedShell>;
}
