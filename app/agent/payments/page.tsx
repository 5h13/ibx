// Build 91 — agent portal: payment updates per DR / SI, confirmed by the cashier.
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentPayments } from '@/modules/agent/AgentPayments';

export const dynamic = 'force-dynamic';

export default async function AgentPaymentsPage(props: { searchParams?: Promise<{ b?: string; c?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="Payments" />;
  const db = createClient();
  const [{ data: reports, error }, { data: clients }] = await Promise.all([
    db.rpc('agent_payments_list', { p_business: ctx.store.business_id }),
    db.rpc('agent_clients', { p_business: ctx.store.business_id }),
  ]);
  if (error) throw new Error(error.message);
  return (
    <AgentShell ctx={ctx} title="Payments" hint="Report what a client paid, per DR / invoice. The cashier confirms it when the money or check is handed in.">
      <div className="space-y-4">
        <AgentPayments reports={(reports ?? []) as any[]} clients={(clients ?? []) as any[]} initialClient={sp.c ?? ''} />
      </div>
    </AgentShell>
  );
}
