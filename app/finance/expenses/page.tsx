// app/finance/expenses/page.tsx
import { requireSection } from '@/core/auth/requireSection';
import { listExpenses } from '@/shared/expenses/service';
import { ExpensesTable } from '@/shared/expenses/ExpensesTable';
import { NewExpenseForm } from '@/shared/expenses/NewExpenseForm';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';

export default async function FinanceExpensesPage() {
  const profile = await requireSection('finance');
  const monthId = await getCurrentMonthId();
  const rows = await listExpenses('finance', monthId);

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Finance Expenses</h2>
      <NewExpenseForm sectionCode="finance" monthId={monthId} />
      <ExpensesTable rows={rows} profile={profile} />
    </AuthedShell>
  );
}
