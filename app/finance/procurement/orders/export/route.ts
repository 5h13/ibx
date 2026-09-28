import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { selectByScopedIds } from '@/core/auth/businessScope';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

// PO-15 (Resolved): PO register export, permission-filtered, including
// lineage (source PR), lines, receiving status, AP linkage, and the
// outstanding (unpaid) balance — not just the top-level PO columns the
// prior client-side-only CSV button produced.
function csv(v: unknown) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }

export async function GET() {
  const p = await getSessionProfile();
  if (!p?.user.is_active || (!isAdminTier(p) && p.user.section_code !== 'finance' && !p.access.some((a: any) => a.section_code === 'finance'))) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  // Build 52 (CC-01-class fix): session-scoped client — previously service
  // role, so this export listed every business's POs.
  const db = createClient();
  const { data: orders, error } = await db
    .from('purchase_orders')
    .select('id,po_number,status,issuance_status,issuance_method,issued_at,requisition_id,requisition:purchase_requisitions(pr_number),supplier:finance_suppliers(legal_name,supplier_code),order_date,expected_delivery_date,delivery_address,subtotal,tax_amount,other_charges,total_amount,created_at')
    .order('created_at', { ascending: false });
  if (error) return new NextResponse(error.message, { status: 500 });

  const { data: items } = await db.from('purchase_order_items').select('purchase_order_id,quantity');
  const lineCountByPo = new Map<string, number>();
  for (const it of items ?? []) { lineCountByPo.set(it.purchase_order_id, (lineCountByPo.get(it.purchase_order_id) ?? 0) + 1); }

  // Receiving status lives in Logistics, which Finance-only users have no RLS
  // read grant on. Resolve it by the PO ids already returned by the
  // RLS-scoped query above (businessScope.ts pattern 2) — those ids can only be
  // this business's, so the service-role lookup can't widen what's exported.
  const svc = createAdminClient();
  const receipts = await selectByScopedIds<{ purchase_order_id: string | null; status: string }>(
    (ids) => svc.from('logistics_receipts').select('purchase_order_id,status').in('purchase_order_id', ids),
    (orders ?? []).map((o: any) => o.id),
  );
  const receiptStatusByPo = new Map<string, string[]>();
  for (const rc of receipts ?? []) { if (!rc.purchase_order_id) continue; const arr = receiptStatusByPo.get(rc.purchase_order_id) ?? []; arr.push(rc.status); receiptStatusByPo.set(rc.purchase_order_id, arr); }

  const { data: invoices } = await db.from('finance_supplier_invoices').select('purchase_order_id,invoice_number,total_amount,balance_due,status');
  const invoicesByPo = new Map<string, any[]>();
  for (const inv of invoices ?? []) { if (!inv.purchase_order_id) continue; const arr = invoicesByPo.get(inv.purchase_order_id) ?? []; arr.push(inv); invoicesByPo.set(inv.purchase_order_id, arr); }

  const rows: (string | number)[][] = [[
    'PO Number', 'Status', 'Issuance Status', 'Issued Via', 'Issued At', 'Source PR', 'Supplier',
    'Order Date', 'Expected Delivery', 'Delivery Address', 'Line Count',
    'Subtotal', 'Tax', 'Other Charges', 'Total', 'Receiving Status',
    'AP Invoice(s)', 'AP Invoiced Total', 'AP Outstanding Balance', 'Created At',
  ]];
  for (const o of orders ?? []) {
    const invs = invoicesByPo.get(o.id) ?? [];
    const receiptStatuses = [...new Set(receiptStatusByPo.get(o.id) ?? [])];
    rows.push([
      o.po_number, o.status, o.issuance_status, o.issuance_method ?? '', o.issued_at ?? '',
      (o as any).requisition?.pr_number ?? '', (o as any).supplier?.legal_name ?? '',
      o.order_date, o.expected_delivery_date ?? '', o.delivery_address ?? '',
      lineCountByPo.get(o.id) ?? 0,
      o.subtotal, o.tax_amount, o.other_charges, o.total_amount,
      receiptStatuses.length ? receiptStatuses.join('; ') : 'Not received',
      invs.map((i) => i.invoice_number).join('; '),
      invs.reduce((s, i) => s + Number(i.total_amount || 0), 0),
      invs.reduce((s, i) => s + Number(i.balance_due || 0), 0),
      o.created_at,
    ]);
  }
  const body = rows.map((r) => r.map(csv).join(',')).join('\r\n');
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="po-register-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
