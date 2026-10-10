// Build 91 — agent portal: catalogue with client pricing, and the order basket.
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked } from '@/modules/agent/AgentHeader';
import { AgentCatalog } from '@/modules/agent/AgentCatalog';

export const dynamic = 'force-dynamic';

export default async function AgentCatalogPage(props: { searchParams?: Promise<{ b?: string; c?: string; order?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
  const db = createClient();
  const b = ctx.store.business_id;
  const [{ data: clients }, { data: cats }, t2, t3, t4, orders] = await Promise.all([
    db.rpc('agent_clients', { p_business: b }),
    db.rpc('agent_catalog_categories'),
    db.rpc('price_tier_give', { p_business: b, p_tier: 2 }),
    db.rpc('price_tier_give', { p_business: b, p_tier: 3 }),
    db.rpc('price_tier_give', { p_business: b, p_tier: 4 }),
    sp.order ? db.rpc('agent_orders_list', { p_business: b }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const order = sp.order ? ((orders.data ?? []) as any[]).find((o) => o.id === sp.order && o.status === 'draft') ?? null : null;
  const tiers = [0, Number(t2.data ?? 0), Number(t3.data ?? 0), Number(t4.data ?? 0)];
  return (
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="Catalogue & Pricing" hint="Pick a client to see his prices. Tier prices give away part of the markup; Tier 4 is the lowest you can go, and nothing goes below the floor." stores={ctx.stores} store={ctx.store} />
        <AgentCatalog key={`${b}:${order?.id ?? ''}`} businessId={b} clients={(clients ?? []) as any} categories={((cats ?? []) as string[])} tiers={tiers}
          initialClient={order?.customer_id ?? sp.c ?? ''} order={order} />
      </div>
    </AuthedShell>
  );
}
