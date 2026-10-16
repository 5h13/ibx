// Build 127 — Sales Manager app: review one quotation (margins, floor, last price to the client).
import Link from 'next/link';
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { loadQuote } from '@/modules/manager/actions';
import { QuoteActions } from '@/modules/manager/QuoteActions';
import { Card, Tile, peso, pct } from '@/modules/manager/ui';

export const dynamic = 'force-dynamic';

export default async function ManagerQuote(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const profile = await managerProfile();
  const q: any = await loadQuote(id);
  const lines: any[] = q.lines ?? [];
  const below = lines.filter((l) => l.below_floor).length;
  const net = Number(q.total) - Number(q.vat || 0);
  const margin = net > 0 && Number(q.cost) > 0 ? Math.round(((net - Number(q.cost)) / net) * 1000) / 10 : null;
  return (
    <ManagerShell profile={profile} title={q.number} sub={`Quotation · ${q.status === 'prepared' ? 'waiting for review' : q.status === 'reviewed' ? 'waiting for approval' : q.status}`} back="/manager/approvals">
      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            {q.client?.id ? <Link href={`/manager/clients/${q.client.id}`} className="text-base font-extrabold underline decoration-slate-300">{q.client.name}</Link> : <div className="text-base font-extrabold">—</div>}
            <div className="text-xs text-slate-600">{q.agent ? `Agent ${q.agent} · ` : ''}terms {q.terms || q.client?.terms || '—'}</div>
          </div>
          {q.ar && <div className="text-right text-xs"><div className="text-slate-500">Owes</div><div className={`font-bold ${Number(q.ar.overdue) > 0 ? 'text-red-700' : ''}`}>{peso(q.ar.owed)}{Number(q.ar.overdue) > 0 ? ` · ${peso(q.ar.overdue)} overdue` : ''}</div></div>}
        </div>
      </Card>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Total" value={peso(q.total)} />
        <Tile label="Margin" value={pct(margin)} tone={margin != null && margin < 7 ? 'warn' : undefined} note={margin != null && margin < 7 ? 'below 7%' : undefined} />
        <Tile label="Below floor" value={String(below)} note={below ? 'line(s)' : 'none'} tone={below ? 'warn' : undefined} />
      </div>
      <Card title="Lines">
        <div className="divide-y">
          {lines.map((l, i) => (
            <div key={i} className="space-y-0.5 py-2.5">
              <div className="flex justify-between gap-2 text-sm"><span className="font-bold">{l.name}</span><span className="whitespace-nowrap font-bold tabular-nums">{peso(l.total, 2)}</span></div>
              <div className="flex justify-between gap-2 text-xs text-slate-600"><span>{Number(l.qty)} {l.unit} × {peso(l.price, 2)}</span><span className={l.margin != null && Number(l.margin) < 7 ? 'font-bold text-amber-700' : 'font-bold text-emerald-700'}>{l.margin == null ? 'no cost' : `margin ${pct(l.margin)}`}</span></div>
              {l.below_floor && <div className="text-xs text-orange-900">Below the floor {peso(l.floor, 2)}{l.engine ? ` · store price ${peso(l.engine, 2)}` : ''}{l.last ? ` · last sold to this client ${peso(l.last, 2)}` : ''}</div>}
            </div>
          ))}
        </div>
        {q.notes && <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{q.notes}</p>}
      </Card>
      <QuoteActions id={q.id} belowFloor={below} waiting={['prepared', 'reviewed'].includes(q.status)} />
    </ManagerShell>
  );
}
