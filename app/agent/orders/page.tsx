// Build 91 — agent portal: my orders (drafts, sent to the store, completed).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked } from '@/modules/agent/AgentHeader';
import { AgentOrders } from '@/modules/agent/AgentOrders';

export const dynamic = 'force-dynamic';

export default async function AgentOrdersPage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
  const { data, error } = await createClient().rpc('agent_orders_list', { p_business: ctx.store.business_id });
  if (error) throw new Error(error.message);
  return (
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="Orders" hint="Orders you took for your clients. Send a draft to the store; the store makes the sale and the order shows as completed." stores={ctx.stores} store={ctx.store} />
        <AgentOrders businessId={ctx.store.business_id} orders={(data ?? []) as any[]} />
      </div>
    </AuthedShell>
  );
}
