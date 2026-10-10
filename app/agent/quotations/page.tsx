// Build 92 — agent portal: my quotations (approved by the Sales approver, then printed for the client).
import Link from 'next/link';
import { AgentShell } from '@/modules/agent/AgentShell';
import { createClient } from '@/core/auth/supabaseServer';
import { getAgentContext } from '@/modules/agent/agentContext';
import { Pill, peso } from '@/modules/agent/AgentHeader';

export const dynamic = 'force-dynamic';
const LABEL: Record<string, string> = { prepared: 'waiting for approval', reviewed: 'reviewed — waiting for approval', approved: 'approved — print it', sent: 'sent to client', accepted: 'accepted', draft: 'returned to draft', superseded: 'superseded' };
const TONE: Record<string, string> = { prepared: 'pending', reviewed: 'pending', approved: 'approved', sent: 'sent', accepted: 'completed', draft: 'draft', superseded: 'cancelled' };

export default async function AgentQuotationsPage(props: { searchParams?: Promise<{ b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const ctx = await getAgentContext(sp.b);
  if (!ctx.store) return <AgentShell ctx={ctx} title="Quotations" />;
  const { data, error } = await createClient().rpc('agent_quotes_list', { p_business: ctx.store.business_id });
  if (error) throw new Error(error.message);
  const quotes = (data ?? []) as any[];
  return (
    <AgentShell ctx={ctx} title="Quotations" hint="Quotations for your clients in this store. The Sales approver approves them; then print and send.">
      <div className="space-y-4">
        <Link className="button block text-center sm:inline-block" href={`/agent/catalog?b=${ctx.store.business_id}`}>+ New quotation</Link>
        <div className="grid gap-3 md:grid-cols-2">
          {quotes.map((q) => (
            <div key={q.id} className="space-y-1 rounded-xl border bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="font-medium leading-snug">{q.customer}</div>
                  <div className="text-[11px] text-slate-500"><span className="font-mono">{q.quotation_number}</span> · {q.quotation_date}{q.valid_until ? ` · valid to ${q.valid_until}` : ''}</div></div>
                <div className="flex-none text-right"><div className="font-semibold">{peso(q.total_amount)}</div><div className="text-[11px] text-slate-500">{q.items} item(s)</div></div>
              </div>
              {q.notes && <div className="text-xs text-slate-600">{q.notes}</div>}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div><Pill status={TONE[q.status] ?? q.status} label={LABEL[q.status] ?? q.status} />{q.order_number && <span className="ml-2 text-xs text-slate-500">Order {q.order_number}</span>}</div>
                <a className="button-secondary text-xs" href={`/sales/quotations/${q.id}`} target="_blank" rel="noreferrer">{['approved', 'sent', 'accepted'].includes(q.status) ? 'Print' : 'Preview'}</a>
              </div>
            </div>
          ))}
        </div>
        {!quotes.length && <div className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">No quotations in this store yet.</div>}
      </div>
    </AgentShell>
  );
}
