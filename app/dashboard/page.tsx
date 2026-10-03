// app/dashboard/page.tsx
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';

// Build 73 (SF-28): the Dashboard has three layers.
//   1. Today at the counter — running Storefront sales, read live from the
//      counter. Preliminary: no closing or Finance approval needed; today only.
//   2. A month — Finance-approved figures (posted journals only).
//   3. Quarters and the year — Finance-approved figures (posted journals only).
// The database decides which stores the caller sees (dashboard_scope: the
// Super Admin's "Acting as" store, or every store when none is chosen; anyone
// else their own) and hides AR collections, receivables and cash / bank from
// anyone who is not an admin or in Finance.

type Today = {
  business_id: string; business_name: string; sales_count: number; sales_total: number;
  returns_total: number; net_sales: number; collected: number; as_of: string;
};
type Period = {
  business_id: string; business_name: string; sales: number; expenses: number; bottomline: number; commission: number;
  collections: number | null; receivables: number | null; cash_bank: number | null;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const peso = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });

function sumPeriod(rows: Period[]) {
  const s = { sales: 0, expenses: 0, bottomline: 0, commission: 0, collections: 0, receivables: 0, cash_bank: 0 };
  for (const r of rows) {
    s.sales += Number(r.sales); s.expenses += Number(r.expenses); s.bottomline += Number(r.bottomline);
    s.commission += Number(r.commission); s.collections += Number(r.collections ?? 0);
    s.receivables += Number(r.receivables ?? 0); s.cash_bank += Number(r.cash_bank ?? 0);
  }
  return s;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Layer({ n, title, note, children }: { n: number; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] font-semibold text-white bg-slate-700 rounded px-1.5 py-0.5">{n}</span>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">{note}</p>
      {children}
    </section>
  );
}

