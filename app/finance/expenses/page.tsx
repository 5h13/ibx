// app/finance/expenses/page.tsx
import { requireSection } from '@/core/auth/requireSection';
import { listExpenses } from '@/shared/expenses/service';
import { ExpensesTable } from '@/shared/expenses/ExpensesTable';
import { NewExpenseForm } from '@/shared/expenses/NewExpenseForm';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';

export default async function FinanceExpensesPage() {
  const profile = await requireSection('finance');
  const monthId = await getCurrentMonthId(profile.user.business_id);
  const rows = await listExpenses('finance', monthId);
  const descriptionSuggestions = Array.from(new Set(rows.map((row) => row.description.trim()).filter(Boolean))).slice(0, 50);
  const supabase = (await import('@/core/auth/supabaseServer')).createClient();
  const { data: costCenters } = await supabase.from('finance_cost_centers').select('id,code,name').eq('active', true).order('name');
  const { data: categories } = await supabase.from('admin_expense_categories').select('id,code,name').eq('active', true).order('name');
  const { data: suppliers } = await supabase.from('finance_suppliers').select('id,supplier_code,legal_name').eq('active', true).order('legal_name');
  const { data: bankAccounts } = await supabase.from('finance_bank_accounts').select('id,account_code,account_name').eq('status', 'active').order('account_code');

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Finance Expenses</h2>
      <NewExpenseForm sectionCode="finance" monthId={monthId} costCenters={costCenters || []} categories={categories || []} suppliers={suppliers || []} suggestions={descriptionSuggestions} />
      <ExpensesTable rows={rows} profile={profile} pathname="/finance/expenses" categories={categories || []} bankAccounts={bankAccounts || []} suppliers={suppliers || []} />
    </AuthedShell>
  );
}
