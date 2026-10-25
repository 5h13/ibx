// Build 136 — Sales → Online Shop: the store's public catalog settings.
// Build 137 — layout, Facebook page, front-page sections, featured product, slideshow, announcements / promotions.
// Build 139 — Shop header (preview, banner photo), WhatsApp.
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier, isSuperAdmin } from '@/core/auth/types';
import { ShopSettingsForm, type ShopPost, type ShopSettingsRow } from '@/modules/shop/ShopSettingsForm';
import { bannerUrl } from '@/modules/shop/data';

export const dynamic = 'force-dynamic';

export default async function OnlineShopSettings() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile)) redirect('/dashboard');
  const b = profile.user.business_id;
  const db = createClient();
  const [{ data }, { data: posts }, { data: filters }] = b
    ? await Promise.all([
        db.from('shop_settings').select('*').eq('business_id', b).maybeSingle(),
        db.from('shop_posts').select('id,kind,title,body,starts_on,ends_on,item_id,link_category,active,image_path').eq('business_id', b).order('created_at', { ascending: false }).limit(60),
        db.rpc('shop_admin_filters', { p_category: null, p_item: null, p_brand: null }),
      ])
    : [{ data: null }, { data: [] }, { data: null }];
  const s = data as ShopSettingsRow | null;
  const ids = Array.from(new Set([s?.featured_item_id, ...((posts ?? []) as any[]).map((p) => p.item_id)].filter(Boolean))) as string[];
  const { data: items } = ids.length ? await db.from('finance_procurement_items').select('id,item_name').in('id', ids) : { data: [] };
  const name = new Map(((items ?? []) as any[]).map((i) => [i.id, i.item_name as string]));
  // Build 139: the header preview shows the store's logo, colours and name (System → Businesses) and the banner
  const { data: biz } = b ? await db.from('businesses').select('legal_name,trade_name,branding').eq('id', b).maybeSingle() : { data: null };
  const header = { name: ((biz as any)?.trade_name || (biz as any)?.legal_name || '') as string, logo_url: ((biz as any)?.branding?.logo_url ?? null) as string | null,
    theme: (biz as any)?.branding?.theme ?? null, banner_url: bannerUrl(s?.banner_path) };
  return (
    <AuthedShell profile={profile}>
      <h2 className="mb-1 text-lg font-semibold">Online Shop</h2>
      <p className="mb-4 text-sm text-slate-600">Make pictures for the shop and Facebook in <a href="/marketing/studio" className="underline">Studio</a>; requests from buyers arrive in <a href="/sales/shop-inbox" className="underline">Shop Inbox</a>. This store&apos;s public shop: anyone can browse it without logging in, message you about an item or send a request for quotation.</p>
      {!b && <p className="rounded border bg-white p-4 text-sm text-slate-600">Choose a store in &quot;Acting as&quot; first.</p>}
      {b && !s && <p className="rounded border bg-white p-4 text-sm text-slate-600">The online shop is not set up for this store yet (deploy the latest database update).</p>}
      {s && (
        <ShopSettingsForm s={{ ...s, layout: (s.layout ?? 'A') as 'A' | 'B' | 'C' }} superAdmin={isSuperAdmin(profile)}
          posts={((posts ?? []) as (ShopPost & { image_path?: string | null })[]).map((p) => ({ ...p, item_name: p.item_id ? name.get(p.item_id) ?? null : null, image_url: bannerUrl(p.image_path) }))}
          featuredName={s.featured_item_id ? name.get(s.featured_item_id) ?? null : null}
          categories={((filters as any)?.categories ?? []) as string[]} header={header} />
      )}
    </AuthedShell>
  );
}
