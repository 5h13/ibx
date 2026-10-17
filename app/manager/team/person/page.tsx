// Build 132 — Sales Manager app: one agent's (or counter person's) performance for a month.
import Link from 'next/link';
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { loadPerson } from '@/modules/manager/actions';
import { PersonTarget } from '@/modules/manager/PersonTarget';
import { Bar, Card, Tile, peso, pct, shortDate } from '@/modules/manager/ui';
import { monthFrom } from '@/modules/manager/month';

export const dynamic = 'force-dynamic';

export default async function ManagerPerson(props: { searchParams?: Promise<{ a?: string; u?: string; m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await managerProfile();
  const { year, month, label, prev, next, isCurrent } = monthFrom(sp.m);
  const agent = sp.a || null; const user = agent ? null : sp.u || null;
  const base = `/manager/team/person?${agent ? `a=${agent}` : `u=${user}`}`;
  const p: any = profile.user.business_id && (agent || user) ? await loadPerson(agent, user, year, month) : null;
  if (!p || p.no_store) {
    return <ManagerShell profile={profile} title="Team" back="/manager/team"><Card><p className="text-sm text-slate-600">Choose a store in &quot;Acting as&quot; in the office app, then open a person from Team.</p></Card></ManagerShell>;
  }
  const total = Number(p.total ?? 0);
  const target = p.target == null ? null : Number(p.target);
  const dayShare = (Number(p.days_gone) / Number(p.days_in_month)) * 100;
  const pace = isCurrent && Number(p.days_gone) > 0 ? (total / Number(p.days_gone)) * Number(p.days_in_month) : null;
  const months: any[] = p.months ?? [];
  const max = Math.max(1, ...months.map((x) => Math.max(Number(x.total), Number(x.target ?? 0))));
  const cats: any[] = p.categories ?? [];
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <ManagerShell profile={profile} title={p.name} sub={`${p.kind}${p.phone ? ` · ${p.phone}` : ''}`} back={`/manager/team?m=${ym}`}>
      <div className="flex items-center justify-between rounded-2xl bg-white px-2 py-1 shadow-sm">
        <Link href={`${base}&m=${prev}`} className="flex min-h-[44px] items-center px-3 text-sm font-bold" aria-label="Previous month">‹ Prev</Link>
        <span className="text-sm font-extrabold">{label}</span>
        {next ? <Link href={`${base}&m=${next}`} className="flex min-h-[44px] items-center px-3 text-sm font-bold" aria-label="Next month">Next ›</Link> : <span className="px-3 text-sm text-slate-300">Next ›</span>}
      </div>

      <Card action={<PersonTarget year={year} month={month} agent={agent} user={user} current={p.target_set ? target : null} suggested={p.default == null ? null : Number(p.default)} who={p.name} />} title="This month">
        <div className="text-3xl font-extrabold tabular-nums">{peso(total)}</div>
        <div className="text-xs text-slate-600">
          {target ? `${Math.round((total / target) * 100)}% of ${peso(target)}` : 'No target (no sales history yet)'}
          {pace ? ` · pace says ${peso(pace)} by month end` : ''}
        </div>
        {target ? <Bar value={total} max={target} mark={isCurrent ? dayShare : undefined} /> : null}
        <p className="text-[11px] text-slate-500">
          {p.target_set ? `Target set${p.note_by ? ` by ${p.note_by}` : ''}${p.note_at ? ` on ${shortDate(p.note_at)}` : ''}${p.note ? ` — “${p.note}”` : ''}.` : target ? `Default target: average monthly sales ${peso(p.average)} + 20%.` : ''}
          {p.target_set && p.default ? ` Default would be ${peso(p.default)}.` : ''}
        </p>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Sales" value={p.sales} note={`${p.clients} client${Number(p.clients) === 1 ? '' : 's'}`} />
        <Tile label="Average DR" value={peso(Number(p.sales) ? total / Number(p.sales) : 0)} />
        <Tile label="Margin" value={pct(p.margin)} note={`#${p.rank} of ${p.team_size} this month`} />
      </div>

      <Card title="Last 12 months">
        <div role="img" aria-label={`${p.name}'s sales over the last 12 months`} className="flex h-28 items-end gap-1">
          {months.map((x, i) => (
            <div key={x.m} className="relative flex flex-1 flex-col items-center gap-1">
              {x.target != null && <div className="absolute left-0 right-0 border-t-2 border-dashed border-slate-700/60" style={{ bottom: `${16 + (Number(x.target) / max) * 88}px` }} title={`target ${peso(x.target)}`} />}
              <div className={`w-full rounded-t ${i === months.length - 1 ? 'bg-[rgb(var(--btn))]' : 'bg-slate-400'}`} style={{ height: `${Math.max(2, (Math.max(0, Number(x.total)) / max) * 88)}px` }} title={`${x.label}: ${peso(x.total)}`} />
              <span className="text-[10px] text-slate-600">{x.label}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm"><span>{year} so far</span><span><b className="tabular-nums">{peso(p.ytd)}</b>{p.ytd_margin != null ? ` · margin ${pct(p.ytd_margin)}` : ''}</span></div>
        <p className="text-[11px] text-slate-500">Dashed line: the target set for that month.</p>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Tile label="Open quotes" value={peso(p.quotes?.total)} note={`${p.quotes?.count ?? 0} waiting`} />
        <Tile label="Orders to deliver" value={peso(p.orders?.total)} note={`${p.orders?.count ?? 0} approved`} />
      </div>
      {p.collections && (
        <Tile label="His clients owe" value={peso(p.collections.owed)} note={Number(p.collections.overdue) > 0 ? `${peso(p.collections.overdue)} overdue` : 'nothing overdue'} tone={Number(p.collections.overdue) > 0 ? 'down' : undefined} />
      )}

      <Card title={`Clients (${year})`}>
        {(p.clients_list ?? []).length === 0 && <p className="text-sm text-slate-500">No sales this year.</p>}
        <div className="divide-y">
          {(p.clients_list ?? []).map((c: any) => (
            <Link key={c.id ?? 'walkin'} href={c.id ? `/manager/clients/${c.id}` : '#'} className="flex justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-bold underline decoration-slate-300">{c.name}</span><span className="text-xs text-slate-600">last {shortDate(c.last)}</span></span>
              <span className="text-right"><b className="tabular-nums">{peso(c.total)}</b>{Number(c.overdue) > 0 && <span className="block text-[11px] font-bold text-red-700">{peso(c.overdue)} overdue</span>}</span>
            </Link>
          ))}
        </div>
      </Card>

      {(p.quiet ?? []).length > 0 && (
        <Card title="Quiet clients">
          <p className="text-xs text-slate-600">His clients with no purchase in the last 60 days.</p>
          <div className="divide-y">
            {p.quiet.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/manager/clients/${c.id}`} className="min-w-0 truncate font-bold underline decoration-slate-300">{c.name}</Link>
                <span className="flex items-center gap-2 text-xs text-slate-600">last {shortDate(c.last)}{c.phone && <a href={`tel:${c.phone}`} className="rounded-lg border px-2 py-1 font-bold">Call</a>}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="What he sells (this month)">
        {cats.length === 0 && <p className="text-sm text-slate-500">No sales this month.</p>}
        {cats.map((x) => <div key={x.name} className="flex justify-between text-sm"><span>{x.name}</span><span><b className="tabular-nums">{peso(x.total)}</b> · {total ? Math.round((Number(x.total) / total) * 100) : 0}%{x.margin != null ? ` · ${pct(x.margin)}` : ''}</span></div>)}
      </Card>

      <Card title="Recent sales">
        {(p.recent ?? []).length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <div className="divide-y">
          {(p.recent ?? []).map((r: any, i: number) => (
            <div key={i} className="flex justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><span className="block font-bold">{r.number} · {shortDate(r.date)}</span>
                {r.customer_id ? <Link href={`/manager/clients/${r.customer_id}`} className="block truncate text-xs text-slate-600 underline decoration-slate-300">{r.customer}</Link> : <span className="text-xs text-slate-600">{r.customer}</span>}</span>
              <b className="tabular-nums">{peso(r.total)}</b>
            </div>
          ))}
        </div>
      </Card>
    </ManagerShell>
  );
}
