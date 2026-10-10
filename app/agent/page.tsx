// Build 91 — agent portal: My Clients (in the chosen store).
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentClients } from '@/modules/agent/AgentClients';

export const dynamic = 'force-dynamic';

export default async function AgentHomePage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="My Clients" />;
  const db = createClient();
  const b = ctx.store.business_id;
  const [{ data: clients, error }, t2, t3, t4] = await Promise.all([
    db.rpc('agent_clients', { p_business: b }),
    db.rpc('price_tier_give', { p_business: b, p_tier: 2 }),
    db.rpc('price_tier_give', { p_business: b, p_tier: 3 }),
    db.rpc('price_tier_give', { p_business: b, p_tier: 4 }),
  ]);
  if (error) throw new Error(error.message);
  const tiers = [0, Number(t2.data ?? 0), Number(t3.data ?? 0), Number(t4.data ?? 0)];
  return (
    <AgentShell ctx={ctx} title="My Clients" hint="Your clients in this store. Set each one's usual price tier; order, report a payment or open the statement.">
      <div className="space-y-4">
        <AgentClients businessId={b} clients={(clients ?? []) as any} tiers={tiers} />
      </div>
    </AgentShell>
  );
}
