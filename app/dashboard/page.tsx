// app/dashboard/page.tsx
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { getCurrentMonthId } from '@/core/utils/currentMonth';

// Build plan section 4: staff-level minimum visibility is exactly these
// four figures — total sales, total expense, running bottomline, own
// commission. Detail views live in the module pages, gated by RLS.
export default async function DashboardPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');

  const monthId = await getCurrentMonthId();
  const supabase = createClient();

  // Company-wide row has section_id = null (see schema.sql financial_summary).
  const { data: summary } = await supabase
    .from('financial_summary')
    .select('total_sales, total_expenses, bottomline, total_commission')
    .is('section_id', null)
    .eq('month_id', monthId)
    .maybeSingle();

  const totals = summary ?? { total_sales: 0, total_expenses: 0, bottomline: 0, total_commission: 0 };
  const peso = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'PHP' });

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
