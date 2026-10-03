// Build 89 (BUD-01) — Budgets: start from this year's actuals, accruals per line,
// scenarios built from actions, budget vs actual read automatically.
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier } from '@/core/auth/types';
import { BudgetManagement } from '@/modules/finance/budgets/BudgetManagement';

export const dynamic = 'force-dynamic';

export default async function BudgetsPage(props: { searchParams?: Promise<{ b?: string; tab?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await requireSection('finance');
  const db = createClient();
  const { data: budgets, error } = await db.from('finance_budgets').select('*').order('fiscal_year', { ascending: false }).order('version', { ascending: false });
  if (error) throw new Error(error.message);
  const budget = (budgets ?? []).find((b: any) => b.id === sp.b) ?? (budgets ?? [])[0] ?? null;
  let lines: any[] = [], scenarios: any[] = [], actions: any[] = [], actuals: any[] = [];
  if (budget) {
    const [{ data: l, error: le }, { data: s, error: se }] = await Promise.all([
      db.from('finance_budget_lines').select('*').eq('budget_id', budget.id).order('sort_order').order('line_code'),
      db.from('finance_budget_scenarios').select('*').eq('budget_id', budget.id).order('is_base', { ascending: false }).order('created_at'),
    ]);
    if (le || se) throw new Error((le || se)!.message);
    lines = l ?? []; scenarios = s ?? [];
    if (scenarios.length) {
      const { data: a, error: ae } = await db.from('finance_budget_actions').select('*').in('scenario_id', scenarios.map((x) => x.id)).order('sort_order').order('created_at');
      if (ae) throw new Error(ae.message);
      actions = a ?? [];
    }
    if (budget.business_id) {
      const { data: act } = await db.rpc('budget_actuals', { p_business: budget.business_id, p_year: budget.fiscal_year });
      actuals = act ?? [];
    }
  }
  const { data: categories } = await db.from('admin_expense_categories').select('id,name,gl_account_code').eq('active', true).order('name');
  const thisYear = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4));
  return (
    <AuthedShell profile={profile}>
      <BudgetManagement budgets={budgets ?? []} budget={budget} lines={lines} scenarios={scenarios} actions={actions} actuals={actuals}
        categories={categories ?? []} canApprove={isAdminTier(profile)} hasBusiness={Boolean(profile.user.business_id)} thisYear={thisYear} initialTab={sp.tab} />
    </AuthedShell>
  );
}
