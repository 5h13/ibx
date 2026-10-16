// Build 127 — Sales Manager app: Team against monthly targets.
import Link from 'next/link';
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { loadMonth, loadTeam } from '@/modules/manager/actions';
import { TeamTargets } from '@/modules/manager/TeamTargets';
import { monthFrom, monthNav } from '@/modules/manager/month';

export const dynamic = 'force-dynamic';

export default async function ManagerTeam(props: { searchParams?: Promise<{ m?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await managerProfile();
  const { year, month, label, prev, next, isCurrent } = monthFrom(sp.m);
  const [team, m]: [any[], any] = profile.user.business_id ? await Promise.all([loadTeam(year, month), loadMonth(year, month)]) : [[], null];
  const dayShare = m ? (Number(m.days_gone) / Number(m.days_in_month)) * 100 : 0;
  return (
    <ManagerShell profile={profile} title="Team" sub={`${label}${isCurrent && m ? ` · day ${m.days_gone} of ${m.days_in_month}` : ''}`}>
      {monthNav('/manager/team', prev, next, label)}
      {m && <TeamTargets people={team} year={year} month={month} storeTarget={m.target == null ? null : Number(m.target)} storeTotal={Number(m.total)} dayShare={isCurrent ? dayShare : 100} />}
      <p className="text-center text-xs text-slate-500"><Link href="/manager/sales" className="underline">Sales by category and client</Link></p>
    </ManagerShell>
  );
}
