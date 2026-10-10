// Build 91 — agent portal: expense reports (receipt photo required except meals).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked } from '@/modules/agent/AgentHeader';
import { AgentExpenses } from '@/modules/agent/AgentExpenses';

export const dynamic = 'force-dynamic';

export default async function AgentExpensesPage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store || !ctx.agentId) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
  const admin = createAdminClient();   // categories and this agent's own allowances (read after the agent check above)
  const [{ data: list, error }, { data: cats }, { data: allowances }] = await Promise.all([
    createClient().rpc('agent_expenses_list', { p_business: ctx.store.business_id }),
    admin.from('admin_expense_categories').select('id,code,name').eq('active', true).order('name'),
    admin.from('expense_allowances').select('category_id,monthly_limit').eq('business_id', ctx.store.business_id).eq('agent_id', ctx.agentId).eq('active', true),
  ]);
  if (error) throw new Error(error.message);
  return (
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="Expenses" hint="File your expenses for this store with a photo of the receipt (meals can be filed without one). The Business Admin approves them and Finance pays you back." stores={ctx.stores} store={ctx.store} />
        <AgentExpenses businessId={ctx.store.business_id} expenses={(list ?? []) as any[]} categories={(cats ?? []) as any[]} allowances={(allowances ?? []) as any[]} />
      </div>
    </AuthedShell>
  );
}
