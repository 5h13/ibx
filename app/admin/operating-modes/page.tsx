import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthedShell } from '@/core/layout/AuthedShell';
import OperatingModesManagement from '@/modules/admin/operating-modes/OperatingModesManagement';

// Build 113 — MODE-01. Super Admin only.
export default async function OperatingModesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.user.role !== 'super_admin') redirect('/dashboard');
  const { data, error } = await createClient().rpc('workflow_modes');
  if (error) throw new Error(error.message);
  return (
    <AuthedShell profile={profile}>
      <OperatingModesManagement stores={(data ?? []) as any[]} />
    </AuthedShell>
  );
}
