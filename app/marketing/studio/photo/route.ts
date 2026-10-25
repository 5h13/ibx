// Build 141 — a catalog photo for the Studio (signed in only). Catalog photos are in private storage; this sends the
// browser to a short-lived link, so the Studio loads only the photos it shows, as it shows them.
import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get('p') ?? '';
  if (!p || p.length > 300 || p.includes('..') || p.startsWith('/')) return new NextResponse('Not found', { status: 404 });
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return new NextResponse('Sign in first', { status: 401 });
  const admin = createAdminClient();
  // only photos of catalog items
  const q = `"${p.replace(/["\\]/g, '')}"`;   // quoted: paths may hold commas or brackets
  const { data: item } = await admin.from('finance_procurement_items').select('id')
    .or(`photo_path.eq.${q},photo_path_2.eq.${q},photo_path_3.eq.${q}`).limit(1).maybeSingle();
  if (!item) return new NextResponse('Not found', { status: 404 });
  const { data } = await admin.storage.from('catalog-photos').createSignedUrl(p, 3600);
  if (!data?.signedUrl) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=3000' } });
}
