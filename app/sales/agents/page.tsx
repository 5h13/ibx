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
  // Build 97d: agent figures never carry over from one store to another. Inside a store (or "Acting as" one)
  // only that store's clients and sales count; at the 5H13 level each store's figures are kept apart.
  const scope = profile.user.business_id ?? null;
  const since = new Date(Date.now() + 8 * 3600000); since.setUTCMonth(since.getUTCMonth() - 3);
  const sinceDate = since.toISOString().slice(0, 10);
  const inScope = <T,>(q: T): T => (scope ? (q as any).eq('business_id', scope) : q);
  const [{ data: agents, error }, { data: customers }, { data: sales }, { data: recent }, { data: links }] = await Promise.all([
    db.from('sales_agents').select('id,agent_code,name,kind,business_id,phone,email,gcash_number,notes,active,user_id,commission_basis,commission_rate,gross_less_expenses').order('kind', { ascending: false }).order('name'),
    inScope(db.from('finance_customers').select('agent_id,business_id').eq('active', true).limit(20000)),
    inScope(db.from('storefront_sales').select('agent_id,business_id,total').eq('status', 'completed').gte('sale_date', from).lte('sale_date', to).limit(50000)),
    inScope(db.from('storefront_sales').select('agent_id,business_id,sale_date').eq('status', 'completed').gte('sale_date', sinceDate).limit(50000)),
    db.rpc('sales_agent_stores'),   // Build 97e: which agents work in which store
  ]);
  if (error) throw new Error(error.message);
  type Fig = { customers: number; sales_count: number; sales_total: number; last_sale: string | null };
  const by: Record<string, Record<string, Fig>> = {};
  const fig = (agent: string, biz: string) => ((by[agent] ??= {})[biz] ??= { customers: 0, sales_count: 0, sales_total: 0, last_sale: null });
  for (const c of (customers ?? []) as any[]) if (c.agent_id && c.business_id) fig(c.agent_id, c.business_id).customers++;
  for (const x of (sales ?? []) as any[]) if (x.agent_id && x.business_id) { const f = fig(x.agent_id, x.business_id); f.sales_count++; f.sales_total += Number(x.total); }
  for (const r of (recent ?? []) as any[]) if (r.agent_id && r.business_id) { const f = fig(r.agent_id, r.business_id); if (!f.last_sale || r.sale_date > f.last_sale) f.last_sale = r.sale_date; }
  const worksIn: Record<string, string[]> = {};
  for (const l of (links ?? []) as any[]) (worksIn[l.agent_id] ??= []).push(l.business_id);
  // a store sees only its own agents (its walk-in account, agents created there, agents with clients or sales there)
  const rows: AgentRow[] = ((agents ?? []) as any[])
    .filter((a) => (scope ? (a.kind === 'store' ? a.business_id === scope : (worksIn[a.id] ?? []).includes(scope)) : profile.user.role === 'super_admin'))
    .map((a) => {
      const per = by[a.id] ?? {};
      const own = scope ? per[scope] : undefined;   // inside a store: that store only, never the others
      return { ...a, has_login: !!a.user_id, by_store: per,
        sold_in: Object.entries(per).filter(([, f]) => f.last_sale).map(([k]) => k),
        stores: a.kind === 'store' ? [a.business_id] : (worksIn[a.id] ?? []),
        customers: own?.customers ?? 0, sales_count: own?.sales_count ?? 0, sales_total: own?.sales_total ?? 0, last_sale: own?.last_sale ?? null };
    });
  // Build 91: price tiers of this store and agent expenses to approve (Business Admin)
  const b = profile.user.business_id;
  const tiers = b ? await Promise.all([2, 3, 4].map(async (t) => Number((await db.rpc('price_tier_give', { p_business: b, p_tier: t })).data ?? 0))) : null;
  const expenses = isAdminTier(profile) && b ? (((await db.rpc('agent_expenses_review')).data ?? []) as any[]) : [];
  const { data: bizRows } = await db.from('businesses').select('id,code,trade_name').eq('is_active', true).order('code');
  return <AuthedShell profile={profile}><AgentsManagement scope={scope} recentSince={sinceDate} businesses={(bizRows ?? []) as any[]} agents={rows} canEdit={isAdminTier(profile)} from={from} to={to} tiers={tiers} expenses={expenses} /></AuthedShell>;
}
