// Build 75 — Collection / acknowledgment receipt for money received at the
// counter (sale payments, old-invoice and COD collections, checks). Not an
// official receipt: the BIR SI booklet stays the official document.
import { notFound } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';
import { pesoDoc as peso, requireAnySection } from '@/shared/documents/access';

export const dynamic = 'force-dynamic';
const METHOD: Record<string, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', check: 'Check' };

export default async function CollectionReceiptPage({ params }: { params: { id: string } }) {
  await requireAnySection(['sales', 'finance']);
  const db = createClient();
  const { data: pay } = await db.from('storefront_payments').select('business_id').eq('id', params.id).maybeSingle();
  if (!pay) notFound();
  const [{ data: r, error }, { data: biz }] = await Promise.all([
    db.rpc('storefront_payment_receipt', { p_payment: params.id }),
    db.from('businesses').select(DOCUMENT_BUSINESS_COLUMNS).eq('id', pay.business_id).maybeSingle(),
  ]);
  if (error || !r) notFound();
  const rc: any = r;
  const total = (rc.lines ?? []).reduce((s: number, l: any) => s + Number(l.amount), 0);
  const change = (rc.lines ?? []).reduce((s: number, l: any) => s + Number(l.change ?? 0), 0);
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      <DocumentHeader business={biz as any}>
        <div className="text-xl font-bold">ACKNOWLEDGMENT RECEIPT</div><div className="font-mono">{rc.number}</div>
        <div>Date: {String(rc.date).slice(0, 10)} {String(rc.date).slice(11, 16)}</div>
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Received from</div><div className="font-semibold">{rc.customer?.name}</div>{rc.customer?.address && <div>{rc.customer.address}</div>}{rc.customer?.phone && <div>{rc.customer.phone}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Payment for</div><div>{rc.for}</div>{rc.kind === 'ar_collection' && <div className="text-xs">Collection on account</div>}</div>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">Method</th><th className="py-1">Details</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{(rc.lines ?? []).map((l: any) => (
          <tr key={l.number} className="border-b align-top">
            <td className="py-1">{METHOD[l.method] ?? l.method}</td>
            <td className="py-1 text-xs">{l.method === 'check'
              ? <>Check no. {l.reference} · {l.check_bank} · dated {l.check_date}{l.check_date > String(rc.date).slice(0, 10) ? ' (post-dated)' : ''}<div>Subject to clearing.</div></>
              : l.reference ? <>Ref. {l.reference}</> : null}
              {l.tendered != null && <div>Tendered {peso(l.tendered)} · change {peso(l.change)}</div>}</td>
            <td className="py-1 text-right">{peso(l.amount)}</td>
          </tr>))}</tbody>
        <tfoot>
          <tr><td colSpan={2} className="pt-2 text-right font-semibold">Total received</td><td className="pt-2 text-right font-semibold">{peso(total)}</td></tr>
          {change > 0 && <tr><td colSpan={2} className="text-right text-xs">Change given</td><td className="text-right text-xs">{peso(change)}</td></tr>}
          {rc.balance_after != null && <tr><td colSpan={2} className="text-right">Remaining balance on the invoice</td><td className="text-right">{peso(rc.balance_after)}</td></tr>}
        </tfoot>
      </table>
      <p className="mt-4 text-xs">This acknowledgment receipt is not an official receipt. {''}The official sales invoice is issued from the BIR-registered booklet.</p>
      <div data-pdf-block className="mt-12 grid grid-cols-2 gap-12 text-center text-xs">
        <div className="border-t border-black pt-1">Received by{rc.received_by ? `: ${rc.received_by}` : ''}</div>
        <div className="border-t border-black pt-1">Customer</div>
      </div>
      <DocumentActions documentNumber={rc.number} className="mt-8" />
    </div>
  );
}
