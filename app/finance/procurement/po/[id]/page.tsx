// Build 75 — printable Purchase Order for the supplier (PO-07: external document).
import { notFound } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';
import { pesoDoc as peso, requireAnySection } from '@/shared/documents/access';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrderPrintPage({ params }: { params: { id: string } }) {
  await requireAnySection(['finance']);
  const db = createClient();
  const { data: po } = await db.from('purchase_orders')
    .select(`*,supplier:finance_suppliers!purchase_orders_supplier_id_fkey(supplier_code,legal_name,trade_name,contact_person,address,phone,email,tax_id),business:businesses!purchase_orders_business_id_fkey(${DOCUMENT_BUSINESS_COLUMNS}),approver:users!purchase_orders_approved_by_fkey(full_name),preparer:users!purchase_orders_prepared_by_fkey(full_name)`)
    .eq('id', params.id).maybeSingle();
  if (!po) notFound();
  // Build 77: supplier TIN lives in finance_supplier_private (Finance / admin only)
  const { data: priv } = await db.from('finance_supplier_private').select('tax_id').eq('supplier_id', po.supplier_id).maybeSingle();
  const { data: items } = await db.from('purchase_order_items').select('description,quantity,unit,unit_cost,amount,supplier_item_code').eq('purchase_order_id', po.id).order('created_at');
  const sup: any = po.supplier;
  const approved = ['approved'].includes(String(po.status));
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      <DocumentHeader business={po.business as any}>
        <div className="text-xl font-bold">PURCHASE ORDER</div><div className="font-mono">{po.po_number}</div><div>Date: {po.order_date}</div>
        {!approved && <div className="mt-1 font-bold text-red-700">DRAFT — NOT APPROVED</div>}
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Supplier</div><div className="font-semibold">{sup?.trade_name || sup?.legal_name}</div>{sup?.trade_name && sup?.legal_name !== sup?.trade_name && <div>{sup.legal_name}</div>}{sup?.address && <div>{sup.address}</div>}{sup?.contact_person && <div>Attn: {sup.contact_person}</div>}{(sup?.phone || sup?.email) && <div>{[sup.phone, sup.email].filter(Boolean).join(' · ')}</div>}{(priv?.tax_id || sup?.tax_id) && <div>TIN {priv?.tax_id || sup?.tax_id}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Deliver to</div><div>{po.delivery_address || '—'}</div>{po.expected_delivery_date && <div>Expected: {po.expected_delivery_date}</div>}{po.payment_terms && <div>Terms: {po.payment_terms}</div>}</div>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">#</th><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1">Unit</th><th className="py-1 text-right">Unit cost</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{(items ?? []).map((i: any, n: number) => <tr key={n} className="border-b"><td className="py-1">{n + 1}</td><td className="py-1">{i.description}{i.supplier_item_code && <div className="text-xs">Your code: {i.supplier_item_code}</div>}</td><td className="py-1 text-right">{Number(i.quantity)}</td><td className="py-1">{i.unit}</td><td className="py-1 text-right">{peso(i.unit_cost)}</td><td className="py-1 text-right">{peso(i.amount ?? Number(i.quantity) * Number(i.unit_cost))}</td></tr>)}</tbody>
        <tfoot>
          <tr><td colSpan={5} className="pt-2 text-right">Subtotal</td><td className="pt-2 text-right">{peso(po.subtotal)}</td></tr>
          {Number(po.tax_amount) > 0 && <tr><td colSpan={5} className="text-right">Tax</td><td className="text-right">{peso(po.tax_amount)}</td></tr>}
          {Number(po.other_charges) > 0 && <tr><td colSpan={5} className="text-right">Other charges</td><td className="text-right">{peso(po.other_charges)}</td></tr>}
          <tr><td colSpan={5} className="pt-1 text-right font-semibold">TOTAL ({po.currency || 'PHP'})</td><td className="pt-1 text-right font-semibold">{peso(po.total_amount)}</td></tr>
        </tfoot>
      </table>
      {po.notes && <div className="mt-4"><div className="text-xs uppercase">Notes</div><div className="whitespace-pre-line">{po.notes}</div></div>}
      <p className="mt-4 text-xs">Please quote our PO number on your delivery receipt and invoice.</p>
      <div data-pdf-block className="mt-12 grid grid-cols-2 gap-12 text-center text-xs">
        <div className="border-t border-black pt-1">Prepared by{(po as any).preparer?.full_name ? `: ${(po as any).preparer.full_name}` : ''}</div>
        <div className="border-t border-black pt-1">Approved by{(po as any).approver?.full_name ? `: ${(po as any).approver.full_name}` : ''}</div>
      </div>
      <DocumentActions documentNumber={po.po_number} className="mt-8" />
    </div>
  );
}
