// Build 86 — AGT-01 Part A: sales agents (list, customers and counter sales per agent).
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier } from '@/core/auth/types';
import { requireAnySection } from '@/shared/documents/access';
import { AgentsManagement, type AgentRow } from '@/modules/sales/agents/AgentsManagement';

export const dynamic = 'force-dynamic';
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function AgentsPage(props: { searchParams?: Promise<{ from?: string; to?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await requireAnySection(['sales', 'finance'], ['sales.agents', 'finance.ar']);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const to = isDate(sp.to) ?? today;
  const from = isDate(sp.from) ?? `${to.slice(0, 7)}-01`;
  const db = createClient();
  const [{ data: agents, error }, { data: customers }, { data: sales }] = await Promise.all([
    db.from('sales_agents').select('id,agent_code,name,kind,business_id,phone,email,gcash_number,notes,active,user_id').order('kind', { ascending: false }).order('name'),
    db.from('finance_customers').select('agent_id').eq('active', true).limit(20000),
    db.from('storefront_sales').select('agent_id,total').eq('status', 'completed').gte('sale_date', from).lte('sale_date', to).limit(20000),
  ]);
  if (error) throw new Error(error.message);
  const cust: Record<string, number> = {}; for (const c of (customers ?? []) as any[]) cust[c.agent_id] = (cust[c.agent_id] ?? 0) + 1;
  const cnt: Record<string, number> = {}; const tot: Record<string, number> = {};
  for (const s of (sales ?? []) as any[]) { cnt[s.agent_id] = (cnt[s.agent_id] ?? 0) + 1; tot[s.agent_id] = (tot[s.agent_id] ?? 0) + Number(s.total); }
  const rows: AgentRow[] = ((agents ?? []) as any[])
    .filter((a) => a.kind === 'freelance' || a.business_id === profile.user.business_id || (!profile.user.business_id && profile.user.role === 'super_admin'))
    .map((a) => ({ ...a, has_login: !!a.user_id, customers: cust[a.id] ?? 0, sales_count: cnt[a.id] ?? 0, sales_total: tot[a.id] ?? 0 }));
  // Build 91: price tiers of this store and agent expenses to approve (Business Admin)
  const b = profile.user.business_id;
  const tiers = b ? await Promise.all([2, 3, 4].map(async (t) => Number((await db.rpc('price_tier_give', { p_business: b, p_tier: t })).data ?? 0))) : null;
  const expenses = isAdminTier(profile) && b ? (((await db.rpc('agent_expenses_review')).data ?? []) as any[]) : [];
  return <AuthedShell profile={profile}><AgentsManagement agents={rows} canEdit={isAdminTier(profile)} from={from} to={to} tiers={tiers} expenses={expenses} /></AuthedShell>;
}
