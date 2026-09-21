// app/marketing/expenses/page.tsx
import { requireSection } from '@/core/auth/requireSection';
import { listExpenses } from '@/shared/expenses/service';
import { ExpensesTable } from '@/shared/expenses/ExpensesTable';
import { NewExpenseForm } from '@/shared/expenses/NewExpenseForm';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';

export default async function MarketingExpensesPage() {
  const profile = await requireSection('marketing');
  const monthId = await getCurrentMonthId();
  const rows = await listExpenses('marketing', monthId);

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Marketing Expenses</h2>
      <NewExpenseForm sectionCode="marketing" monthId={monthId} />
      <ExpensesTable rows={rows} profile={profile} />
    </AuthedShell>
  );
}
