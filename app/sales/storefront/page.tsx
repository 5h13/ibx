// Build 67 — Storefront / Counter Sales (DOC-15). Build 68 adds the day's
// counter payments of every kind, returns and daily closings.
// Build 74: search across dates (SF-19), cancellation requests (SF-17),
// checks (SF-27), orders to deliver (SF-01), read-only for Finance (SF-20).
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { StorefrontManagement } from '@/modules/sales/storefront/StorefrontManagement';

export const dynamic = 'force-dynamic';

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export default async function StorefrontPage({ searchParams }: { searchParams?: { date?: string; tab?: string; q?: string } }) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const sales = hasSectionAccess(profile, 'sales');
  if (!sales && !hasSectionAccess(profile, 'finance')) redirect('/dashboard');
  const db = createClient();
  const { data: ctx, error: ce } = await db.rpc(sales ? 'storefront_context' : 'storefront_view_context');
  if (ce || !ctx) {
    return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">{ce?.message ?? 'Storefront is not available.'}</div></AuthedShell>;
  }
  await db.rpc('storefront_check_reminders');   // SF-27: post-dated checks that became due (each reminds once)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date ?? '') ? searchParams!.date! : manilaToday();
  const search = (searchParams?.q ?? '').trim().slice(0, 60);
  const saleCols = 'id,sale_number,sale_date,status,customer_id,dr_number,si_number,subtotal,discount_total,total,amount_paid,balance,below_floor,notes,created_at,created_by,vat_applied,vat_amount,'
    + 'late_entry,late_reason,approval_reasons,sales_order_id,release_status,cancel_status,cancel_reason,cancel_requested_by,customer:finance_customers(legal_name,customer_code),order:sales_orders(order_number)';
  let register = db.from('storefront_sales').select(saleCols).in('status', ['completed', 'cancelled']);
  if (search) {
    // any date: sale / DR / SI number or customer name
    const term = search.replace(/[%_,()*.]/g, ' ').trim();
    const { data: cust } = await db.from('finance_customers').select('id').ilike('legal_name', `%${term}%`).limit(200);
    const like = `*${term}*`;
    const ids = (cust ?? []).map((c: any) => c.id);
    register = register.or([`sale_number.ilike.${like}`, `dr_number.ilike.${like}`, `si_number.ilike.${like}`, ...(ids.length ? [`customer_id.in.(${ids.join(',')})`] : [])].join(','))
      .order('created_at', { ascending: false }).limit(100);
  } else {
    register = register.eq('sale_date', date).order('created_at', { ascending: false }).limit(500);
  }
  const [{ data: saleRows, error: se }, { data: open, error: oe }, { data: customers, error: cue }, { data: cancelRequests, error: cre }] = await Promise.all([
    register,
    db.from('storefront_sales').select(saleCols).in('status', ['pending_approval', 'approved']).order('created_at', { ascending: false }).limit(200),
    db.from('finance_customers').select('id,customer_code,legal_name,phone').eq('active', true).order('legal_name').limit(2000),
    db.from('storefront_sales').select(saleCols).eq('cancel_status', 'requested').order('cancel_requested_at', { ascending: false }).limit(100),
  ]);
  const err = se || oe || cue || cre;
  if (err) throw new Error(err.message);
  // the Manila calendar day of `date`, for payments (received_at is a timestamp)
  const dayStart = new Date(`${date}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86400000).toISOString();
  const [{ data: dayPayments, error: dpe }, { data: returns, error: re }, { data: closings, error: cle }, { data: checks, error: cke }] = await Promise.all([
    db.from('storefront_payments').select('*').gte('received_at', dayStart).lt('received_at', dayEnd).order('received_at', { ascending: false }).limit(2000),
    db.from('storefront_returns').select('*,sale:storefront_sales!storefront_returns_sale_id_fkey(sale_number,customer:finance_customers(legal_name))').eq('return_date', date).order('created_at', { ascending: false }).limit(500),
    db.from('storefront_closings').select('*').order('closing_date', { ascending: false }).order('submitted_at', { ascending: false }).limit(60),
    db.from('storefront_checks').select('*,customer:finance_customers(legal_name),payment:storefront_payments(payment_number)').order('check_date', { ascending: true }).limit(300),
  ]);
  // Build 70: the day's drawer entries (opening float, cash taken out)
  const { data: dayCash, error: dce } = await db.from('storefront_cash_movements').select('*').eq('movement_date', date).order('created_at');
  if (dce) throw new Error(dce.message);
  // Build 71: journal sent to Finance for each approved closing
  const { data: journals } = await db.rpc('storefront_closing_journals');
  const jmap = new Map(((journals ?? []) as any[]).map((j) => [j.closing_id, j]));
  const closingsWithJournal = (closings ?? []).map((c: any) => ({ ...c, journal_number: jmap.get(c.id)?.journal_number ?? null, journal_status: jmap.get(c.id)?.journal_status ?? null }));
  const err2 = dpe || re || cle || cke;
  if (err2) throw new Error(err2.message);
  // Build 74: sales orders to deliver (SF-01)
  const { data: orders } = await db.rpc('storefront_orders', { p_include_done: false });
  const allSales = [...(saleRows ?? []), ...(open ?? []), ...(cancelRequests ?? [])] as any[];
  const ids = Array.from(new Set(allSales.map((s) => s.id)));
  const [{ data: items }, { data: payments }] = ids.length
    ? await Promise.all([
        db.from('storefront_sale_items').select('*').in('sale_id', ids),
        db.from('storefront_payments').select('*').in('sale_id', ids),
      ])
    : [{ data: [] }, { data: [] }];
  const itemIds = ((items ?? []) as any[]).map((i) => i.id);
  const { data: returnItems } = itemIds.length ? await db.from('storefront_return_items').select('sale_item_id,quantity,condition').in('sale_item_id', itemIds) : { data: [] };
  const { data: locations } = (ctx as any).can_setup
    ? await db.from('logistics_locations').select('id,location_code,location_name').eq('active', true).order('location_code')
    : { data: [] };
  return (
    <AuthedShell profile={profile}>
      <StorefrontManagement ctx={ctx as any} date={date} sales={saleRows ?? []} open={open ?? []} items={items ?? []} payments={payments ?? []}
        customers={(customers ?? []) as any} locations={locations ?? []} initialTab={searchParams?.tab}
        dayPayments={dayPayments ?? []} returns={returns ?? []} closings={closingsWithJournal} today={manilaToday()}
        dayCash={dayCash ?? []} me={profile.user.id} cancelRequests={cancelRequests ?? []} returnItems={returnItems ?? []}
        checks={checks ?? []} orders={(orders ?? []) as any} search={search} />
    </AuthedShell>
  );
}
