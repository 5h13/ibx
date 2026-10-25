// Build 141 — Studio (from 5h13Shops Builds 11–14): pictures made from the store's catalog — specs card, price lists,
// banners, New arrivals / Back in stock — drawn on the user's own phone or computer; downloaded, shared, printed,
// posted on the store's online shop (promotion or announcement) or posted to Facebook. Prices are the store's shop
// prices. For the store's Business Admin, Sales Manager, Sales and Marketing staff.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { hasSectionAccess, isAdminTier } from '@/core/auth/types';
import { parseTheme } from '@/core/theme/brandTheme';
import { siteOrigin } from '@/modules/shop/data';
import { StudioApp, type StudioProduct } from '@/modules/studio/StudioApp';
import { DEFAULT_FONT, STUDIO_FONTS, type StudioFont } from '@/modules/studio/fonts';

export const dynamic = 'force-dynamic';

/** 09171234567 → "0917 123 4567" */
function nice(n: string | null | undefined) {
  const d = (n ?? '').replace(/[^\d+]/g, '');
  if (/^09\d{9}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^(\+?63)9\d{9}$/.test(d)) { const x = d.replace(/^\+?63/, '0'); return `${x.slice(0, 4)} ${x.slice(4, 7)} ${x.slice(7)}`; }
  return n ?? '';
}
const photoUrl = (p: string) => `/marketing/studio/photo?p=${encodeURIComponent(p)}`;
/** ERP specification text → "Label: Value" pairs (plain lines keep an empty label) */
function specs(t: string | null) {
  return (t ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => {
    const i = l.indexOf(':');
    return i > 0 && i < 40 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: '', value: l };
  }).filter((x) => x.value);
}

export default async function StudioPage(props: { searchParams?: Promise<{ tool?: string; p?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile) && !hasSectionAccess(profile, 'sales') && !hasSectionAccess(profile, 'marketing')) redirect('/dashboard');
  const b = profile.user.business_id;
  if (!b) return <AuthedShell profile={profile}><p className="rounded border bg-white p-4 text-sm text-slate-600">Choose a store in &quot;Acting as&quot; first.</p></AuthedShell>;
  const db = createClient();
  const [{ data: rows, error }, { data: biz }, { data: shop }] = await Promise.all([
    db.rpc('studio_products'),
    db.from('businesses').select('legal_name, trade_name, phone, branding').eq('id', b).maybeSingle(),
    db.from('shop_settings').select('slug, tagline, viber_number, whatsapp_number, facebook_url, studio_font').eq('business_id', b).maybeSingle(),
  ]);
  if (error) return <AuthedShell profile={profile}><p className="rounded border bg-white p-4 text-sm text-red-700">{error.message}</p></AuthedShell>;
  type Row = { id: string; code: string; name: string; category: string; price: number | null; available: boolean; specification: string | null;
    photo_path: string | null; photo_path_2: string | null; photo_path_3: string | null; created_at: string; updated_at: string };
  const products: StudioProduct[] = ((rows ?? []) as Row[]).map((r) => ({
    id: r.id, code: r.code, name: r.name, category: r.category ?? '', price: r.price == null ? null : Number(r.price), available: !!r.available,
    specs: specs(r.specification),
    photos: [r.photo_path, r.photo_path_2, r.photo_path_3].filter((x): x is string => !!x).map(photoUrl),
    created_at: r.created_at, updated_at: r.updated_at,
  }));
  const br: any = (biz as any)?.branding ?? {};
  const theme = parseTheme(br.theme);
  const s: any = shop ?? {};
  const num = s.whatsapp_number || s.viber_number || (biz as any)?.phone;
  const apps = [s.viber_number ? 'Viber' : null, s.whatsapp_number ? 'WhatsApp' : null].filter(Boolean).join(' · ');
  const fb = s.facebook_url ? String(s.facebook_url).replace(/^https?:\/\/((www|m|web)\.)?facebook\.com\//i, 'fb.com/').replace(/\/$/, '') : '';
  const contacts = [num ? [nice(num), apps].filter(Boolean).join(' · ') : '', fb].filter(Boolean).join(' • ');
  const font = (STUDIO_FONTS.some((f) => f.key === s.studio_font) ? s.studio_font : DEFAULT_FONT) as StudioFont;
  const brandColor = (theme as any)?.header || br.primary_color || '#0e6e63';
  return (
    <AuthedShell profile={profile}>
      <div className="studio-ui max-w-6xl">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Studio</h2>
            <p className="text-sm text-slate-600">Pictures for Facebook, Viber and the online shop, made from this store&apos;s catalog at its shop prices. Every word can be changed.</p>
          </div>
          <span className="text-xs text-slate-500">Older tools: <Link href="/marketing/banner-studio" className="underline">Banner Studio</Link> · <Link href="/marketing/specs-card" className="underline">Specs Card</Link></span>
        </div>
        <StudioApp products={products}
          store={{
            name: (biz as any)?.trade_name || (biz as any)?.legal_name || '', tagline: s.tagline || br.tagline || '', logoUrl: br.logo_url || null,
            brandColor, contacts, font, shopUrl: s.slug ? `${await siteOrigin()}/shop/${s.slug}` : await siteOrigin(),
            canStore: true, canPost: !!s.slug, facebookUrl: s.facebook_url ?? null,
          }}
          initialTool={sp.tool} initialCode={sp.p} />
      </div>
    </AuthedShell>
  );
}
