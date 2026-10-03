// Build 80 (EXP-01): Finance → All expenses — every department's expenses,
// categories, and the monthly spread of prepaid costs, accruals and 13th month.
import { requireSection } from '@/core/auth/requireSection';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { ExpenseRegister } from '@/modules/finance/expenses/ExpenseRegister';
import type { RegisterRow, ScheduleRow } from '@/modules/finance/expenses/actions';

export default async function ExpenseRegisterPage(props: { searchParams?: Promise<{ from?: string; to?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await requireSection('finance');
  const db = createClient();
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(searchParams?.from) ? searchParams!.from! : iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = isDate(searchParams?.to) ? searchParams!.to! : iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const [reg, { data: categories }, { data: banks }, sched, { data: accounts }, { data: canFinance }] = await Promise.all([
    db.rpc('expense_register', { p_from: from, p_to: to }),
    db.from('admin_expense_categories').select('id,code,name,description,gl_account_code,active').order('name'),
    db.from('finance_bank_accounts').select('id,account_code,account_name').eq('status', 'active').order('account_code'),
    db.rpc('expense_schedules'),
    db.rpc('expense_accounts'),
    db.rpc('exp_can_finance'),
  ]);
  return (
    <AuthedShell profile={profile}>
      <ExpenseRegister from={from} to={to} rows={(reg.data ?? []) as RegisterRow[]} loadError={reg.error?.message || sched.error?.message || ''}
        categories={categories ?? []} banks={banks ?? []} schedules={(sched.data ?? []) as ScheduleRow[]} accounts={accounts ?? []} canFinance={!!canFinance} />
    </AuthedShell>
  );
}
