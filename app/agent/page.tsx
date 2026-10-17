// Build 132 — agent app Home: my month against my target (My Clients moved to /agent/clients).
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHome } from '@/modules/agent/AgentHome';

export const dynamic = 'force-dynamic';

export default async function AgentHomePage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="Home" />;
  const { data, error } = await createClient().rpc('agent_home', { p_business: ctx.store.business_id });
  if (error) throw new Error(error.message);
  return (
    <AgentShell ctx={ctx} title="Home">
      <AgentHome h={data} b={ctx.store.business_id} />
    </AgentShell>
  );
}
