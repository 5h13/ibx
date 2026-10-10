// Build 92 — agent portal: my commission (this month so far, closed months, statement lines).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked } from '@/modules/agent/AgentHeader';
import { CommissionStatement } from '@/modules/agent/CommissionStatement';

export const dynamic = 'force-dynamic';

export default async function AgentCommissionPage(props: { searchParams?: Promise<{ b?: string; m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? `${sp.m}-01` : null;
  const { data, error } = await createClient().rpc('agent_commission_mine', { p_business: ctx.store.business_id, p_month: month });
  if (error) throw new Error(error.message);
  const d: any = data;
  return (
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="My Commission" hint="Commission is earned on the markup of each sale as your clients pay. The month's paid sales set your tier." stores={ctx.stores} store={ctx.store} />
        <form method="get" className="flex items-end gap-2 text-sm">
          <input type="hidden" name="b" value={ctx.store.business_id} />
          <label className="block">Month<input className="input mt-1" type="month" name="m" defaultValue={String(d.month).slice(0, 7)} /></label>
          <button className="button-secondary">Show</button>
        </form>
        <CommissionStatement data={d} />
        {Number(d.savings_balance) > 0 && <div className="rounded border bg-white p-3 text-sm">Your savings with the store: <b>₱{Number(d.savings_balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</b> (released by the Business Admin).</div>}
        <section className="space-y-2">
          <h3 className="font-semibold">Closed months</h3>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Month</th><th className="p-2 text-right">Paid sales</th><th className="p-2 text-right">Tier</th><th className="p-2 text-right">Earned</th><th className="p-2 text-right">Adjustments</th><th className="p-2 text-right">Payable</th><th className="p-2">Payout</th></tr></thead>
              <tbody>
                {(d.history ?? []).map((h: any) => (
                  <tr key={h.month} className="border-t">
                    <td className="p-2"><a className="text-blue-700 underline" href={`?b=${ctx.store!.business_id}&m=${String(h.month).slice(0, 7)}`}>{new Date(h.month).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}</a></td>
                    <td className="p-2 text-right">₱{Number(h.paid_sales).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="p-2 text-right">{Number(h.points) > 0 ? '+' : ''}{Number(h.points)} pts</td>
                    <td className="p-2 text-right">₱{Number(h.earned).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="p-2 text-right">{Number(h.adjustments) || Number(h.carried_in) ? `₱${(Number(h.adjustments) + Number(h.carried_in)).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}</td>
                    <td className="p-2 text-right font-medium">₱{Number(h.payable).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="p-2 text-xs">{Number(h.payable) <= 0 ? 'carried to next month' : h.expense_status === 'paid' ? 'paid' : h.expense_status === 'posted' ? 'posted by Finance' : 'approved — waiting for Finance'}</td>
                  </tr>
                ))}
                {!(d.history ?? []).length && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No closed months yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AuthedShell>
  );
}
