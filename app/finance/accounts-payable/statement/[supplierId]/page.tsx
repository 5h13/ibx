// Build 81 (AP-01) — Supplier statement, to check against the supplier's own
// statement. Opened from Accounts Payable. Build 85: for a period (default this
// year) — opening balance, every purchase (supplier SI / DR, our PO) with its
// status, every payment, running and closing balance; open payables, aging and
// checks issued but not yet posted.
import { notFound } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { DocumentHeader, DocumentPrintStyles, DOCUMENT_BUSINESS_COLUMNS, DOCUMENT_PAGE_CLASS } from '@/shared/documents';
import { DocumentActions } from '@/shared/documents/DocumentActions';
import { pesoDoc as peso, requireAnySection } from '@/shared/documents/access';
import { StatementPeriod } from '@/shared/documents/StatementPeriod';

export const dynamic = 'force-dynamic';

const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function SupplierStatementPage(props: { params: Promise<{ supplierId: string }>; searchParams?: Promise<{ from?: string; to?: string }> }) {
  const params = await props.params;
  const sp = (await props.searchParams) ?? {};
  await requireAnySection(['finance']);
  const db = createClient();
  const profile = await getSessionProfile();
  const [{ data: st, error }, { data: biz }] = await Promise.all([
    db.rpc('supplier_statement', { p_supplier: params.supplierId, p_from: isDate(sp.from), p_to: isDate(sp.to) }),
    db.from('businesses').select(DOCUMENT_BUSINESS_COLUMNS).eq('id', profile?.user.business_id ?? '').maybeSingle(),
  ]);
  if (error || !st) notFound();
  const s: any = st;const sup = s.supplier;const a = s.aging;
  const docNo = `SUPSTMT-${sup.code}-${s.from}-to-${s.to}`;
  const lines: any[] = s.lines ?? [];
  return (
    <div data-document className={`${DOCUMENT_PAGE_CLASS} mx-auto max-w-3xl p-8 text-sm text-black print:p-0`} style={{ background: '#fff' }}>
      <DocumentPrintStyles />
      <DocumentHeader business={biz as any}>
        <div className="text-xl font-bold">SUPPLIER STATEMENT</div><div>{s.from} to {s.to}</div>
      </DocumentHeader>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Supplier</div><div className="font-semibold">{sup.name}</div>{sup.address && <div>{sup.address}</div>}{sup.phone && <div>{sup.phone}</div>}{sup.tax_id && <div>TIN {sup.tax_id}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Supplier code</div><div>{sup.code}</div></div>
      </div>
      <StatementPeriod from={s.from} to={s.to} />
      <div className="mb-2 font-semibold">Transactions {s.from} to {s.to}</div>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">Date</th><th className="py-1">Supplier DR</th><th className="py-1">Supplier SI</th><th className="py-1">Our PO</th><th className="py-1">Particulars</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Balance</th><th className="py-1">Status</th></tr></thead>
        <tbody>
          <tr className="border-b"><td className="py-1">{s.from}</td><td colSpan={4} className="py-1 font-medium">Balance brought forward</td><td /><td /><td className="py-1 text-right font-medium">{peso(s.opening)}</td><td /></tr>
          {lines.length === 0 && <tr><td colSpan={9} className="py-2">No transactions in this period.</td></tr>}
          {lines.map((l, n) => <tr key={n} className="border-b"><td className="py-1">{l.d}</td><td className="py-1">{l.dr ?? '—'}</td><td className="py-1">{l.si ?? '—'}</td><td className="py-1">{l.po ?? '—'}</td><td className="py-1">{l.particulars}</td><td className="py-1 text-right">{Number(l.charge) > 0 ? peso(l.charge) : ''}</td><td className="py-1 text-right">{Number(l.paid) > 0 ? peso(l.paid) : ''}</td><td className="py-1 text-right">{peso(l.balance)}</td><td className="py-1">{l.status ?? ''}</td></tr>)}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black"><td colSpan={5} className="pt-2 text-right font-semibold">Totals for the period</td><td className="pt-2 text-right font-semibold">{peso(s.charges)}</td><td className="pt-2 text-right font-semibold">{peso(s.payments_total)}</td><td /><td /></tr>
          <tr><td colSpan={7} className="pt-1 text-right font-semibold">Balance as of {s.to}</td><td className="pt-1 text-right font-semibold">{peso(s.closing)}</td><td /></tr>
        </tfoot>
      </table>
      <div className="mb-2 mt-6 font-semibold">Open payables as of {s.as_of}</div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">Supplier SI</th><th className="py-1">Supplier DR</th><th className="py-1">Our PO</th><th className="py-1">Date</th><th className="py-1">Due</th><th className="py-1 text-right">Amount</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Balance</th><th className="py-1 text-right">Days overdue</th></tr></thead>
        <tbody>
          {(s.invoices ?? []).length === 0 && <tr><td colSpan={9} className="py-2">Nothing owed to this supplier.</td></tr>}
          {(s.invoices ?? []).map((i: any, n: number) => <tr key={n} className="border-b"><td className="py-1">{i.si ?? 'none'}</td><td className="py-1">{i.dr ?? '—'}</td><td className="py-1">{i.po ?? '—'}</td><td className="py-1">{i.date}</td><td className="py-1">{i.due ?? '—'}</td><td className="py-1 text-right">{peso(i.total)}</td><td className="py-1 text-right">{peso(i.paid)}</td><td className="py-1 text-right">{peso(i.balance)}</td><td className="py-1 text-right">{Number(i.days_overdue) > 0 ? i.days_overdue : '—'}</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={7} className="pt-2 text-right font-semibold">Total owed</td><td className="pt-2 text-right font-semibold">{peso(a.total)}</td><td /></tr></tfoot>
      </table>
      <table data-pdf-block className="mt-4 w-full border-collapse text-center text-xs">
        <thead><tr className="border-b border-black"><th className="py-1">Not yet due</th><th className="py-1">1–30 days</th><th className="py-1">31–60 days</th><th className="py-1">61–90 days</th><th className="py-1">Over 90 days</th></tr></thead>
        <tbody><tr><td className="py-1">{peso(a.current)}</td><td className="py-1">{peso(a.d1_30)}</td><td className="py-1">{peso(a.d31_60)}</td><td className="py-1">{peso(a.d61_90)}</td><td className="py-1">{peso(a.d90)}</td></tr></tbody>
      </table>
      {(s.pending ?? []).length > 0 && <>
        <div className="mb-2 mt-6 font-semibold">Checks / transfers recorded but not yet cleared (not counted as paid above)</div>
        <table className="w-full border-collapse text-xs">
          <thead><tr className="border-b border-black text-left"><th className="py-1">Check date</th><th className="py-1">Payment</th><th className="py-1">For</th><th className="py-1">Method</th><th className="py-1 text-right">Amount</th></tr></thead>
          <tbody>{(s.pending ?? []).map((p: any) => <tr key={p.number} className="border-b"><td className="py-1">{p.date}</td><td className="py-1">{p.number}</td><td className="py-1">{p.against ?? '—'}</td><td className="py-1">{p.method}{p.reference ? ` · ${p.reference}` : ''}</td><td className="py-1 text-right">{peso(p.amount)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4} className="pt-1 text-right font-semibold">Total pending</td><td className="pt-1 text-right font-semibold">{peso((s.pending ?? []).reduce((t: number, p: any) => t + Number(p.amount), 0))}</td></tr></tfoot>
        </table>
      </>}
      <DocumentActions documentNumber={docNo} className="mt-8" />
    </div>
  );
}
