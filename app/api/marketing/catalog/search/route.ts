// Build 124 — catalog search for the marketing tools: every word typed must appear in the item's name, code,
// brand, generic name or category (any order, partial words), like the app's own catalog search. Active items only.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { marketingToolUser, PHOTO_COLUMNS } from '@/modules/marketing/toolAccess';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await marketingToolUser(); if (error) return error;
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const words = q.toLowerCase().replace(/[^a-z0-9\-./ ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 1).slice(0, 6);
  if (!words.length) return NextResponse.json({ items: [] });
  // the catalog is shared by the stores (not per store), so it is read with the service client after the access check
  let query = createAdminClient().from('finance_procurement_items')
    .select(`id,item_code,item_name,brand,category,${PHOTO_COLUMNS.join(',')}`).eq('active', true);
  for (const w of words) {
    const p = `%${w.replace(/[%_]/g, '')}%`;
    query = query.or(['item_name', 'item_code', 'brand', 'generic_item', 'category'].map((c) => `${c}.ilike.${p}`).join(','));
  }
  const { data, error: e } = await query.order('item_name').limit(25);
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  return NextResponse.json({ items: ((data ?? []) as any[]).map((r) => ({
    id: r.id, code: r.item_code, name: r.item_name, brand: r.brand, category: r.category,
    photos: PHOTO_COLUMNS.filter((c) => r[c]).length,
  })) });
}
