// Build 92 — agent portal: my quotations (approved by the Sales approver, then printed for the client).
import Link from 'next/link';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { AgentHeader, AgentNotLinked, Pill, peso } from '@/modules/agent/AgentHeader';

export const dynamic = 'force-dynamic';
const LABEL: Record<string, string> = { prepared: 'waiting for approval', reviewed: 'reviewed — waiting for approval', approved: 'approved — print it', sent: 'sent to client', accepted: 'accepted', draft: 'returned to draft', superseded: 'superseded' };
const TONE: Record<string, string> = { prepared: 'pending', reviewed: 'pending', approved: 'approved', sent: 'sent', accepted: 'completed', draft: 'draft', superseded: 'cancelled' };

export default async function AgentQuotationsPage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AuthedShell profile={ctx.profile}><AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} /></AuthedShell>;
  const { data, error } = await createClient().rpc('agent_quotes_list', { p_business: ctx.store.business_id });
  if (error) throw new Error(error.message);
  const quotes = (data ?? []) as any[];
  return (
    <AuthedShell profile={ctx.profile}>
      <div className="space-y-5">
        <AgentHeader title="Quotations" hint="Quotations you made for your clients (from the catalogue basket: “Make a quotation instead”). The Sales approver approves them; then print and send. The store turns an accepted quotation into a sales order." stores={ctx.stores} store={ctx.store} />
        <Link className="button" href={`/agent/catalog?b=${ctx.store.business_id}`}>+ New quotation</Link>
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Quotation</th><th className="p-2">Client</th><th className="p-2">Status</th><th className="p-2 text-right">Amount</th><th className="p-2"></th></tr></thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t align-top">
                  <td className="p-2 font-mono text-xs">{q.quotation_number}<div className="font-sans text-slate-500">{q.quotation_date}{q.valid_until ? ` · valid to ${q.valid_until}` : ''}</div></td>
                  <td className="p-2">{q.customer}{q.notes && <div className="text-xs text-slate-500">{q.notes}</div>}</td>
                  <td className="p-2"><Pill status={TONE[q.status] ?? q.status} label={LABEL[q.status] ?? q.status} />{q.order_number && <div className="text-xs text-slate-500">Order {q.order_number}</div>}</td>
                  <td className="p-2 text-right">{peso(q.total_amount)}<div className="text-xs text-slate-500">{q.items} item(s)</div></td>
                  <td className="p-2"><a className="text-xs text-blue-700 underline" href={`/sales/quotations/${q.id}`} target="_blank" rel="noreferrer">{['approved', 'sent', 'accepted'].includes(q.status) ? 'Print' : 'Preview'}</a></td>
                </tr>
              ))}
              {!quotes.length && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No quotations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AuthedShell>
  );
}
