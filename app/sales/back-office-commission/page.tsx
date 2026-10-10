// Build 93 — Back Office Commission (ISHABELLA's workbook, general for every store; rates editable per store).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { isAdminTier } from '@/core/auth/types';
import { requireAnySection } from '@/shared/documents/access';
import { BackOfficeCommission } from '@/modules/sales/agents/BackOfficeCommission';

export const dynamic = 'force-dynamic';

export default async function BackOfficeCommissionPage(props: { searchParams?: Promise<{ m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await requireAnySection(['sales', 'finance'], ['sales.reports', 'finance.expenses']);
  const b = profile.user.business_id;
  if (!b) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">Select a business in &quot;Acting as&quot; — back office commission is per store.</div></AuthedShell>;
  const thisMonth = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const last = new Date(Date.now() + 8 * 3600000); last.setUTCDate(1); last.setUTCMonth(last.getUTCMonth() - 1);
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : last.toISOString().slice(0, 7);
  const db = createClient();
  const [{ data, error }, { data: employees }, { data: agents }, { data: cats }] = await Promise.all([
    db.rpc('bo_commission_month', { p_month: `${month}-01` }),
    db.from('employees').select('id,first_name,last_name,department,position_title,employment_status').eq('business_id', b).order('first_name'),
    db.from('sales_agents').select('id,agent_code,name').eq('kind', 'freelance').eq('active', true).order('name'),
    db.from('finance_procurement_items').select('category').eq('active', true).limit(10000),
  ]);
  if (error) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">{error.message}</div></AuthedShell>;
  const categories = Array.from(new Set(((cats ?? []) as any[]).map((c) => String(c.category ?? '').trim()).filter(Boolean))).sort((x, y) => x.localeCompare(y));
  return (
    <AuthedShell profile={profile}>
      <BackOfficeCommission data={data as any} month={month} thisMonth={thisMonth} canManage={isAdminTier(profile)}
        employees={((employees ?? []) as any[]).filter((e) => e.employment_status !== 'separated')} agents={(agents ?? []) as any[]} categories={categories} />
    </AuthedShell>
  );
}
