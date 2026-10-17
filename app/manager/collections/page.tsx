// Build 127 — Sales Manager app: Collections — what clients owe, overdue first, with promises.
import Link from 'next/link';
import { displayName } from '@/core/auth/loginEmail';
import { pesoText, smsHref, telHref } from '@/shared/contact';
import { ManagerShell, managerProfile, storeBrand } from '@/modules/manager/ManagerShell';
import { loadCollections } from '@/modules/manager/actions';
import { PromiseButton, ShareStatementButton } from '@/modules/manager/ClientActions';
import { Tile, peso, shortDate } from '@/modules/manager/ui';

export const dynamic = 'force-dynamic';

export default async function ManagerCollections() {
  const profile = await managerProfile();
  const [c, brand]: [any, any] = profile.user.business_id ? await Promise.all([loadCollections(), storeBrand(profile)]) : [null, null];
  const clients: any[] = c?.clients ?? [];
  const overdue = clients.filter((x) => Number(x.overdue) > 0);
  const current = clients.filter((x) => !(Number(x.overdue) > 0));
  const card = (x: any) => (
    <article key={x.id} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex justify-between gap-2">
        <div className="min-w-0"><Link href={`/manager/clients/${x.id}`} className="block truncate text-[15px] font-extrabold underline decoration-slate-300">{x.name}</Link>
          <div className="text-xs text-slate-600">{[x.agent ? `Agent ${x.agent}` : 'Counter', `${x.invoices} invoice${x.invoices === 1 ? '' : 's'}`, x.promise ? `promised ${peso(x.promise.amount)} on ${shortDate(x.promise.date)}` : null].filter(Boolean).join(' · ')}</div></div>
        <div className="text-right"><div className="font-extrabold tabular-nums">{peso(x.owed)}</div>
          {Number(x.overdue) > 0 ? <div className="text-xs font-bold text-red-700">{peso(x.overdue)} · {x.days} day{x.days === 1 ? '' : 's'} late</div> : <div className="text-xs text-slate-500">not due yet</div>}</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {x.phone ? (
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border">
            <a href={telHref(x.phone)} className="flex min-h-[44px] items-center justify-center text-sm font-bold">Call</a>
            <a href={smsHref(x.phone, `Good day${x.contact ? ` ${x.contact}` : ''}! This is ${displayName(profile.user)} of ${brand?.name ?? 'the store'}. A friendly reminder: your balance with us is ${pesoText(x.owed)}${Number(x.overdue) > 0 ? `, of which ${pesoText(x.overdue)} is overdue` : ''}. Thank you!`)} className="flex min-h-[44px] items-center justify-center border-l text-sm font-bold">Text</a>
          </div>
        ) : <span className="flex min-h-[44px] items-center justify-center rounded-xl border text-sm text-slate-400">No phone</span>}
        <ShareStatementButton data={{ store: brand, client: { name: x.name, contact: x.contact }, invoices: x.open_invoices ?? [], owed: Number(x.owed), overdue: Number(x.overdue || 0), preparedBy: displayName(profile.user) }} />
        <PromiseButton customerId={x.id} suggested={Number(x.overdue || x.owed)} />
      </div>
    </article>
  );
  return (
    <ManagerShell profile={profile} title="Collections">
      {c && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Owed to us" value={peso(c.owed)} />
            <Tile label="Overdue" value={peso(c.overdue)} tone={Number(c.overdue) > 0 ? 'down' : undefined} note={`${overdue.length} client${overdue.length === 1 ? '' : 's'}`} />
            <Tile label="Checks this week" value={peso(c.checks_week?.total)} note={`${c.checks_week?.count ?? 0} check(s) dated`} />
          </div>
          {overdue.length > 0 && <h2 className="px-1 text-sm font-extrabold text-slate-600">Overdue, oldest first</h2>}
          {overdue.map(card)}
          {current.length > 0 && <h2 className="px-1 pt-1 text-sm font-extrabold text-slate-600">Not yet due</h2>}
          {current.map(card)}
          {clients.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">No client owes anything.</div>}
        </>
      )}
    </ManagerShell>
  );
}
