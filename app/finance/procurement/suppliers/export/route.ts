import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { buildCsv, buildXlsx, type Cell } from '@/shared/export/xlsx';
import { canExportSuppliers, canExportSupplierSensitive } from '@/modules/finance/procurement/supplierExport';

// SUP-11 — supplier register export (CSV or XLSX).
// - Permission-gated (Finance section or admin tier), server-side.
// - Business-aware: the supplier master is global, but the business-specific
//   columns (relationship status/terms/preferred — SUP-05; purchase history
//   and AP position — SUP-10) come through the session client, so RLS limits
//   them to the viewer's own business. The Global Super Admin with no acting
//   business gets purchase/AP totals across all businesses and no
//   relationship columns (there is no single business to report).
// - Sensitive details (tax id, bank details, payment destination) are left
//   out unless explicitly requested with ?sensitive=1 AND the viewer is admin
//   tier or a Finance approver; every sensitive export is written to audit_log.
export async function GET(request: Request) {
  const profile = await getSessionProfile();
  if (!canExportSuppliers(profile)) return new NextResponse('Forbidden', { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const wantSensitive = url.searchParams.get('sensitive') === '1';
  if (wantSensitive && !canExportSupplierSensitive(profile)) {
    return new NextResponse('Forbidden: sensitive supplier details require a Finance approver or Super Admin.', { status: 403 });
  }
  const includeInactive = url.searchParams.get('inactive') === '1';

  const db = createClient();
  let supplierQuery = db
    .from('finance_suppliers')
    .select('id,supplier_code,legal_name,trade_name,active,contact_person,email,phone,address,billing_address,shipping_address,payment_terms,preferred_payment_method,credit_limit,credit_currency,tax_id,bank_details,payment_destination,created_at')
    .order('supplier_code');
  if (!includeInactive) supplierQuery = supplierQuery.eq('active', true);

  const [{ data: suppliers, error: se }, { data: relationships, error: re }, { data: history, error: he }, { data: exposure, error: ee }] = await Promise.all([
    supplierQuery,
    db.from('finance_supplier_business_relationships').select('supplier_id,business_id,status,payment_terms_override,preferred'),
    db.from('finance_supplier_purchase_history').select('*'),
    db.from('finance_supplier_credit_exposure').select('supplier_id,outstanding_exposure'),
  ]);
  const err = se || re || he || ee;
  if (err) return new NextResponse(err.message, { status: 500 });

  // The acting/own business, if any. Relationship columns are only
  // meaningful for one business at a time.
  const businessId = profile!.user.business_id;
  const relBySupplier = new Map<string, any>();
  for (const r of relationships ?? []) if (!businessId || r.business_id === businessId) relBySupplier.set(r.supplier_id, r);
  const histBySupplier = new Map<string, any>();
  for (const h of (history ?? []) as any[]) {
    if (businessId && h.business_id !== businessId) continue;
    const prev = histBySupplier.get(h.supplier_id);
    if (!prev) { histBySupplier.set(h.supplier_id, { ...h }); continue; }
    // Global Super Admin, no acting business: combine businesses.
    for (const k of ['po_count_ytd', 'ytd_purchase_value', 'outstanding_balance', 'overdue_invoice_count'] as const) prev[k] = Number(prev[k] || 0) + Number(h[k] || 0);
    if (h.last_purchase_date && (!prev.last_purchase_date || h.last_purchase_date > prev.last_purchase_date)) prev.last_purchase_date = h.last_purchase_date;
    if (h.last_payment_date && (!prev.last_payment_date || h.last_payment_date > prev.last_payment_date)) prev.last_payment_date = h.last_payment_date;
    prev.payment_status = Number(prev.overdue_invoice_count) > 0 ? 'overdue' : Number(prev.outstanding_balance) > 0 ? 'open_balance' : prev.payment_status === 'fully_paid' || h.payment_status === 'fully_paid' ? 'fully_paid' : 'no_invoices';
  }
  const exposureBySupplier = new Map((exposure ?? []).map((x: any) => [x.supplier_id, x.outstanding_exposure]));
  const perBusiness = Boolean(businessId);

  const header: Cell[] = [
    'Supplier Code', 'Legal Name', 'Trade Name', 'Master Status',
    ...(perBusiness ? ['This Business Status', 'Preferred (This Business)'] : []),
    'Payment Terms', 'Preferred Payment Method', 'Contact Person', 'Email', 'Phone',
    'Address', 'Billing Address', 'Shipping Address', 'Credit Limit', 'Credit Currency', 'Outstanding Exposure',
    'YTD Purchase Value', 'POs This Year', 'Last Purchase', 'Outstanding AP', 'Overdue Invoices', 'Last Payment', 'Payment Status',
    ...(wantSensitive ? ['Tax ID', 'Bank Details', 'Payment Destination'] : []),
    'Created At',
  ];
  const statusLabel: Record<string, string> = { overdue: 'Overdue', open_balance: 'Open balance', fully_paid: 'Fully paid', no_invoices: 'No invoices' };
  const rows: Cell[][] = [header];
  for (const s of (suppliers ?? []) as any[]) {
    const rel = relBySupplier.get(s.id);
    const h = histBySupplier.get(s.id);
    rows.push([
      s.supplier_code, s.legal_name, s.trade_name, s.active ? 'Active' : 'Inactive',
      ...(perBusiness ? [rel?.status === 'inactive' ? 'Inactive' : 'Active', rel?.preferred ? 'Yes' : 'No'] : []),
      (perBusiness && rel?.payment_terms_override) || s.payment_terms, s.preferred_payment_method, s.contact_person, s.email, s.phone,
      s.address, s.billing_address, s.shipping_address,
      s.credit_limit == null ? null : Number(s.credit_limit), s.credit_currency, Number(exposureBySupplier.get(s.id) ?? 0),
      Number(h?.ytd_purchase_value ?? 0), Number(h?.po_count_ytd ?? 0), h?.last_purchase_date ?? null,
      Number(h?.outstanding_balance ?? 0), Number(h?.overdue_invoice_count ?? 0), h?.last_payment_date ?? null,
      statusLabel[h?.payment_status ?? 'no_invoices'],
      ...(wantSensitive ? [s.tax_id, s.bank_details, s.payment_destination] : []),
      s.created_at,
    ]);
  }

  if (wantSensitive) {
    const { error: ae } = await db.from('audit_log').insert({
      actor_id: profile!.user.id,
      entity_table: 'finance_suppliers',
      entity_id: profile!.user.id,
      action: 'supplier_register_exported_sensitive',
      detail: { format, supplier_count: rows.length - 1, fields: ['tax_id', 'bank_details', 'payment_destination'], business_id: businessId },
    });
    // Refuse to hand out sensitive data we could not record the release of.
    if (ae) return new NextResponse(`Unable to record the export: ${ae.message}`, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `5H13-suppliers-${stamp}${wantSensitive ? '-SENSITIVE' : ''}`;
  if (format === 'xlsx') {
    const body = buildXlsx(rows, 'Suppliers');
    return new NextResponse(body as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return new NextResponse(buildCsv(rows), {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' },
  });
}
