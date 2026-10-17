// Build 136b — the item's first photo at a fixed public address, for link previews (Messenger, Viber, Facebook).
// Only for items the open shop shows (active, with a photo); served from private storage, cached for a day.
import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ store: string; id: string }> }) {
  const { store, id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const { data: item } = await createClient().rpc('shop_item', { p_slug: store, p_item: id });
  const path = (item as any)?.photos?.[0] as string | undefined;
  if (!path) return new NextResponse('Not found', { status: 404 });
  const { data: blob, error } = await createAdminClient().storage.from('catalog-photos').download(path);
  if (error || !blob) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(await blob.arrayBuffer(), {
    headers: { 'Content-Type': blob.type || 'image/jpeg', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
  });
}
