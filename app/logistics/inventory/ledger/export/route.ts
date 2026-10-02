import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';
import { ledgerFilters } from '@/modules/logistics/inventory/ledgerFilters';

// LOG-41: stock-ledger export with the same filters as the ledger screen.
// Gated to the Logistics section (same test as requireSection); reads through
// the SESSION client, so business-isolation RLS applies, and unit cost is only
// present for users allowed to see cost (logistics_stock_ledger blanks it
// otherwise — LOG-39), in which case the column is left out entirely.
function csv(v: unknown) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }
const PAGE = 1000;           // PostgREST max rows per request
const MAX_ROWS = 200_000;    // hard stop for a single export

export async function GET(req: NextRequest) {
  const p = await getSessionProfile();
  if (!p?.user.is_active || !hasSectionAccess(p, 'logistics')) return new NextResponse('Forbidden', { status: 403 });
  const f = ledgerFilters(req.nextUrl.searchParams);
  const db = createClient();
  const { data: canCost } = await db.rpc('can_view_inventory_cost');
  const showCost = canCost === true;

  const rows: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await db.rpc('logistics_stock_ledger', {
      p_search: f.q || null, p_movement_type: f.type || null, p_location: f.location || null, p_item: f.item || null,
      p_date_from: f.from || null, p_date_to: f.to || null, p_limit: PAGE, p_offset: offset,
    });
    if (error) return new NextResponse(error.message, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const header = ['Date', 'Movement No.', 'Type', 'Item Code', 'Item', 'Unit', 'Location Code', 'Location', 'Lot', 'Quantity', 'Signed Quantity', 'Balance at Location', ...(showCost ? ['Unit Cost'] : []), 'Source', 'Reference', 'Notes', 'Recorded At'];
  const out = [header.map(csv).join(',')];
  for (const m of rows) {
    out.push([
      m.movement_date, m.movement_number, m.movement_type, m.item_code, m.item_name, m.unit, m.location_code, m.location_name,
      m.lot_number, m.quantity, m.signed_quantity, m.running_balance, ...(showCost ? [m.unit_cost] : []),
      m.source_table, m.reference_number, m.notes, m.created_at,
    ].map(csv).join(','));
  }
  const filterTag = [f.type, f.from && `from-${f.from}`, f.to && `to-${f.to}`].filter(Boolean).join('_');
  return new NextResponse(out.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stock-ledger-${new Date().toISOString().slice(0, 10)}${filterTag ? `_${filterTag}` : ''}.csv"`,
    },
  });
}
