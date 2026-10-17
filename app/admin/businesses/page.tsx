import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthedShell } from '@/core/layout/AuthedShell';
import BusinessBrandingManagement from '@/modules/admin/businesses/BusinessBrandingManagement';

// U033 — Business Branding. Build 138 — Add store, Copy pricing, readiness. Global Super Admin only: `businesses` is a
// genuinely global master, and its write RLS policy is super_admin-only
// (not isAdminTier()) -- see src/modules/admin/businesses/actions.ts.
export default async function BusinessesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.user.role !== 'super_admin') redirect('/dashboard');

  const db = createClient();
  const { data, error } = await db
    .from('businesses')
    .select('id,code,legal_name,trade_name,branding,address,phone,email,is_active,created_at')
    .order('created_at');
  if (error) throw new Error(error.message);
  // Build 138 — what each store still needs before it can sell
  const readiness: Record<string, any> = {};
  await Promise.all((data ?? []).map(async (b: any) => {
    const r = await db.rpc('business_readiness', { p_business: b.id });
    readiness[b.id] = r.error ? null : r.data;
  }));

  return (
    <AuthedShell profile={profile}>
      <BusinessBrandingManagement businesses={(data ?? []) as any} readiness={readiness} />
    </AuthedShell>
  );
}
