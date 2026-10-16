// Build 126 (UIA-44) — Finance → Cash Advances: release approved advances; see what is still owed.
import { requireSection } from '@/core/auth/requireSection';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { CashAdvanceManager } from '@/modules/cashAdvance/CashAdvanceManager';
import { loadCashAdvances } from '@/modules/cashAdvance/actions';

export const dynamic = 'force-dynamic';

export default async function FinanceCashAdvancesPage() {
  const profile = await requireSection('finance', 'finance.payroll');
  if (!profile.user.business_id) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">Select a store in &quot;Acting as&quot; — cash advances are per store.</div></AuthedShell>;
  const [rows, { data: banks }] = await Promise.all([loadCashAdvances(), createClient().from('finance_bank_accounts').select('id,account_name,bank_name,is_cash_on_hand').eq('status', 'active').order('account_name')]);
  return <AuthedShell profile={profile}><CashAdvanceManager rows={rows} mode="finance" banks={(banks ?? []) as any[]} canDecide={isAdminTier(profile)} canRelease /></AuthedShell>;
}
