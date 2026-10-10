// Build 92 — AGT-01 Part B: agent commissions for the store (Business Admin, Finance, Sales approver).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { isAdminTier } from '@/core/auth/types';
import { requireAnySection } from '@/shared/documents/access';
import { AgentCommissions } from '@/modules/sales/agents/AgentCommissions';

export const dynamic = 'force-dynamic';

export default async function AgentCommissionsPage(props: { searchParams?: Promise<{ m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await requireAnySection(['sales', 'finance'], ['sales.reports', 'finance.expenses']);
  if (!profile.user.business_id) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">Select a business in &quot;Acting as&quot; — commissions are per store.</div></AuthedShell>;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : today;
  const db = createClient();
  const [{ data, error }, { data: cats }] = await Promise.all([
    db.rpc('agent_commission_overview', { p_month: `${month}-01` }),
    db.from('finance_procurement_items').select('category').eq('active', true).limit(10000),
  ]);
  if (error) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">{error.message}</div></AuthedShell>;
  const categories = Array.from(new Set(((cats ?? []) as any[]).map((c) => String(c.category ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return <AuthedShell profile={profile}><AgentCommissions data={data as any} month={month} thisMonth={today} canManage={isAdminTier(profile)} categories={categories} /></AuthedShell>;
}
