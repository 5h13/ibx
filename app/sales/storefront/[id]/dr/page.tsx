// Build 67 — printable Delivery Receipt for a counter sale (DOC-15).
// SF-08: shared document header (store name, logo, tagline, address, phone,
// email; no legal-name line). SF-09: Print + Download PDF, A4/letter layout.
// Build 78: hardcopy DR no. (SF-29) and the lot of each line.
import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';

export const dynamic = 'force-dynamic';
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function StorefrontDrPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // SF-20: Sales and Finance (read-only) may open a DR
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!hasSectionAccess(profile, 'sales') && !hasSectionAccess(profile, 'finance')) redirect('/dashboard');
  const db = createClient();
  const { data: sale } = await db.from('storefront_sales')
    .select(`*,customer:finance_customers(legal_name,address,phone,tax_id),business:businesses!storefront_sales_business_id_fkey(${DOCUMENT_BUSINESS_COLUMNS}),order:sales_orders(order_number,client_po_number)`)
    .eq('id', params.id).maybeSingle();
  if (!sale || !sale.dr_number) notFound();
  const { data: items } = await db.from('storefront_sale_items').select('*').eq('sale_id', sale.id).order('description');
  const biz: any = sale.business;const cust: any = sale.customer;
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      <DocumentHeader business={biz}>
        <div className="text-xl font-bold">DELIVERY RECEIPT</div><div className="font-mono">{sale.dr_number}</div><div>Date: {sale.sale_date}</div>{sale.si_number && <div>SI No.: {sale.si_number}</div>}{sale.hardcopy_dr_no && <div>Hardcopy DR no.: {sale.hardcopy_dr_no}</div>}
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Delivered to</div><div className="font-semibold">{cust?.legal_name}</div>{cust?.address && <div>{cust.address}</div>}{cust?.phone && <div>{cust.phone}</div>}{cust?.tax_id && <div>TIN {cust.tax_id}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Reference</div>{(sale as any).order
          ? <><div>Sales order {(sale as any).order.order_number}</div>{(sale as any).order.client_po_number && <div>Client PO {(sale as any).order.client_po_number}</div>}</>
          : <div>Counter sale {sale.sale_number}</div>}</div>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">Qty</th><th className="py-1">Unit</th><th className="py-1">Description</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{(items ?? []).map((i: any) => <tr key={i.id} className="border-b"><td className="py-1">{Number(i.quantity)}</td><td className="py-1">{i.unit}</td><td className="py-1">{i.description}<div className="text-xs">{i.item_code}{i.lot_code ? ` · Lot ${i.lot_code}` : ''}</div></td><td className="py-1 text-right">{peso(i.unit_price)}</td><td className="py-1 text-right">{peso(i.line_total)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4} className="pt-2 text-right font-semibold">Total</td><td className="pt-2 text-right font-semibold">{peso(sale.total)}</td></tr>
          {sale.vat_applied && <tr><td colSpan={4} className="text-right text-xs">VAT-inclusive: VATable sales {peso(Number(sale.total) - Number(sale.vat_amount))} · VAT 12% {peso(sale.vat_amount)}</td><td /></tr>}
          {Number(sale.balance) > 0 && <tr><td colSpan={4} className="text-right">Paid / Balance (charge)</td><td className="text-right">{peso(sale.amount_paid)} / {peso(sale.balance)}</td></tr>}</tfoot>
      </table>
      <div data-pdf-block className="mt-12 grid grid-cols-2 gap-12 text-center text-xs">
        <div className="border-t border-black pt-1">Released by</div>
        <div className="border-t border-black pt-1">Received the above items in good order and condition</div>
      </div>
      <DocumentActions documentNumber={sale.dr_number} className="mt-8" />
    </div>
  );
}
