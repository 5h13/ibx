// Build 136 — Sales → Online Shop: the store's public catalog settings.
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier, isSuperAdmin } from '@/core/auth/types';
import { ShopSettingsForm } from '@/modules/shop/ShopSettingsForm';

export const dynamic = 'force-dynamic';

export default async function OnlineShopSettings() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile)) redirect('/dashboard');
  const b = profile.user.business_id;
  const { data } = b ? await createClient().from('shop_settings').select('business_id,slug,enabled,messenger_url,viber_number,tagline').eq('business_id', b).maybeSingle() : { data: null };
  return (
    <AuthedShell profile={profile}>
      <h2 className="mb-1 text-lg font-semibold">Online Shop</h2>
      <p className="mb-4 text-sm text-slate-600">This store&apos;s public catalog: anyone can browse it without logging in and message you about an item.</p>
      {!b && <p className="rounded border bg-white p-4 text-sm text-slate-600">Choose a store in &quot;Acting as&quot; first.</p>}
      {b && !data && <p className="rounded border bg-white p-4 text-sm text-slate-600">The online shop is not set up for this store yet (deploy the Build 136 database update).</p>}
      {data && <ShopSettingsForm s={data as any} superAdmin={isSuperAdmin(profile)} />}
    </AuthedShell>
  );
}
