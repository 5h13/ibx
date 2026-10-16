// Build 124 — one catalog item for the marketing tools: the texts they fill and links to its photos (served by
// /api/marketing/catalog/photo from the app's own address, so the tools can put them into PNG / GIF exports).
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { marketingToolUser, PHOTO_COLUMNS } from '@/modules/marketing/toolAccess';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await marketingToolUser(); if (error) return error;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
  const { data: r, error: e } = await createAdminClient().from('finance_procurement_items')
    .select(`id,item_code,item_name,brand,generic_item,category,description,specification,${PHOTO_COLUMNS.join(',')}`).eq('id', id).maybeSingle();
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  if (!r) return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
  const x = r as any;
  return NextResponse.json({
    id: x.id, code: x.item_code, name: x.item_name, brand: x.brand, generic: x.generic_item, category: x.category,
    description: x.description, specification: x.specification,
    photos: PHOTO_COLUMNS.map((c, i) => (x[c] ? `/api/marketing/catalog/photo?id=${x.id}&n=${i + 1}` : null)).filter(Boolean),
  });
}
