// app/approvals/page.tsx
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { StatusBadge } from '@/core/utils/statusBadge';

// Cross-section "things waiting on me" queue. RLS already restricts what
// comes back to sections/rows this user can act on, so this is a plain
// read — no extra filtering logic needed here.
export default async function ApprovalsPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');

  const supabase = createClient();

  const [{ data: pendingExpenses }, { data: pendingSales }] = await Promise.all([
    supabase.from('expenses').select('id, description, amount, status, section_id').in('status', ['prepared', 'reviewed']),
    supabase.from('sales_data').select('id, agent_name, net_sales, status, section_id').in('status', ['prepared', 'reviewed']),
  ]);

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Approvals</h2>

      <h3 className="text-sm font-semibold text-slate-500 mb-2">Expenses</h3>
      <ul className="mb-6 divide-y divide-slate-100 bg-white rounded shadow-sm">
        {(pendingExpenses ?? []).map((e) => (
          <li key={e.id} className="px-4 py-2 flex justify-between text-sm">
            <span>{e.description}</span>
            <StatusBadge status={e.status} />
          </li>
        ))}
        {(pendingExpenses ?? []).length === 0 && (
          <li className="px-4 py-4 text-center text-slate-400 text-sm">Nothing pending.</li>
        )}
      </ul>

      <h3 className="text-sm font-semibold text-slate-500 mb-2">Sales</h3>
      <ul className="divide-y divide-slate-100 bg-white rounded shadow-sm">
        {(pendingSales ?? []).map((s) => (
          <li key={s.id} className="px-4 py-2 flex justify-between text-sm">
            <span>{s.agent_name}</span>
            <StatusBadge status={s.status} />
          </li>
        ))}
        {(pendingSales ?? []).length === 0 && (
          <li className="px-4 py-4 text-center text-slate-400 text-sm">Nothing pending.</li>
        )}
      </ul>
    </AuthedShell>
  );
}
