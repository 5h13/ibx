// Build 80 (EXP-01): the same expense page for every department.
import { requireSection } from '@/core/auth/requireSection';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { DepartmentExpenses } from '@/shared/expenses/DepartmentExpenses';
import { loadDepartmentExpenses } from '@/shared/expenses/loadDepartmentExpenses';

export default async function ExpensesPage(props: { searchParams?: Promise<{ month?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await requireSection('logistics');
  const data = await loadDepartmentExpenses(profile, 'logistics', searchParams?.month);
  return <AuthedShell profile={profile}><DepartmentExpenses profile={profile} data={data} /></AuthedShell>;
}
