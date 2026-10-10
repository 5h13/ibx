// Build 91 — agent portal: My Clients (in the chosen store).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked } from '@/modules/agent/AgentHeader';
import { AgentClients } from '@/modules/agent/AgentClients';

export const dynamic = 'force-dynamic';

export default async function AgentHomePage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
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
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="My Clients" hint="Clients assigned to you in this store. Set each client's usual price tier; open the catalogue, an order, a payment or the statement from here." stores={ctx.stores} store={ctx.store} />
        <AgentClients businessId={b} clients={(clients ?? []) as any} tiers={tiers} />
      </div>
    </AuthedShell>
  );
}
