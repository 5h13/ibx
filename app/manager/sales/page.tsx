// Build 127 — Sales Manager app: the month's sales (target, daily, by category / client / channel).
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { loadMonth } from '@/modules/manager/actions';
import { Breakdown } from '@/modules/manager/Breakdown';
import { Bar, Card, Tile, peso } from '@/modules/manager/ui';
import { monthFrom, monthNav } from '@/modules/manager/month';

export const dynamic = 'force-dynamic';

export default async function ManagerSales(props: { searchParams?: Promise<{ m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await managerProfile();
  const { year, month, label, prev, next, isCurrent } = monthFrom(sp.m);
  const m: any = profile.user.business_id ? await loadMonth(year, month) : null;
  const days: { d: string; total: number }[] = m?.days ?? [];
  const max = Math.max(1, ...days.map((d) => Number(d.total)));
  const total = Number(m?.total ?? 0);
  const target = m?.target == null ? null : Number(m.target);
  const dayShare = m ? (Number(m.days_gone) / Number(m.days_in_month)) * 100 : 0;
  const pace = m && isCurrent && Number(m.days_gone) > 0 ? (total / Number(m.days_gone)) * Number(m.days_in_month) : null;
  return (
    <ManagerShell profile={profile} title="Sales" sub={label}>
      {monthNav('/manager/sales', prev, next, label)}
      {m && (
        <>
          <Card>
            <div className="text-3xl font-extrabold tabular-nums">{peso(total)}</div>
            <div className="text-xs text-slate-600">{target ? `${Math.round((total / target) * 100)}% of ${peso(target)}` : 'No target for this month'}{pace ? ` · pace says ${peso(pace)} by month end` : ''}</div>
            {target ? <Bar value={total} max={target} mark={isCurrent ? dayShare : undefined} /> : null}
          </Card>
          <Card title="Daily sales">
            <div role="img" aria-label={`Daily sales for ${label}`} className="flex h-24 items-end gap-[3px]">
              {days.map((d, i) => <div key={d.d} title={`${d.d}: ${peso(d.total)}`} className={`flex-1 rounded-t ${i === days.length - 1 && isCurrent ? 'bg-[rgb(var(--btn))]' : Number(d.total) > 0 ? 'bg-slate-400' : 'bg-slate-200'}`} style={{ height: `${Math.max(2, (Math.max(0, Number(d.total)) / max) * 96)}px` }} />)}
            </div>
            <div className="flex justify-between text-[11px] text-slate-500"><span>{days[0]?.d?.slice(8)} </span><span>{days[days.length - 1]?.d?.slice(8)}</span></div>
          </Card>
          <Breakdown categories={m.by_category ?? []} clients={m.by_client ?? []} channels={m.by_channel ?? []} total={total} margin={m.margin == null ? null : Number(m.margin)} />
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Open quotes" value={peso(m.open_quotes?.total)} note={`${m.open_quotes?.count ?? 0} quotes · ${m.open_quotes?.older7 ?? 0} older than 7 days`} />
            <Tile label="Orders to deliver" value={peso(m.orders_open?.total)} note={`${m.orders_open?.count ?? 0} approved orders`} />
          </div>
        </>
      )}
    </ManagerShell>
  );
}
