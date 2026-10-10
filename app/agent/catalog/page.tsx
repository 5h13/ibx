// Build 91 — agent portal: catalogue with client pricing, and the order basket.
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentCatalog } from '@/modules/agent/AgentCatalog';

export const dynamic = 'force-dynamic';

export default async function AgentCatalogPage(props: { searchParams?: Promise<{ b?: string; c?: string; order?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="Catalogue & Pricing" />;
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
    <AgentShell ctx={ctx} title="Catalogue & Pricing" hint="Tap a product for photos and details. Pick a client to see his price; without one you see the Tier 4 – Tier 1 range.">
      <div className="space-y-4">
        <AgentCatalog key={`${b}:${order?.id ?? ''}`} businessId={b} clients={(clients ?? []) as any} categories={((cats ?? []) as string[])} tiers={tiers}
          initialClient={order?.customer_id ?? sp.c ?? ''} order={order} />
      </div>
    </AgentShell>
  );
}
