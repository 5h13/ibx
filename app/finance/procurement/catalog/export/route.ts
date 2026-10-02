import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52: session-scoped client, so business-isolation RLS applies.
// Build 60: the user's catalog column layout (catalogColumns.ts), read from
// finance_catalog_price_list (pricing for the user's / "Acting as" business).
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { readCatalogFilters, applyCatalogFilters } from '@/modules/finance/procurement/catalogFilters';
import { CATALOG_COLUMNS, CATALOG_UPLOAD_EXTRA } from '@/modules/finance/procurement/catalogColumns';
import { buildXlsx, type Cell } from '@/shared/export/xlsx';
// CAT-07 (Build 77): ?format=xlsx gives the same columns as an Excel workbook
// (numbers as numeric cells), which the catalog import also accepts.

function csv(v: unknown) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }
const num = (v: unknown) => (v == null || v === '' ? '' : Number(v).toFixed(2));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filters = readCatalogFilters(url.searchParams);
  const xlsx = url.searchParams.get('format') === 'xlsx';
  const p = await getSessionProfile();
  if (!p?.user.is_active || (!isAdminTier(p) && p.user.section_code !== 'finance' && !p.access.some((a: any) => a.section_code === 'finance'))) return new NextResponse('Forbidden', { status: 403 });
  const db = createClient();
  const rows: unknown[][] = [[...CATALOG_COLUMNS, ...CATALOG_UPLOAD_EXTRA, 'Type', 'Status']];
  // money: text with 2 decimals in the CSV, a numeric cell in the workbook
  const m = (v: unknown) => (xlsx ? (v == null || v === '' ? null : Math.round(Number(v) * 100) / 100) : num(v));
  const priced = Boolean(p.user.business_id);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyCatalogFilters(db.from('finance_catalog_price_list').select('*'), filters).order('item_name').range(from, from + 999);
    if (error) return new NextResponse(error.message, { status: 500 });
    for (const x of (data ?? []) as any[]) {
      rows.push([
        x.item_name, x.category, x.generic_item, x.brand, x.description, x.photo_path ? 'Yes' : '',
        x.supplier_name ?? '', x.supplier_item_code ?? '', m(x.supplier_cost),
        priced && x.addon_percent != null ? Number(Number(x.addon_percent).toFixed(4)) : '',  // Add on as a % (the import reads a percentage) priced && x.item_type !== 'service' ? m(x.acquisition_cost) : '',
        priced ? m(x.store_price) : '', priced && x.markup_percent != null ? Number(Number(x.markup_percent).toFixed(2)) : '',
        x.item_code, x.unit, x.specification ?? '', '', '', x.stock_type === 'order_only' ? 'Order only' : 'Stock', x.item_type === 'service' ? 'Service' : 'Product', x.active ? 'Active' : 'Inactive',
      ]);
    }
    if (!data || data.length < 1000) break;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (xlsx) {
    return new NextResponse(buildXlsx(rows as Cell[][], 'Catalog') as any, { status: 200, headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="5H13-catalog-${stamp}.xlsx"`, 'Cache-Control': 'no-store' } });
  }
  const body = '﻿' + rows.map((r) => r.map(csv).join(',')).join('\r\n');
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="5H13-catalog-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
