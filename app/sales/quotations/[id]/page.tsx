// Build 69 — printable quotation for the client (DOC-12), with the business's
// branding. SF-08: shared document header (store name, logo, tagline,
// address, phone, email; no legal-name line). SF-09: Print + Download PDF.
import { notFound } from 'next/navigation';
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';

export const dynamic = 'force-dynamic';
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function QuotationPrintPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireSection('sales');
  const db = createClient();
  const { data: q } = await db.from('sales_quotations')
    .select(`*,customer:finance_customers(legal_name,address,phone,email,tax_id,contact_person),business:businesses(${DOCUMENT_BUSINESS_COLUMNS}),prepared:users!sales_quotations_prepared_by_fkey(full_name),approved:users!sales_quotations_approved_by_fkey(full_name),creator:users!sales_quotations_created_by_fkey(full_name)`)
    .eq('id', params.id).maybeSingle();
  if (!q) notFound();
  const { data: items } = await db.from('sales_quotation_items').select('*').eq('quotation_id', q.id).order('created_at').order('id');
  const biz: any = q.business;const cust: any = q.customer;
  const preparedBy = (q.prepared as any)?.full_name || (q.creator as any)?.full_name || '';
  const approvedBy = (q.approved as any)?.full_name || '';
  const draft = !['approved', 'sent', 'accepted'].includes(q.status);
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      {draft && <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-center text-xs text-amber-800 print:border-black print:bg-white print:text-black">
        {q.status === 'superseded' ? 'SUPERSEDED — a later revision of this quotation exists' : `DRAFT — not yet approved (${String(q.status).replaceAll('_', ' ')})`}</div>}
      <DocumentHeader business={biz}>
        <div className="text-xl font-bold">QUOTATION</div><div className="font-mono">{q.quotation_number}</div>{q.revision > 0 && <div>Revision {q.revision}</div>}<div>Date: {q.quotation_date}</div>{q.valid_until && <div>Valid until: {q.valid_until}</div>}
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Prepared for</div><div className="font-semibold">{cust?.legal_name}</div>{cust?.contact_person && <div>Attn: {cust.contact_person}</div>}{cust?.address && <div>{cust.address}</div>}{[cust?.phone, cust?.email].filter(Boolean).join(' · ') && <div>{[cust?.phone, cust?.email].filter(Boolean).join(' · ')}</div>}{cust?.tax_id && <div>TIN {cust.tax_id}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Terms</div><div>Payment: {q.payment_terms || 'As agreed'}</div><div>Delivery lead time: {q.delivery_lead_time || 'As agreed'}</div></div>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">#</th><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1">Unit</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{(items ?? []).map((i: any, n: number) => <tr key={i.id} className="border-b"><td className="py-1">{n + 1}</td><td className="py-1">{i.description}{i.notes && <div className="text-xs">{i.notes}</div>}</td><td className="py-1 text-right">{Number(i.quantity)}</td><td className="py-1">{i.unit}</td><td className="py-1 text-right">{peso(i.unit_price)}</td><td className="py-1 text-right">{peso(i.amount)}</td></tr>)}</tbody>
        <tfoot>
          <tr><td colSpan={5} className="pt-2 text-right">Subtotal</td><td className="pt-2 text-right">{peso(q.subtotal)}</td></tr>
          {Number(q.discount_amount) > 0 && <tr><td colSpan={5} className="text-right">Discount</td><td className="text-right">−{peso(q.discount_amount)}</td></tr>}
          {Number(q.tax_amount) > 0 && <tr><td colSpan={5} className="text-right">Tax</td><td className="text-right">{peso(q.tax_amount)}</td></tr>}
          {Number(q.other_charges) > 0 && <tr><td colSpan={5} className="text-right">Other charges</td><td className="text-right">{peso(q.other_charges)}</td></tr>}
          <tr><td colSpan={5} className="pt-1 text-right font-semibold">TOTAL</td><td className="pt-1 text-right font-semibold">{peso(q.total_amount)}</td></tr>
          {q.vat_applied
            ? <tr><td colSpan={5} className="text-right text-xs">VAT-inclusive: VATable sales {peso(Number(q.total_amount) - Number(q.vat_amount))} · VAT 12% {peso(q.vat_amount)}</td><td /></tr>
            : <tr><td colSpan={5} className="text-right text-xs">Prices are not subject to VAT.</td><td /></tr>}
        </tfoot>
      </table>
      {q.notes && <div className="mt-4"><div className="text-xs uppercase">Notes</div><div className="whitespace-pre-line">{q.notes}</div></div>}
      <div className="mt-4 text-xs">Prices are in Philippine pesos{q.valid_until ? ` and valid until ${q.valid_until}` : ''}. To proceed, please send your purchase order or written confirmation quoting {q.quotation_number}.</div>
      <div data-pdf-block className="mt-12 grid grid-cols-3 gap-8 text-center text-xs">
        <div><div className="h-5">{preparedBy}</div><div className="border-t border-black pt-1">Prepared by</div></div>
        <div><div className="h-5">{approvedBy}</div><div className="border-t border-black pt-1">Approved by</div></div>
        <div><div className="h-5" /><div className="border-t border-black pt-1">Conforme (client signature / date)</div></div>
      </div>
      <DocumentActions documentNumber={q.quotation_number} className="mt-8" />
    </div>
  );
}
