import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { selectByScopedIds } from '@/core/auth/businessScope';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

// PR-14 (Agreed): PR register export, permission-filtered, with lineage —
// which purchase order(s), if any, an approved requisition was converted
// into — not just the columns already visible in the on-screen table.
function csv(v: unknown) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }

export async function GET() {
  const p = await getSessionProfile();
  if (!p?.user.is_active || (!isAdminTier(p) && p.user.section_code !== 'finance' && !p.access.some((a: any) => a.section_code === 'finance'))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  // Build 52 (CC-01-class fix): session-scoped client — previously service
  // role, so this export listed every business's PRs.
  const db = createClient();
  const { data: requisitions, error } = await db
    .from('purchase_requisitions')
    .select('id,pr_number,status,purpose,needed_by,estimated_total,department,requested_by,created_at')
    .order('created_at', { ascending: false });
  if (error) return new NextResponse(error.message, { status: 500 });

  // Requester names: `users` RLS only exposes a Finance user's own row, so an
  // embedded users join would blank every other requester. Resolve names by
  // the requested_by ids from the RLS-scoped PR rows (businessScope.ts
  // pattern 2) — full_name only.
  const svc = createAdminClient();
  const requesters = await selectByScopedIds<{ id: string; full_name: string | null }>(
    (ids) => svc.from('users').select('id,full_name').in('id', ids),
    (requisitions ?? []).map((r: any) => r.requested_by),
  );
  const requesterName = new Map(requesters.map((u) => [u.id, u.full_name ?? '']));

  const { data: orders } = await db.from('purchase_orders').select('id,po_number,requisition_id,status,total_amount');
  const posByPr = new Map<string, any[]>();
  for (const o of orders ?? []) { if (!o.requisition_id) continue; const arr = posByPr.get(o.requisition_id) ?? []; arr.push(o); posByPr.set(o.requisition_id, arr); }

  const { data: items } = await db.from('purchase_requisition_items').select('requisition_id,quantity,estimated_unit_cost');
  const lineCountByPr = new Map<string, number>();
  for (const it of items ?? []) { lineCountByPr.set(it.requisition_id, (lineCountByPr.get(it.requisition_id) ?? 0) + 1); }

  const rows: (string | number)[][] = [[
    'PR Number', 'Status', 'Department', 'Requested By', 'Purpose', 'Needed By',
    'Line Count', 'Estimated Total', 'Converted PO(s)', 'Converted PO Total', 'Created At',
  ]];
  for (const r of requisitions ?? []) {
    const pos = posByPr.get(r.id) ?? [];
    rows.push([
      r.pr_number, r.status, r.department ?? '', requesterName.get((r as any).requested_by) ?? '', r.purpose ?? '', r.needed_by ?? '',
      lineCountByPr.get(r.id) ?? 0, r.estimated_total ?? 0,
      pos.map((o) => o.po_number).join('; '),
      pos.reduce((s, o) => s + Number(o.total_amount || 0), 0),
      r.created_at,
    ]);
  }
  const body = rows.map((r) => r.map(csv).join(',')).join('\r\n');
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pr-register-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
