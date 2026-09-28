// Build 67 — Storefront / Counter Sales (DOC-15). Build 68 adds the day's
// counter payments of every kind, returns and daily closings.
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { StorefrontManagement } from '@/modules/sales/storefront/StorefrontManagement';

export const dynamic = 'force-dynamic';

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export default async function StorefrontPage({ searchParams }: { searchParams?: { date?: string; tab?: string } }) {
  const profile = await requireSection('sales');
  const db = createClient();
  const { data: ctx, error: ce } = await db.rpc('storefront_context');
  if (ce || !ctx) {
    return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">{ce?.message ?? 'Storefront is not available.'}</div></AuthedShell>;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date ?? '') ? searchParams!.date! : manilaToday();
  const saleCols = 'id,sale_number,sale_date,status,customer_id,dr_number,si_number,subtotal,discount_total,total,amount_paid,balance,below_floor,notes,created_at,created_by,vat_applied,vat_amount,customer:finance_customers(legal_name,customer_code)';
  const [{ data: sales, error: se }, { data: open, error: oe }, { data: customers, error: cue }] = await Promise.all([
    db.from('storefront_sales').select(saleCols).eq('sale_date', date).in('status', ['completed', 'cancelled']).order('created_at', { ascending: false }).limit(500),
    db.from('storefront_sales').select(saleCols).in('status', ['pending_approval', 'approved']).order('created_at', { ascending: false }).limit(200),
    db.from('finance_customers').select('id,customer_code,legal_name,phone').eq('active', true).order('legal_name').limit(2000),
  ]);
  const err = se || oe || cue;
  if (err) throw new Error(err.message);
  // the Manila calendar day of `date`, for payments (received_at is a timestamp)
  const dayStart = new Date(`${date}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86400000).toISOString();
  const [{ data: dayPayments, error: dpe }, { data: returns, error: re }, { data: closings, error: cle }] = await Promise.all([
    db.from('storefront_payments').select('*').gte('received_at', dayStart).lt('received_at', dayEnd).order('received_at', { ascending: false }).limit(2000),
    db.from('storefront_returns').select('*,sale:storefront_sales(sale_number,customer:finance_customers(legal_name))').eq('return_date', date).order('created_at', { ascending: false }).limit(500),
    db.from('storefront_closings').select('*').order('closing_date', { ascending: false }).order('submitted_at', { ascending: false }).limit(60),
  ]);
  // Build 70: the day's drawer entries (opening float, cash taken out)
  const { data: dayCash, error: dce } = await db.from('storefront_cash_movements').select('*').eq('movement_date', date).order('created_at');
  if (dce) throw new Error(dce.message);
  // Build 71: journal sent to Finance for each approved closing
  const { data: journals } = await db.rpc('storefront_closing_journals');
  const jmap = new Map(((journals ?? []) as any[]).map((j) => [j.closing_id, j]));
  const closingsWithJournal = (closings ?? []).map((c: any) => ({ ...c, journal_number: jmap.get(c.id)?.journal_number ?? null, journal_status: jmap.get(c.id)?.journal_status ?? null }));
  const err2 = dpe || re || cle;
  if (err2) throw new Error(err2.message);
  const ids = [...(sales ?? []), ...(open ?? [])].map((s: any) => s.id);
  const [{ data: items }, { data: payments }] = ids.length
    ? await Promise.all([
        db.from('storefront_sale_items').select('*').in('sale_id', ids),
        db.from('storefront_payments').select('*').in('sale_id', ids),
      ])
    : [{ data: [] }, { data: [] }];
  const { data: locations } = (ctx as any).can_setup
    ? await db.from('logistics_locations').select('id,location_code,location_name').eq('active', true).order('location_code')
    : { data: [] };
  return (
    <AuthedShell profile={profile}>
      <StorefrontManagement ctx={ctx as any} date={date} sales={sales ?? []} open={open ?? []} items={items ?? []} payments={payments ?? []}
        customers={(customers ?? []) as any} locations={locations ?? []} initialTab={searchParams?.tab}
        dayPayments={dayPayments ?? []} returns={returns ?? []} closings={closingsWithJournal} today={manilaToday()}
        dayCash={dayCash ?? []} me={profile.user.id} />
    </AuthedShell>
  );
}
