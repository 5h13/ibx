// Build 91 — agent portal: my orders (drafts, sent to the store, completed).
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentOrders } from '@/modules/agent/AgentOrders';

export const dynamic = 'force-dynamic';

export default async function AgentOrdersPage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="Orders" />;
  const { data, error } = await createClient().rpc('agent_orders_list', { p_business: ctx.store.business_id });
  if (error) throw new Error(error.message);
  return (
    <AgentShell ctx={ctx} title="Orders" hint="Orders you took in this store. Send a draft to the store; the store makes the sale (or orders from the supplier).">
      <div className="space-y-4">
        <AgentOrders businessId={ctx.store.business_id} orders={(data ?? []) as any[]} />
      </div>
    </AgentShell>
  );
}
