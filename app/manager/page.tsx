// Build 127 — Sales Manager app: Today.
import Link from 'next/link';
import { ManagerShell, managerProfile, storeBrand } from '@/modules/manager/ManagerShell';
import { displayName } from '@/core/auth/loginEmail';
import { loadAttention, loadToday, runAttentionScan } from '@/modules/manager/actions';
import { AttentionList } from '@/modules/manager/AttentionList';
import { Card, Tile, peso, KIND_LABEL } from '@/modules/manager/ui';
import { createClient } from '@/core/auth/supabaseServer';

async function loadInboxCount() {   // Build 139
  const { data } = await createClient().rpc('shop_inbox_count');
  return Number(data ?? 0);
}

export const dynamic = 'force-dynamic';

export default async function ManagerToday() {
  const profile = await managerProfile();
  if (profile.user.business_id) await runAttentionScan();   // Build 133: send any new urgent alerts for this store
  const [t, att, brand, inbox]: [any, any, any, any] = profile.user.business_id ? await Promise.all([loadToday(), loadAttention(), storeBrand(profile), loadInboxCount()]) : [null, null, null, 0];
  const a = t?.approvals ?? {};
  const total = ['quotes', 'orders', 'prices', 'cancels', 'closings'].reduce((s, k) => s + Number(a[k] ?? 0), 0);
  const vsAvg = t && Number(t.same_day_avg) > 0 ? Math.round(((Number(t.sales_today) - Number(t.same_day_avg)) / Number(t.same_day_avg)) * 100) : null;
  const mtdPct = t?.target ? Math.round((Number(t.mtd) / Number(t.target)) * 100) : null;
  const dayLabel = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <ManagerShell profile={profile} title="Today" counts={total} attention={att ? Number(att.counts?.red ?? 0) + Number(att.counts?.amber ?? 0) : 0}>
      {Number(inbox) > 0 && (
        <Link href="/manager/inbox" className="flex min-h-[56px] items-center gap-3 rounded-xl border-2 border-red-200 bg-white px-4 py-3 shadow-sm">
          <span className="rounded-full bg-red-600 px-2.5 py-1 text-sm font-bold text-white">{inbox}</span>
          <span className="flex-1"><b className="block">Shop Inbox</b><span className="text-sm text-slate-600">{inbox} new request{Number(inbox) === 1 ? '' : 's'} from the online shop</span></span>
          <span aria-hidden="true" className="text-xl text-slate-400">›</span>
        </Link>
      )}
      {att && (
        <Card title={<span>Needs attention{Number(att.counts?.red ?? 0) > 0 && <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">{att.counts.red} urgent</span>}</span>}
          action={<Link href="/manager/settings" className="text-xs font-bold text-[rgb(var(--btn))] underline">Settings</Link>}>
          <AttentionList items={att.items ?? []} snoozed={Number(att.snoozed ?? 0)} me={displayName(profile.user)} store={brand?.name ?? ''} />
        </Card>
      )}
      {t && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile label={`Sales · ${dayLabel}`} value={peso(t.sales_today)} note={vsAvg == null ? 'no earlier weeks yet' : `${vsAvg >= 0 ? '▲' : '▼'} ${Math.abs(vsAvg)}% vs same day avg`} tone={vsAvg == null ? undefined : vsAvg >= 0 ? 'up' : 'down'} />
            <Tile label="Collected today" value={peso(t.collected_today)} note="sales and old balances" />
            <Tile label="Month to date" value={mtdPct == null ? peso(t.mtd) : `${mtdPct}%`} note={t.target ? `${peso(t.mtd)} of ${peso(t.target)}` : <Link href="/manager/team" className="underline">set a target</Link>} />
          </div>

          <Card title="Needs your OK" action={<Link href="/manager/approvals" className="text-sm font-bold text-[rgb(var(--btn))]">See all {total}</Link>}>
            {t.first_approval && (
              <Link href={`/manager/quotes/${t.first_approval.id}`} className="flex min-h-[56px] items-center gap-3 rounded-xl bg-orange-50 p-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-orange-200 text-sm font-extrabold text-orange-900">Q</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{t.first_approval.number} · {t.first_approval.client ?? 'Client'}</span>
                  <span className="block text-xs text-orange-900">{peso(t.first_approval.amount)}{Number(t.first_approval.below_floor) > 0 ? ` · ${t.first_approval.below_floor} line(s) below the floor` : ''}</span></span>
                <span aria-hidden="true" className="text-orange-900">›</span>
              </Link>
            )}
            <div className="grid grid-cols-2 gap-2">
              {[['quotes', 'quote'], ['orders', 'order'], ['prices', 'price'], ['cancels', 'cancel'], ['closings', 'closing']].map(([k, kind]) => (
                <Link key={k} href={`/manager/approvals?kind=${kind}`} className="rounded-xl border p-3">
                  <div className="text-2xl font-extrabold tabular-nums">{a[k] ?? 0}</div>
                  <div className="text-xs text-slate-600">{KIND_LABEL[kind]}</div>
                </Link>
              ))}
            </div>
            {total === 0 && <p className="text-sm text-slate-500">Nothing is waiting for you.</p>}
          </Card>

          <Card title="Team today" action={<Link href="/manager/team" className="text-sm font-bold text-[rgb(var(--btn))]">Team</Link>}>
            {(t.team ?? []).length === 0 && <p className="text-sm text-slate-500">No sales yet today.</p>}
            {(t.team ?? []).map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm"><span>{m.kind} · {m.name}</span><span className="font-bold tabular-nums">{peso(m.total)} · {m.count} sale{m.count === 1 ? '' : 's'}</span></div>
            ))}
            {!t.closing_today && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Daily closing not yet submitted at the counter.</div>}
            {t.closing_today === 'submitted' && <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Daily closing submitted — <Link href="/manager/approvals?kind=closing" className="underline">waiting for you</Link>.</div>}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-xs text-slate-500">Overdue receivables</div>
                <div className={`text-lg font-extrabold ${Number(t.overdue?.amount) > 0 ? 'text-red-700' : 'text-slate-900'}`}>{peso(t.overdue?.amount)} · {t.overdue?.clients ?? 0} client{t.overdue?.clients === 1 ? '' : 's'}</div></div>
              <Link href="/manager/collections" className="rounded-xl bg-[rgb(var(--btn))] px-4 py-2.5 text-sm font-bold text-[rgb(var(--on-btn))]">Follow up</Link>
            </div>
          </Card>
        </>
      )}
    </ManagerShell>
  );
}
