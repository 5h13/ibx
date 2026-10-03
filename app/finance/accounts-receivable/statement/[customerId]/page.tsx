// Build 75 — Statement of account: a customer's open invoices, aging and recent
// payments, for collection. Opened from the Storefront (Receive AR payment) and
// from Accounts Receivable.
import { notFound } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';
import { pesoDoc as peso, requireAnySection } from '@/shared/documents/access';

export const dynamic = 'force-dynamic';
const METHOD: Record<string, string> = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', card: 'Card', bank_transfer: 'Bank transfer', check: 'Check' };

export default async function StatementPage(props: { params: Promise<{ customerId: string }> }) {
  const params = await props.params;
  await requireAnySection(['sales', 'finance']);
  const db = createClient();
  const { data: cust } = await db.from('finance_customers').select('business_id,customer_code').eq('id', params.customerId).maybeSingle();
  if (!cust) notFound();
  const [{ data: st, error }, { data: biz }] = await Promise.all([
    db.rpc('customer_statement', { p_customer: params.customerId }),
    db.from('businesses').select(DOCUMENT_BUSINESS_COLUMNS).eq('id', cust.business_id).maybeSingle(),
  ]);
  if (error || !st) notFound();
  const s: any = st;const c = s.customer;const a = s.aging;
  const docNo = `SOA-${c.code}-${s.as_of}`;
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      <DocumentHeader business={biz as any}>
        <div className="text-xl font-bold">STATEMENT OF ACCOUNT</div><div>As of {s.as_of}</div>
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Customer</div><div className="font-semibold">{c.name}</div>{c.address && <div>{c.address}</div>}{c.phone && <div>{c.phone}</div>}{c.tax_id && <div>TIN {c.tax_id}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Account</div><div>{c.code}</div>{c.payment_terms && <div>Terms: {c.payment_terms}</div>}{Number(c.credit_limit) > 0 && <div>Credit limit: {peso(c.credit_limit)}</div>}</div>
      </div>
      <div className="mb-2 font-semibold">Open invoices</div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">DR no.</th><th className="py-1">SI no.</th><th className="py-1">Date</th><th className="py-1">Due</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Balance</th><th className="py-1 text-right">Days overdue</th></tr></thead>
        <tbody>
          {(s.invoices ?? []).length === 0 && <tr><td colSpan={8} className="py-2">No open invoices — thank you.</td></tr>}
          {(s.invoices ?? []).map((i: any) => <tr key={i.number} className="border-b"><td className="py-1">{i.linked ? (i.dr ?? '—') : i.number}</td><td className="py-1">{i.linked ? (i.si ?? 'none') : '—'}</td><td className="py-1">{i.date}</td><td className="py-1">{i.due ?? '—'}</td><td className="py-1 text-right">{peso(i.total)}</td><td className="py-1 text-right">{peso(i.received)}</td><td className="py-1 text-right">{peso(i.balance)}</td><td className="py-1 text-right">{Number(i.days_overdue) > 0 ? i.days_overdue : '—'}</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={6} className="pt-2 text-right font-semibold">Total amount due</td><td className="pt-2 text-right font-semibold">{peso(a.total)}</td><td /></tr></tfoot>
      </table>
      <table data-pdf-block className="mt-4 w-full border-collapse text-center text-xs">
        <thead><tr className="border-b border-black"><th className="py-1">Not yet due</th><th className="py-1">1–30 days</th><th className="py-1">31–60 days</th><th className="py-1">61–90 days</th><th className="py-1">Over 90 days</th></tr></thead>
        <tbody><tr><td className="py-1">{peso(a.current)}</td><td className="py-1">{peso(a.d1_30)}</td><td className="py-1">{peso(a.d31_60)}</td><td className="py-1">{peso(a.d61_90)}</td><td className="py-1">{peso(a.d90)}</td></tr></tbody>
      </table>
      {(s.payments ?? []).length > 0 && <>
        <div className="mb-2 mt-6 font-semibold">Payments received (last 90 days)</div>
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-black text-left"><th className="py-1">Date</th><th className="py-1">Receipt</th><th className="py-1">Invoice</th><th className="py-1">Method</th><th className="py-1 text-right">Amount</th></tr></thead>
          <tbody>{(s.payments ?? []).map((p: any) => <tr key={p.number} className="border-b"><td className="py-1">{p.date}</td><td className="py-1">{p.number}</td><td className="py-1">{p.invoice}</td><td className="py-1">{METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</td><td className="py-1 text-right">{peso(p.amount)}</td></tr>)}</tbody>
        </table>
      </>}
      <p className="mt-6 text-xs">Please settle the amount due on or before each due date. If you have already paid, kindly disregard this statement and send us the payment details.</p>
      <DocumentActions documentNumber={docNo} className="mt-8" />
    </div>
  );
}
