import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52: session-scoped client, so business-isolation RLS applies.
// Build 60: the user's catalog column layout (catalogColumns.ts), read from
// finance_catalog_price_list (pricing for the user's / "Acting as" business).
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { readCatalogFilters, applyCatalogFilters } from '@/modules/finance/procurement/catalogFilters';
import { CATALOG_COLUMNS } from '@/modules/finance/procurement/catalogColumns';

function csv(v: unknown) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }
const num = (v: unknown) => (v == null || v === '' ? '' : Number(v).toFixed(2));

export async function GET(req: Request) {
  const filters = readCatalogFilters(new URL(req.url).searchParams);
  const p = await getSessionProfile();
  if (!p?.user.is_active || (!isAdminTier(p) && p.user.section_code !== 'finance' && !p.access.some((a: any) => a.section_code === 'finance'))) return new NextResponse('Forbidden', { status: 403 });
  const db = createClient();
  const rows: unknown[][] = [[...CATALOG_COLUMNS, 'Item Code', 'Unit', 'Type', 'Status']];
  const priced = Boolean(p.user.business_id);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyCatalogFilters(db.from('finance_catalog_price_list').select('*'), filters).order('item_name').range(from, from + 999);
    if (error) return new NextResponse(error.message, { status: 500 });
    for (const x of (data ?? []) as any[]) {
      rows.push([
        x.item_name, x.category, x.generic_item, x.brand, x.description, x.photo_path ? 'Yes' : '',
        x.supplier_name ?? '', x.supplier_item_code ?? '', num(x.supplier_cost),
        priced ? num(x.addon_amount) : '', priced && x.item_type !== 'service' ? num(x.acquisition_cost) : '',
        priced ? num(x.store_price) : '', priced && x.markup_percent != null ? Number(Number(x.markup_percent).toFixed(2)) : '',
        x.item_code, x.unit, x.item_type === 'service' ? 'Service' : 'Product', x.active ? 'Active' : 'Inactive',
      ]);
    }
    if (!data || data.length < 1000) break;
  }
  const body = '﻿' + rows.map((r) => r.map(csv).join(',')).join('\r\n');
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="5H13-catalog-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
