// Build 132 — the agent app's Home: this month's sales against the target (and the manager's note),
// the pace and what is needed per day, the last 6 months, clients to follow up, overdue balances,
// open quotes and orders, recent sales. Each store's figures are separate (the store picked at the top).
import Link from 'next/link';
import { peso } from './format';
import { smsHref, telHref } from '@/shared/contact';

const w = (n: unknown) => `₱${Math.round(Number(n || 0)).toLocaleString('en-PH')}`;   // whole pesos for the summary figures

const d = (x: string | null | undefined) => (x ? new Date(`${String(x).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : '—');

export function AgentHome({ h, b }: { h: any; b: string }) {
  const total = Number(h.total ?? 0);
  const target = h.target == null ? null : Number(h.target);
  const share = target ? Math.round((total / target) * 100) : null;
  const dayShare = (Number(h.days_gone) / Number(h.days_in_month)) * 100;
  const shouldBe = target ? (target * Number(h.days_gone)) / Number(h.days_in_month) : null;
  const left = target ? Math.max(0, target - total) : null;
  const perDay = left && Number(h.days_left) > 0 ? left / (Number(h.days_left) + 1) : left;
  const pace = Number(h.days_gone) > 0 ? (total / Number(h.days_gone)) * Number(h.days_in_month) : 0;
  const months: any[] = h.months ?? [];
  const max = Math.max(1, ...months.map((x) => Math.max(Number(x.total), Number(x.target ?? 0))));
  const q = (path: string) => `${path}?b=${b}`;
  const ahead = shouldBe != null && total >= shouldBe;
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-slate-600">My sales · {h.month}</h2><span className="text-xs text-slate-500">{h.days_left} day{Number(h.days_left) === 1 ? '' : 's'} left</span></div>
        <div className="text-3xl font-extrabold tabular-nums">{w(total)}</div>
        {target ? (
          <>
            <div className="text-sm text-slate-700">{share}% of my {w(target)} target</div>
            <div className="relative h-3 overflow-hidden rounded-full bg-slate-200">
              <div className="h-3 rounded-full bg-[rgb(var(--btn))]" style={{ width: `${Math.min(100, share ?? 0)}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-slate-900/70" style={{ left: `${Math.min(100, dayShare)}%` }} />
            </div>
            <div className={`rounded-lg px-3 py-2 text-sm ${ahead ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
              {left === 0 ? 'Target reached — well done!' : ahead
                ? `Ahead of schedule. ${w(left)} to go, about ${w(perDay)} a day.`
                : `Behind by ${w((shouldBe ?? 0) - total)} for today. ${w(left)} to go — about ${w(perDay)} a day.`}
              {' '}At this pace: {w(pace)} by month end.
            </div>
            <p className="text-[11px] text-slate-500">The dark mark is where you should be today.</p>
          </>
        ) : <p className="text-sm text-slate-500">No target for this month yet.</p>}
        {h.target_set && h.note
          ? <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><div className="text-[11px] font-semibold text-slate-500">Note from {h.note_by ?? 'the Sales Manager'}{h.note_at ? ` · ${d(h.note_at)}` : ''}</div>{h.note}</div>
          : target ? <p className="text-[11px] text-slate-500">Target: your average monthly sales ({w(h.average)}) + 20%.</p> : null}
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <div><div className="text-lg font-bold tabular-nums">{w(h.today)}</div><div className="text-[11px] text-slate-500">today</div></div>
          <div><div className="text-lg font-bold tabular-nums">{h.sales}</div><div className="text-[11px] text-slate-500">sales</div></div>
          <div><div className="text-lg font-bold tabular-nums">{h.clients_bought}</div><div className="text-[11px] text-slate-500">clients bought</div></div>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">Last 6 months</h2>
        <div role="img" aria-label="My sales over the last six months" className="flex h-28 items-end gap-2">
          {months.map((x, i) => (
            <div key={x.label + i} className="relative flex flex-1 flex-col items-center gap-1">
              {x.target != null && <div className="absolute left-0 right-0 border-t-2 border-dashed border-slate-700/60" style={{ bottom: `${16 + (Number(x.target) / max) * 88}px` }} />}
              <div className="w-full text-center text-[10px] tabular-nums text-slate-600">{Number(x.total) >= 1000 ? `${Math.round(Number(x.total) / 1000)}k` : Math.round(Number(x.total))}</div>
              <div className={`w-full rounded-t ${i === months.length - 1 ? 'bg-[rgb(var(--btn))]' : 'bg-slate-400'}`} style={{ height: `${Math.max(2, (Math.max(0, Number(x.total)) / max) * 76)}px` }} />
              <span className="text-[10px] text-slate-600">{x.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">Dashed line: the target set for that month.</p>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Link href={q('/agent/quotations')} className="rounded-2xl bg-white p-3 shadow-sm"><div className="text-[11px] text-slate-500">Open quotes</div><div className="text-lg font-bold tabular-nums">{w(h.quotes?.total)}</div><div className="text-[11px] text-slate-500">{h.quotes?.count ?? 0} waiting</div></Link>
        <Link href={q('/agent/orders')} className="rounded-2xl bg-white p-3 shadow-sm"><div className="text-[11px] text-slate-500">Orders to deliver</div><div className="text-lg font-bold tabular-nums">{w(h.orders?.total)}</div><div className="text-[11px] text-slate-500">{h.orders?.count ?? 0} approved</div></Link>
      </div>

      {Number(h.overdue) > 0 && (
        <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-slate-600">To collect</h2><span className="text-sm font-bold text-red-700">{w(h.overdue)} overdue</span></div>
          <div className="divide-y">
            {(h.overdue_clients ?? []).slice(0, 6).map((c: any) => (
              <div key={c.id} className="flex justify-between py-1.5 text-sm"><span className="truncate">{c.name}</span><span className="tabular-nums text-red-700">{w(c.overdue)} <span className="text-[11px] text-slate-500">since {d(c.oldest_due)}</span></span></div>
            ))}
          </div>
          <Link href={q('/agent/payments')} className="block text-center text-sm font-semibold underline">Report a payment</Link>
        </section>
      )}

      {(h.quiet ?? []).length > 0 && (
        <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-slate-600">Clients to call</h2><span className="text-xs text-slate-500">{h.quiet_count} quiet for 60+ days</span></div>
          <div className="divide-y">
            {h.quiet.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="min-w-0 truncate">{c.name} <span className="text-[11px] text-slate-500">· last {d(c.last)}</span></span>
                {c.phone && <span className="flex flex-none gap-1.5"><a href={telHref(c.phone)} className="rounded-lg border px-2.5 py-1 text-xs font-bold">Call</a><a href={smsHref(c.phone, `Good day! It's been a while — anything you need for your next jobs? I'm happy to send you a quotation.`)} className="rounded-lg border px-2.5 py-1 text-xs font-bold">Text</a></span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-slate-600">Recent sales</h2><Link href={q('/agent/clients')} className="text-xs underline">My clients ({h.clients})</Link></div>
        {(h.recent ?? []).length === 0 && <p className="text-sm text-slate-500">No sales yet in this store.</p>}
        <div className="divide-y">
          {(h.recent ?? []).map((r: any, i: number) => (
            <div key={i} className="flex justify-between gap-2 py-1.5 text-sm"><span className="min-w-0 truncate">{r.customer} <span className="text-[11px] text-slate-500">· {r.number} · {d(r.date)}</span></span><b className="tabular-nums">{peso(r.total)}</b></div>
          ))}
        </div>
      </section>
    </div>
  );
}