export default async function DashboardPage(props: { searchParams?: Promise<{ month?: string; year?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const supabase = createClient();

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const [my, mm] = (searchParams?.month ?? '').split('-').map(Number);
  const mYear = my > 2000 && mm >= 1 && mm <= 12 ? my : now.getFullYear();
  const mMonth = my > 2000 && mm >= 1 && mm <= 12 ? mm : now.getMonth() + 1;
  const yParam = Number(searchParams?.year);
  const year = yParam > 2000 && yParam < 2100 ? yParam : now.getFullYear();

  const period = async (from: string, to: string) => {
    const { data, error } = await supabase.rpc('dashboard_period', { p_from: from, p_to: to });
    return { rows: (data ?? []) as Period[], error: error?.message };
  };
  const [todayRes, monthRes, ...qy] = await Promise.all([
    supabase.rpc('dashboard_today'),
    period(iso(mYear, mMonth, 1), iso(mYear, mMonth, lastDay(mYear, mMonth))),
    ...[1, 2, 3, 4].map((q) => period(iso(year, q * 3 - 2, 1), iso(year, q * 3, lastDay(year, q * 3)))),
    period(iso(year, 1, 1), iso(year, 12, 31)),
  ]);
  const today = (todayRes.data ?? []) as Today[];
  const month = monthRes.rows;
  const quarters = qy.slice(0, 4).map((r) => sumPeriod(r.rows));
  const yearTotal = sumPeriod(qy[4].rows);
  const yearByStore = qy[4].rows;
  const seesMoney = month.some((r) => r.collections !== null);
  const multi = today.length > 1 || month.length > 1;
  const t = today.reduce(
    (a, r) => ({ n: a.n + r.sales_count, sales: a.sales + Number(r.sales_total), ret: a.ret + Number(r.returns_total), net: a.net + Number(r.net_sales), col: a.col + Number(r.collected) }),
    { n: 0, sales: 0, ret: 0, net: 0, col: 0 },
  );
  const m = sumPeriod(month);
  const asOf = today[0]?.as_of
    ? new Date(today[0].as_of).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
    : null;
  const err = todayRes.error?.message || monthRes.error;
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const shownMonth = `${mYear}-${String(mMonth).padStart(2, '0')}`;

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-1">Dashboard{multi ? ' — all stores' : today[0] ? ` — ${today[0].business_name}` : ''}</h2>
      <p className="text-xs text-slate-500 mb-5">
        Layer 1 is live from the counter. Layers 2 and 3 show only what Finance has approved and posted.
      </p>
      {err && <p className="mb-4 rounded bg-red-50 text-red-700 text-sm p-3">Could not load the dashboard: {err}</p>}

      <Layer n={1} title="Today at the counter" note={`Preliminary — every completed counter sale today, before the day is closed or Finance approves it.${asOf ? ` As of ${asOf}.` : ''}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Counter sales" value={peso(t.sales)} hint={`${t.n} sale${t.n === 1 ? '' : 's'}`} />
          <Card label="Returns" value={peso(t.ret)} />
          <Card label="Net sales today" value={peso(t.net)} />
          <Card label="Money received" value={peso(t.col)} hint="All payment methods, less refunds" />
        </div>
        {multi && (
          <table className="min-w-full text-sm bg-white rounded-lg shadow-sm mt-3">
            <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="p-2">Store</th><th className="p-2 text-right">Sales</th><th className="p-2 text-right">Returns</th><th className="p-2 text-right">Net</th><th className="p-2 text-right">Received</th></tr></thead>
            <tbody>
              {today.map((r) => (
                <tr key={r.business_id} className="border-b last:border-0">
                  <td className="p-2 font-medium">{r.business_name}</td>
                  <td className="p-2 text-right">{peso(r.sales_total)}</td><td className="p-2 text-right">{peso(r.returns_total)}</td>
                  <td className="p-2 text-right">{peso(r.net_sales)}</td><td className="p-2 text-right">{peso(r.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Layer>

      <Layer n={2} title={`${MONTHS[mMonth - 1]} ${mYear} — Finance approved`} note="From posted journals: counter closings, invoices, bills and other entries Finance has approved and posted.">
        <form className="flex items-center gap-2 mb-3 text-sm" action="/dashboard">
          <label className="text-slate-600" htmlFor="month">Month</label>
          <input id="month" name="month" type="month" defaultValue={shownMonth} className="border rounded px-2 py-1" />
          <input type="hidden" name="year" value={year} />
          <button className="rounded bg-slate-800 text-white px-3 py-1">Show</button>
          {shownMonth !== thisMonth && <a href={`/dashboard?year=${year}`} className="text-slate-500 underline">This month</a>}
        </form>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Sales" value={peso(m.sales)} />
          <Card label="Expenses" value={peso(m.expenses)} hint="Includes cost of goods sold" />
          <Card label="Bottomline" value={peso(m.bottomline)} />
          <Card label={seesMoney ? 'Commission' : 'My commission'} value={peso(m.commission)} />
          {seesMoney && (
            <>
              <Card label="AR collections" value={peso(m.collections)} hint="Posted customer receipts this month" />
              <Card label="Receivables now" value={peso(m.receivables)} hint="Open customer invoices" />
              <Card label="Cash & bank (posted)" value={peso(m.cash_bank)} hint="Balances from posted Bank/Cash entries" />
            </>
          )}
        </div>
        {multi && (
          <table className="min-w-full text-sm bg-white rounded-lg shadow-sm mt-3">
            <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="p-2">Store</th><th className="p-2 text-right">Sales</th><th className="p-2 text-right">Expenses</th><th className="p-2 text-right">Bottomline</th><th className="p-2 text-right">Commission</th>{seesMoney && <th className="p-2 text-right">Receivables</th>}</tr></thead>
            <tbody>
              {month.map((r) => (
                <tr key={r.business_id} className="border-b last:border-0">
                  <td className="p-2 font-medium">{r.business_name}</td>
                  <td className="p-2 text-right">{peso(r.sales)}</td><td className="p-2 text-right">{peso(r.expenses)}</td>
                  <td className="p-2 text-right">{peso(r.bottomline)}</td><td className="p-2 text-right">{peso(r.commission)}</td>
                  {seesMoney && <td className="p-2 text-right">{peso(r.receivables)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Layer>

      <Layer n={3} title={`${year} by quarter — Finance approved`} note="Posted journals only, per quarter and for the whole year.">
        <div className="flex items-center gap-3 mb-3 text-sm">
          <a className="text-slate-600 underline" href={`/dashboard?year=${year - 1}&month=${shownMonth}`}>← {year - 1}</a>
          <span className="font-medium">{year}</span>
          {year < now.getFullYear() && <a className="text-slate-600 underline" href={`/dashboard?year=${year + 1}&month=${shownMonth}`}>{year + 1} →</a>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm bg-white rounded-lg shadow-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b">
                <th className="p-2"></th>
                {['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'].map((q) => <th key={q} className="p-2 text-right">{q}</th>)}
                <th className="p-2 text-right">Year {year}</th>
              </tr>
            </thead>
            <tbody>
              {([['Sales', 'sales'], ['Expenses', 'expenses'], ['Bottomline', 'bottomline'], [seesMoney ? 'Commission' : 'My commission', 'commission'],
                ...(seesMoney ? [['AR collections', 'collections']] : [])] as [string, keyof ReturnType<typeof sumPeriod>][]).map(([label, k]) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="p-2 font-medium">{label}</td>
                  {quarters.map((q, i) => <td key={i} className="p-2 text-right">{peso(q[k])}</td>)}
                  <td className="p-2 text-right font-semibold">{peso(yearTotal[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {multi && (
          <table className="min-w-full text-sm bg-white rounded-lg shadow-sm mt-3">
            <thead><tr className="text-left text-xs text-slate-500 border-b"><th className="p-2">Store — year {year}</th><th className="p-2 text-right">Sales</th><th className="p-2 text-right">Expenses</th><th className="p-2 text-right">Bottomline</th></tr></thead>
            <tbody>
              {yearByStore.map((r) => (
                <tr key={r.business_id} className="border-b last:border-0">
                  <td className="p-2 font-medium">{r.business_name}</td>
                  <td className="p-2 text-right">{peso(r.sales)}</td><td className="p-2 text-right">{peso(r.expenses)}</td><td className="p-2 text-right">{peso(r.bottomline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Layer>
    </AuthedShell>
  );
}
