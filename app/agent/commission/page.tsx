// Build 92 — agent portal: my commission (this month so far, closed months, statement lines).
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { CommissionStatement } from '@/modules/agent/CommissionStatement';

export const dynamic = 'force-dynamic';

export default async function AgentCommissionPage(props: { searchParams?: Promise<{ b?: string; m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="My Commission" />;
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? `${sp.m}-01` : null;
  const { data, error } = await createClient().rpc('agent_commission_mine', { p_business: ctx.store.business_id, p_month: month });
  if (error) throw new Error(error.message);
  const d: any = data;
  return (
    <AgentShell ctx={ctx} title="My Commission" hint="Earned on each sale as your clients pay, in this store.">
      <div className="space-y-4">
        <form method="get" className="flex items-end gap-2 text-sm">
          <input type="hidden" name="b" value={ctx.store.business_id} />
          <label className="block">Month<input className="input mt-1" type="month" name="m" defaultValue={String(d.month).slice(0, 7)} /></label>
          <button className="button-secondary">Show</button>
        </form>
        <CommissionStatement data={d} />
        {Number(d.savings_balance) > 0 && <div className="rounded border bg-white p-3 text-sm">Your savings with the store: <b>₱{Number(d.savings_balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</b> (released by the Business Admin).</div>}
        <section className="space-y-2">
          <h3 className="font-semibold">Closed months</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {(d.history ?? []).map((h: any) => (
              <a key={h.month} href={`?b=${ctx.store!.business_id}&m=${String(h.month).slice(0, 7)}`} className="block space-y-1 rounded-xl border bg-white p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{new Date(h.month).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</div>
                  <div className="text-right font-semibold">₱{Number(h.payable).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
                <div className="text-xs text-slate-600">Paid sales ₱{Number(h.paid_sales).toLocaleString(undefined, { minimumFractionDigits: 2 })} · {Number(h.points) > 0 ? '+' : ''}{Number(h.points)} pts · earned ₱{Number(h.earned).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  {Number(h.adjustments) || Number(h.carried_in) ? ` · adj. ₱${(Number(h.adjustments) + Number(h.carried_in)).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}</div>
                <div className="text-xs text-slate-500">{Number(h.payable) <= 0 ? 'carried to next month' : h.expense_status === 'paid' ? 'paid' : h.expense_status === 'posted' ? 'posted by Finance' : 'approved — waiting for Finance'}</div>
              </a>
            ))}
          </div>
          {!(d.history ?? []).length && <div className="rounded-xl border bg-white p-4 text-center text-sm text-slate-500">No closed months yet.</div>}
        </section>
      </div>
    </AgentShell>
  );
}
