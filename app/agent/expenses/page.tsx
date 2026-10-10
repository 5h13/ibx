// Build 91 — agent portal: expense reports (receipt photo required except meals).
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentExpenses } from '@/modules/agent/AgentExpenses';

export const dynamic = 'force-dynamic';

export default async function AgentExpensesPage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store || !ctx.agentId) return <AgentShell ctx={ctx} title="Expenses" />;
  const admin = createAdminClient();   // categories and this agent's own allowances (read after the agent check above)
  const [{ data: list, error }, { data: cats }, { data: allowances }] = await Promise.all([
    createClient().rpc('agent_expenses_list', { p_business: ctx.store.business_id }),
    admin.from('admin_expense_categories').select('id,code,name').eq('active', true).order('name'),
    admin.from('expense_allowances').select('category_id,monthly_limit').eq('business_id', ctx.store.business_id).eq('agent_id', ctx.agentId).eq('active', true),
  ]);
  if (error) throw new Error(error.message);
  return (
    <AgentShell ctx={ctx} title="Expenses" hint="File your expenses for this store with a receipt photo (meals can go without). The Business Admin approves; Finance pays you back.">
      <div className="space-y-4">
        <AgentExpenses businessId={ctx.store.business_id} expenses={(list ?? []) as any[]} categories={(cats ?? []) as any[]} allowances={(allowances ?? []) as any[]} />
      </div>
    </AgentShell>
  );
}
