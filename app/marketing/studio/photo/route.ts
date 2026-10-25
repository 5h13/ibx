// Build 141 — a catalog photo for the Studio (signed in only). Catalog photos are in private storage.
// Build 141b: the photo is sent from the app's own address (not a redirect to storage), so the Studio's drawing can
// use it; the browser keeps it for an hour.
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
  const { data: blob, error } = await admin.storage.from('catalog-photos').download(p);
  if (error || !blob) return new NextResponse('Not found', { status: 404 });
  const ext = p.toLowerCase().split('.').pop() ?? '';
  const type = blob.type.startsWith('image/') ? blob.type : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return new NextResponse(await blob.arrayBuffer(), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' },
  });
}
