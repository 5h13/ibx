// Build 67 — printable Delivery Receipt for a counter sale (DOC-15).
import { notFound } from 'next/navigation';
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { PrintButton } from '@/modules/sales/storefront/PrintButton';

export const dynamic = 'force-dynamic';
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function StorefrontDrPage({ params }: { params: { id: string } }) {
  await requireSection('sales');
  const db = createClient();
  const { data: sale } = await db.from('storefront_sales')
    .select('*,customer:finance_customers(legal_name,address,phone,tax_id),business:businesses!storefront_sales_business_id_fkey(legal_name,trade_name,branding)')
    .eq('id', params.id).maybeSingle();
  if (!sale || !sale.dr_number) notFound();
  const { data: items } = await db.from('storefront_sale_items').select('*').eq('sale_id', sale.id).order('description');
  const biz: any = sale.business; const cust: any = sale.customer;
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {biz?.branding?.logo_url && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={biz.branding.logo_url} alt="" className="h-14 w-14 object-contain" />)}
          <div><div className="text-lg font-bold uppercase">{biz?.trade_name || biz?.legal_name}</div><div className="text-xs">{biz?.legal_name}</div>{biz?.branding?.tagline && <div className="text-xs">{biz.branding.tagline}</div>}</div>
        </div>
        <div className="text-right"><div className="text-xl font-bold">DELIVERY RECEIPT</div><div className="font-mono">{sale.dr_number}</div><div>Date: {sale.sale_date}</div>{sale.si_number && <div>SI No.: {sale.si_number}</div>}</div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 border-y py-3">
        <div><div className="text-xs uppercase">Delivered to</div><div className="font-semibold">{cust?.legal_name}</div>{cust?.address && <div>{cust.address}</div>}{cust?.phone && <div>{cust.phone}</div>}{cust?.tax_id && <div>TIN {cust.tax_id}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase">Reference</div><div>Counter sale {sale.sale_number}</div></div>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1">Qty</th><th className="py-1">Unit</th><th className="py-1">Description</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
        <tbody>{(items ?? []).map((i: any) => <tr key={i.id} className="border-b"><td className="py-1">{Number(i.quantity)}</td><td className="py-1">{i.unit}</td><td className="py-1">{i.description}<div className="text-xs">{i.item_code}</div></td><td className="py-1 text-right">{peso(i.unit_price)}</td><td className="py-1 text-right">{peso(i.line_total)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4} className="pt-2 text-right font-semibold">Total</td><td className="pt-2 text-right font-semibold">{peso(sale.total)}</td></tr>
          {Number(sale.balance) > 0 && <tr><td colSpan={4} className="text-right">Paid / Balance (charge)</td><td className="text-right">{peso(sale.amount_paid)} / {peso(sale.balance)}</td></tr>}</tfoot>
      </table>
      <div className="mt-12 grid grid-cols-2 gap-12 text-center text-xs">
        <div className="border-t border-black pt-1">Released by</div>
        <div className="border-t border-black pt-1">Received the above items in good order and condition</div>
      </div>
      <div className="mt-8 print:hidden"><PrintButton /></div>
    </div>
  );
}
