import { NextResponse } from 'next/server';
import { CATALOG_COLUMNS } from '@/modules/finance/procurement/catalogColumns';

// Build 60 — import template in the catalog column layout, plus an optional
// Unit column (defaults to "unit"). Product Photo, Add on, Acquisition Cost
// and STORE PRICE are ignored on import (photos are uploaded per item; the
// prices are calculated). SUPPLIER = supplier code or registered name.
function csv(v: unknown) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }

export async function GET() {
  const header = [...CATALOG_COLUMNS, 'Unit'];
  const example = ['AC FILTER DRIER, GENESSO 1/2 FLARE TYPE 164FT', 'Uncategorized', 'AC FILTER DRIER', 'GENESSO', 'Optional description', '', 'SUP-0001', 'GEN-164FT', '350.00', '', '', '', '30', 'unit'];
  const body = '﻿' + [header, example].map((r) => r.map(csv).join(',')).join('\r\n') + '\r\n';
  return new NextResponse(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="catalog-import-template.csv"' } });
}
