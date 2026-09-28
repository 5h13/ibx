import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import HrMasters from '@/modules/admin/hr-masters/HrMasters';

export default async function HrMastersPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const canManage = isAdminTier(profile) || profile.user.section_code === 'admin' || profile.access.some((a) => a.section_code === 'admin');
  if (!canManage) redirect('/dashboard');

  const admin = createClient();
  const [{ data: departments, error: e1 }, { data: positions, error: e2 }, { data: workLocations, error: e3 }] = await Promise.all([
    admin.from('hr_departments').select('id,name,active').order('name'),
    admin.from('hr_positions').select('id,name,active').order('name'),
    admin.from('work_locations').select('id,name,active').order('name'),
  ]);
  const err = e1 || e2 || e3;
  if (err) throw new Error(err.message);

  return (
    <AuthedShell profile={profile}>
      <HrMasters departments={(departments ?? []) as any} positions={(positions ?? []) as any} workLocations={(workLocations ?? []) as any} />
    </AuthedShell>
  );
}
