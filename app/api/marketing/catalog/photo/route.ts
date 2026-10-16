// Build 124 — a catalog photo for the marketing tools, from the private photo storage, served from the app's own
// address (a photo from another address would stop the tools from exporting PNG / GIF).
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { marketingToolUser, PHOTO_COLUMNS } from '@/modules/marketing/toolAccess';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await marketingToolUser(); if (error) return error;
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') ?? ''; const n = Number(sp.get('n') ?? '1');
  if (!/^[0-9a-f-]{36}$/i.test(id) || ![1, 2, 3].includes(n)) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  const admin = createAdminClient();
  const col = PHOTO_COLUMNS[n - 1];
  const { data: r } = await admin.from('finance_procurement_items').select(col).eq('id', id).maybeSingle();
  const path = (r as any)?.[col];
  if (!path) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  const { data: file, error: e } = await admin.storage.from('catalog-photos').download(path);
  if (e || !file) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  return new NextResponse(file, { headers: { 'content-type': file.type || 'image/jpeg', 'cache-control': 'private, max-age=600' } });
}
