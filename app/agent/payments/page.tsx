// Build 91 — agent portal: payment updates per DR / SI, confirmed by the cashier.
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked } from '@/modules/agent/AgentHeader';
import { AgentPayments } from '@/modules/agent/AgentPayments';

export const dynamic = 'force-dynamic';

export default async function AgentPaymentsPage(props: { searchParams?: Promise<{ b?: string; c?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
  const db = createClient();
  const [{ data: reports, error }, { data: clients }] = await Promise.all([
    db.rpc('agent_payments_list', { p_business: ctx.store.business_id }),
    db.rpc('agent_clients', { p_business: ctx.store.business_id }),
  ]);
  if (error) throw new Error(error.message);
  return (
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="Payments" hint="Report what a client paid, per DR / invoice. The cashier confirms it at the store counter when the money or check is handed in; only then is the DR marked paid." stores={ctx.stores} store={ctx.store} />
        <AgentPayments reports={(reports ?? []) as any[]} clients={(clients ?? []) as any[]} initialClient={sp.c ?? ''} />
      </div>
    </AuthedShell>
  );
}
