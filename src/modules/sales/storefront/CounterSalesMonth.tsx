// Build 73 (SF-24b): counter (Storefront) sales for the month, day by day,
// with where each day stands: open → closed (waiting for approval) →
// approved (journal sent to Finance) → posted by Finance.
import { createClient } from '@/core/auth/supabaseServer';

const peso = (n: number) => n.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' });

export async function CounterSalesMonth({ year, month }: { year: number; month: number }) {
  const supabase = createClient();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const [sales, returns, closings] = await Promise.all([
    supabase.from('storefront_sales').select('sale_date, total').eq('status', 'completed').gte('sale_date', from).lte('sale_date', to),
    supabase.from('storefront_returns').select('return_date, total').gte('return_date', from).lte('return_date', to),
    supabase.from('storefront_closings').select('closing_date, closing_number, status, posted_at, journal:finance_journal_entries!storefront_closings_journal_entry_id_fkey(status)')
      .neq('status', 'returned').gte('closing_date', from).lte('closing_date', to),
  ]);
  if (sales.error) return null; // no Storefront access: the section is simply not shown

  const days = new Map<string, { n: number; sales: number; ret: number }>();
  for (const s of sales.data ?? []) {
    const d = days.get(s.sale_date) ?? { n: 0, sales: 0, ret: 0 };
    d.n += 1; d.sales += Number(s.total); days.set(s.sale_date, d);
  }
  for (const r of returns.data ?? []) {
    const d = days.get(r.return_date) ?? { n: 0, sales: 0, ret: 0 };
    d.ret += Number(r.total); days.set(r.return_date, d);
  }
  const closingByDay = new Map((closings.data ?? []).map((c: any) => [c.closing_date as string, c]));
  const rows = Array.from(days.entries()).sort(([a], [b]) => b.localeCompare(a));
  const tot = rows.reduce((a, [, d]) => ({ n: a.n + d.n, sales: a.sales + d.sales, ret: a.ret + d.ret }), { n: 0, sales: 0, ret: 0 });
  const posted = rows.reduce((a, [day, d]) => {
    const j = (closingByDay.get(day) as any)?.journal;
    const js = Array.isArray(j) ? j[0]?.status : j?.status;
    return js === 'posted' ? a + d.sales - d.ret : a;
  }, 0);

  const stage = (day: string) => {
    const c: any = closingByDay.get(day);
    if (!c) return <span className="text-amber-700">Open — not closed yet</span>;
    if (c.status === 'submitted') return <span className="text-amber-700">Closed {c.closing_number}, waiting for approval</span>;
    const j = Array.isArray(c.journal) ? c.journal[0] : c.journal;
    if (j?.status === 'posted') return <span className="text-green-700">Posted by Finance</span>;
    return <span className="text-sky-700">Approved — with Finance for posting</span>;
  };

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-slate-900">Counter sales (Storefront)</h3>
      <p className="text-xs text-slate-500 mb-3">
        Every completed counter sale this month. A day reaches the Dashboard&apos;s Finance-approved figures once its closing is approved and Finance posts the journal.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
        {[
          ['Counter sales', peso(tot.sales), `${tot.n} sale${tot.n === 1 ? '' : 's'}`],
          ['Returns', peso(tot.ret), ''],
          ['Net', peso(tot.sales - tot.ret), ''],
          ['Posted by Finance', peso(posted), 'Net of the posted days'],
        ].map(([l, v, h]) => (
          <div key={l} className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500">{l}</p>
            <p className="text-xl font-bold text-slate-900">{v}</p>
            {h && <p className="text-[11px] text-slate-400">{h}</p>}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto bg-white rounded-lg shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b">
              <th className="p-2">Date</th><th className="p-2 text-right">Sales</th><th className="p-2 text-right">Amount</th>
              <th className="p-2 text-right">Returns</th><th className="p-2 text-right">Net</th><th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([day, d]) => (
              <tr key={day} className="border-b last:border-0">
                <td className="p-2">{new Date(day + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', weekday: 'short' })}</td>
                <td className="p-2 text-right">{d.n}</td><td className="p-2 text-right">{peso(d.sales)}</td>
                <td className="p-2 text-right">{peso(d.ret)}</td><td className="p-2 text-right">{peso(d.sales - d.ret)}</td>
                <td className="p-2 text-xs">{stage(day)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 text-slate-400" colSpan={6}>No counter sales this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
