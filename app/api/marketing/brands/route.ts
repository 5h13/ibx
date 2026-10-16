// Build 122 — store names and logos for the marketing tools (Specs Card, Banner Studio).
// The logo is sent as a data URL so the tools can draw it into PNG / GIF exports (a logo straight from storage is
// another site, which the browser would not let the tools export).
import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';
import { createAdminClient } from '@/core/auth/supabaseAdmin';

export const dynamic = 'force-dynamic';
const MAX_LOGO = 2_000_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!hasSectionAccess(profile, 'marketing')) return NextResponse.json({ error: 'Marketing access is required.' }, { status: 403 });
  if (cache && Date.now() - cache.at < 10 * 60_000) return NextResponse.json(cache.body);
  const { data, error } = await createAdminClient().from('businesses').select('code,legal_name,trade_name,branding,is_active').eq('is_active', true).order('code');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const brands = await Promise.all(((data ?? []) as any[]).map(async (b) => {
    let logo: string | null = null;
    const url = b.branding?.logo_url;
    if (url) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const type = r.headers.get('content-type') || 'image/png';
        if (r.ok && type.startsWith('image/')) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length <= MAX_LOGO) logo = `data:${type};base64,${buf.toString('base64')}`;
        }
      } catch { /* the tool keeps its own logo */ }
    }
    return { code: b.code, name: b.trade_name || b.legal_name, logo };
  }));
  const body = { brands };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
