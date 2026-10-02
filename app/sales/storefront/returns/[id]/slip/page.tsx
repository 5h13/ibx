// Build 75 — Return / credit slip for goods a customer returned.
import { notFound } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';
import { pesoDoc as peso, requireAnySection } from '@/shared/documents/access';

export const dynamic = 'force-dynamic';
const CONDITION: Record<string, string> = { back_to_stock: 'Back to stock', damaged: 'Damaged', wrong_item: 'Wrong item' };
const METHOD: Record<string, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer' };

export default async function ReturnSlipPage({ params }: { params: { id: string } }) {
  await requireAnySection(['sales', 'finance']);
  const db = createClient();
  const { data: ret } = await db.from('storefront_returns')
    .select(`*,sale:storefront_sales!storefront_returns_sale_id_fkey(sale_number,dr_number,si_number,sale_date,customer:finance_customers(legal_name,address,phone)),business:businesses!storefront_returns_business_id_fkey(${DOCUMENT_BUSINESS_COLUMNS})`)
    .eq('id', params.id).maybeSingle();
  if (!ret) notFound();
  const [{ data: items }, { data: refunds }] = await Promise.all([
    db.from('storefront_return_items').select('quantity,unit_price,line_total,condition,sale_item:storefront_sale_items(description,unit,item_code)').eq('return_id', ret.id),
    db.from('storefront_payments').select('payment_number,method,amount,reference_number').eq('return_id', ret.id).eq('kind', 'refund'),
  ]);
  const sale: any = ret.sale; const cust: any = sale?.customer;
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      <DocumentHeader business={ret.business as any}>
        <div className="text-xl font-bold">RETURN / CREDIT SLIP</div><div className="font-mono">{ret.return_number}</div><div>Date: {ret.return_date}</div>
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Customer</div><div className="font-semibold">{cust?.legal_name}</div>{cust?.address && <div>{cust.address}</div>}{cust?.phone && <div>{cust.phone}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Original sale</div><div>{sale?.dr_number ? `DR ${sale.dr_number}` : `Sale ${sale?.sale_number}`}</div>{sale?.si_number && <div>SI {sale.si_number}</div>}<div>{sale?.sale_date}</div></div>
      </div>
      <p className="mb-3">Reason: {ret.reason}</p>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">Qty</th><th className="py-1">Unit</th><th className="py-1">Description</th><th className="py-1">Condition</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{(items ?? []).map((i: any, n: number) => <tr key={n} className="border-b"><td className="py-1">{Number(i.quantity)}</td><td className="py-1">{i.sale_item?.unit}</td><td className="py-1">{i.sale_item?.description}<div className="text-xs">{i.sale_item?.item_code}</div></td><td className="py-1">{CONDITION[i.condition] ?? i.condition}</td><td className="py-1 text-right">{peso(i.unit_price)}</td><td className="py-1 text-right">{peso(i.line_total)}</td></tr>)}</tbody>
        <tfoot>
          <tr><td colSpan={5} className="pt-2 text-right font-semibold">Value returned</td><td className="pt-2 text-right font-semibold">{peso(ret.total)}</td></tr>
          {Number(ret.credit_to_ar) > 0 && <tr><td colSpan={5} className="text-right">Credited against the unpaid balance</td><td className="text-right">{peso(ret.credit_to_ar)}</td></tr>}
          {Number(ret.refund_total) > 0 && <tr><td colSpan={5} className="text-right">Refunded</td><td className="text-right">{peso(ret.refund_total)}</td></tr>}
        </tfoot>
      </table>
      {(refunds ?? []).length > 0 && <p className="mt-3 text-xs">Refund given by: {(refunds ?? []).map((r: any) => `${METHOD[r.method] ?? r.method} ${peso(r.amount)}${r.reference_number ? ` (${r.reference_number})` : ''}`).join(', ')}</p>}
      <div data-pdf-block className="mt-12 grid grid-cols-2 gap-12 text-center text-xs">
        <div className="border-t border-black pt-1">Received back by</div>
        <div className="border-t border-black pt-1">Customer</div>
      </div>
      <DocumentActions documentNumber={ret.return_number} className="mt-8" />
    </div>
  );
}
