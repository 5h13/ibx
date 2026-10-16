// Build 127 — Sales Manager app: one client's purchases, what they buy, what they owe.
import Link from 'next/link';
import { displayName } from '@/core/auth/loginEmail';
import { ManagerShell, managerProfile, storeBrand } from '@/modules/manager/ManagerShell';
import { loadClient } from '@/modules/manager/actions';
import { PromiseButton, ShareStatementButton } from '@/modules/manager/ClientActions';
import { Card, Tile, peso, pct, shortDate } from '@/modules/manager/ui';

export const dynamic = 'force-dynamic';

export default async function ManagerClient(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const profile = await managerProfile();
  const [c, brand]: [any, any] = await Promise.all([loadClient(id), storeBrand(profile)]);
  const months: { m: string; total: number }[] = c.months ?? [];
  const max = Math.max(1, ...months.map((x) => Number(x.total)));
  const change = Number(c.prev_month) > 0 ? Math.round(((Number(c.month) - Number(c.prev_month)) / Number(c.prev_month)) * 100) : null;
  const cats: any[] = c.categories ?? [];
  const yearTotal = cats.reduce((s, x) => s + Number(x.total), 0);
  const ar = c.ar ?? { owed: 0, overdue: 0 };
  return (
    <ManagerShell profile={profile} title={c.name} sub={[c.agent ? `Agent ${c.agent}` : 'Counter client', c.terms ? `terms ${c.terms}` : null, c.since ? `since ${shortDate(c.since)}` : null].filter(Boolean).join(' · ')} back="/manager/sales">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="This month" value={peso(c.month)} note={change == null ? undefined : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs last month`} tone={change == null ? undefined : change >= 0 ? 'up' : 'down'} />
        <Tile label="This year" value={peso(c.year)} note={c.year_margin == null ? undefined : `margin ${pct(c.year_margin)}`} />
        <Tile label="Owes" value={peso(ar.owed)} note={Number(ar.overdue) > 0 ? `${peso(ar.overdue)} overdue` : 'nothing overdue'} tone={Number(ar.overdue) > 0 ? 'down' : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {c.phone ? <a href={`tel:${c.phone}`} className="flex min-h-[44px] items-center justify-center rounded-xl border bg-white text-sm font-bold">Call</a> : <span className="flex min-h-[44px] items-center justify-center rounded-xl border bg-white text-sm text-slate-400">No phone</span>}
        <ShareStatementButton className="min-h-[44px] rounded-xl border bg-white text-sm font-bold" data={{ store: brand, client: { name: c.name, contact: c.contact }, invoices: c.invoices ?? [], owed: Number(ar.owed || 0), overdue: Number(ar.overdue || 0), preparedBy: displayName(profile.user) }} />
        <PromiseButton customerId={c.id} suggested={Number(ar.overdue || ar.owed || 0)} />
      </div>
      <Card title="Purchases by month">
        <div role="img" aria-label="Purchases over the last six months" className="flex h-24 items-end gap-2">
          {months.map((x, i) => (
            <div key={x.m} className="flex flex-1 flex-col items-center gap-1">
              <div className={`w-full rounded-t ${i === months.length - 1 ? 'bg-[rgb(var(--btn))]' : 'bg-slate-400'}`} style={{ height: `${Math.max(2, (Math.max(0, Number(x.total)) / max) * 72)}px` }} title={peso(x.total)} />
              <span className="text-[10px] text-slate-600">{x.m}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="What they buy (this year)">
        {cats.length === 0 && <p className="text-sm text-slate-500">No purchases this year.</p>}
        {cats.map((x) => <div key={x.name} className="flex justify-between text-sm"><span>{x.name}</span><span><b className="tabular-nums">{peso(x.total)}</b> · {yearTotal ? Math.round((Number(x.total) / yearTotal) * 100) : 0}%</span></div>)}
        {(c.lapsed ?? []).map((cat: string) => <div key={cat} className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs text-orange-900">No {cat.toLowerCase()} bought in the last 60 days — they used to buy it most months.</div>)}
      </Card>
      {(c.open_quotes ?? []).length > 0 && (
        <Card title="Open quotations">
          {c.open_quotes.map((q: any) => (
            <Link key={q.id} href={`/manager/quotes/${q.id}`} className="flex justify-between text-sm"><span className="underline decoration-slate-300">{q.number} · {shortDate(q.date)}</span><span><b className="tabular-nums">{peso(q.total)}</b> · {q.status}</span></Link>
          ))}
        </Card>
      )}
      <Card title="Recent purchases">
        {(c.recent ?? []).length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <div className="divide-y">
          {(c.recent ?? []).map((r: any, i: number) => (
            <div key={i} className="flex justify-between gap-2 py-2">
              <div className="min-w-0"><div className="text-sm font-bold">{r.number} · {shortDate(r.date)}</div><div className="truncate text-xs text-slate-600">{r.items}</div></div>
              <div className="text-right"><div className="text-sm font-bold tabular-nums">{peso(r.total)}</div><div className={`text-[11px] font-bold ${Number(r.balance) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{Number(r.balance) > 0 ? `${peso(r.balance)} unpaid` : 'paid'}</div></div>
            </div>
          ))}
        </div>
      </Card>
      {(c.promises ?? []).length > 0 && (
        <Card title="Payment promises">
          {c.promises.map((p: any, i: number) => <div key={i} className="flex justify-between text-sm"><span>{shortDate(p.date)}{p.note ? ` · ${p.note}` : ''}</span><b className="tabular-nums">{peso(p.amount)}</b></div>)}
        </Card>
      )}
    </ManagerShell>
  );
}
