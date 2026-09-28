// app/marketing/expenses/page.tsx
import { requireSection } from '@/core/auth/requireSection';
import { listExpenses } from '@/shared/expenses/service';
import { ExpensesTable } from '@/shared/expenses/ExpensesTable';
import { NewExpenseForm } from '@/shared/expenses/NewExpenseForm';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';

export default async function MarketingExpensesPage() {
  const profile = await requireSection('marketing');
  const monthId = await getCurrentMonthId(profile.user.business_id);
  const rows = await listExpenses('marketing', monthId);
  const supabase = (await import('@/core/auth/supabaseServer')).createClient();
  const { data: costCenters } = await supabase.from('finance_cost_centers').select('id,code,name').eq('active', true).order('name');
  const { data: categories } = await supabase.from('admin_expense_categories').select('id,code,name').eq('active', true).order('name');
  const { data: suppliers } = await supabase.from('finance_suppliers').select('id,supplier_code,legal_name').eq('active', true).order('legal_name');

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Marketing Expenses</h2>
      <ActionBar className="mb-4">
        <PopupAction label="+ New expense" title="New expense">
          <NewExpenseForm sectionCode="marketing" monthId={monthId} costCenters={costCenters || []} categories={categories || []} suppliers={suppliers || []} />
        </PopupAction>
      </ActionBar>
      <ExpensesTable rows={rows} profile={profile} pathname="/marketing/expenses" categories={categories || []} suppliers={suppliers || []} />
    </AuthedShell>
  );
}
