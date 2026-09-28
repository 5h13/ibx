// app/dashboard/page.tsx
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { isSuperAdmin } from '@/core/auth/types';

// Build plan section 4: staff-level minimum visibility is exactly these
// four figures — total sales, total expense, running bottomline, own
// commission. Detail views live in the module pages, gated by RLS.
//
// U002 fix: financial_summary and months became business-scoped under A001
// (one row per business per month), so the original single `.maybeSingle()`
// query below would throw the moment more than one business had a
// company-wide row for the same calendar month, since a Global Super Admin's
// read bypasses business RLS entirely and sees every business's row. A
// Super Admin has no single business of their own, so "the dashboard" for
// them is a consolidated total across every business plus a per-business
// breakdown; a Business Admin/staff member keeps seeing only their own
// business's figures, scoped exactly as before.
export default async function DashboardPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');

  const supabase = createClient();
  const peso = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'PHP' });
  const emptyTotals = { total_sales: 0, total_expenses: 0, bottomline: 0, total_commission: 0 };

  if (isSuperAdmin(profile)) {
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, legal_name, trade_name')
      .eq('is_active', true)
      .order('legal_name');

    const rows = await Promise.all(
      (businesses ?? []).map(async (b) => {
        let monthId: string;
        try {
          monthId = await getCurrentMonthId(b.id);
        } catch {
          // No month period exists yet for this business and none can be
          // auto-created without acting-business write context here —
          // show zeros for this business rather than failing the whole page.
          return { business: b, totals: null as typeof emptyTotals | null };
        }
        const { data: summary } = await supabase
          .from('financial_summary')
          .select('total_sales, total_expenses, bottomline, total_commission')
          .eq('business_id', b.id)
          .is('section_id', null)
          .eq('month_id', monthId)
          .maybeSingle();
        return { business: b, totals: summary ?? emptyTotals };
      })
    );

    const consolidated = rows.reduce((acc, r) => {
      if (!r.totals) return acc;
      return {
        total_sales: acc.total_sales + (r.totals.total_sales ?? 0),
        total_expenses: acc.total_expenses + (r.totals.total_expenses ?? 0),
        bottomline: acc.bottomline + (r.totals.bottomline ?? 0),
        total_commission: acc.total_commission + (r.totals.total_commission ?? 0),
      };
    }, { ...emptyTotals });

    const cards = [
      { label: 'Total Sales', value: consolidated.total_sales },
      { label: 'Total Expense', value: consolidated.total_expenses },
      { label: 'Running Bottomline', value: consolidated.bottomline },
      { label: 'Total Commission', value: consolidated.total_commission },
    ];

    return (
      <AuthedShell profile={profile}>
        <h2 className="text-lg font-semibold mb-4">Dashboard — All Businesses (Consolidated)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-xl font-bold text-slate-900">{peso(c.value)}</p>
            </div>
          ))}
        </div>
        <h3 className="text-sm font-semibold mb-2 text-slate-700">By Business</h3>
        <div className="overflow-x-auto bg-white rounded-lg shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b">
                <th className="p-3">Business</th>
                <th className="p-3">Total Sales</th>
                <th className="p-3">Total Expense</th>
                <th className="p-3">Bottomline</th>
                <th className="p-3">Commission</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ business, totals }) => (
                <tr key={business.id} className="border-b last:border-0">
                  <td className="p-3 font-medium text-slate-900">{business.trade_name || business.legal_name}</td>
                  <td className="p-3">{peso(totals?.total_sales ?? 0)}</td>
                  <td className="p-3">{peso(totals?.total_expenses ?? 0)}</td>
                  <td className="p-3">{peso(totals?.bottomline ?? 0)}</td>
                  <td className="p-3">{peso(totals?.total_commission ?? 0)}</td>
                </tr>
              ))}
              {(rows.length === 0) && (
                <tr><td className="p-3 text-slate-400" colSpan={5}>No active businesses.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-4">
          financial_summary is pre-computed per business — wire a scheduled function or trigger to
          populate it as expenses/sales entries are approved.
        </p>
      </AuthedShell>
    );
  }

  const monthId = await getCurrentMonthId(profile.user.business_id);

  // Company-wide row has section_id = null (see schema.sql financial_summary).
  const { data: summary } = await supabase
    .from('financial_summary')
    .select('total_sales, total_expenses, bottomline, total_commission')
    .eq('business_id', profile.user.business_id ?? '')
    .is('section_id', null)
    .eq('month_id', monthId)
    .maybeSingle();

  const totals = summary ?? emptyTotals;

  const cards = [
    { label: 'Total Sales', value: totals.total_sales },
    { label: 'Total Expense', value: totals.total_expenses },
    { label: 'Running Bottomline', value: totals.bottomline },
    { label: 'Commission', value: totals.total_commission },
  ];

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Dashboard</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-xl font-bold text-slate-900">{peso(c.value)}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-4">
        financial_summary is pre-computed — wire a scheduled function or trigger to populate it as
        expenses/sales entries are approved.
      </p>
    </AuthedShell>
  );
}
