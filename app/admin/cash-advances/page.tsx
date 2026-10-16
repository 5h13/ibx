// Build 126 (UIA-44) — Admin → Cash Advances: the Business Admin approves employees' requests.
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { CashAdvanceManager } from '@/modules/cashAdvance/CashAdvanceManager';
import { loadCashAdvances } from '@/modules/cashAdvance/actions';

export const dynamic = 'force-dynamic';

export default async function AdminCashAdvancesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile)) redirect('/dashboard');
  if (!profile.user.business_id) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">Select a store in &quot;Acting as&quot; — cash advances are per store.</div></AuthedShell>;
  const [rows, { data: banks }] = await Promise.all([loadCashAdvances(), createClient().from('finance_bank_accounts').select('id,account_name,bank_name,is_cash_on_hand').eq('status', 'active').order('account_name')]);
  return <AuthedShell profile={profile}><CashAdvanceManager rows={rows} mode="admin" banks={(banks ?? []) as any[]} canDecide canRelease /></AuthedShell>;
}
