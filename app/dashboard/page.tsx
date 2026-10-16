// app/dashboard/page.tsx
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { DashboardView, sumPeriod, type Period, type Today } from '@/modules/dashboard/DashboardView';
import { AutoApprovalsCard, WarningsCard } from '@/modules/dashboard/AutoApprovalsCard';

// Build 73 (SF-28): the Dashboard has three layers (today at the counter, a month, quarters and the year); see
// DashboardView. The database decides which stores the caller sees and what money figures they may see.
// Build 110: the screen moved to src/modules/dashboard/DashboardView.tsx; this file loads the figures.

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export default async function DashboardPage(props: { searchParams?: Promise<{ month?: string; year?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.user.role === 'agent') redirect('/agent');   // Build 91: agents land on their portal
  const supabase = createClient();

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const [my, mm] = (searchParams?.month ?? '').split('-').map(Number);
  const mYear = my > 2000 && mm >= 1 && mm <= 12 ? my : now.getFullYear();
  const mMonth = my > 2000 && mm >= 1 && mm <= 12 ? mm : now.getMonth() + 1;
  const yParam = Number(searchParams?.year);
  const year = yParam > 2000 && yParam < 2100 ? yParam : now.getFullYear();

  const period = async (from: string, to: string) => {
    const { data, error } = await supabase.rpc('dashboard_period', { p_from: from, p_to: to });
    return { rows: (data ?? []) as Period[], error: error?.message };
  };
  const isAdmin = profile.user.role === 'super_admin' || profile.user.role === 'business_admin';
  const autoRes = isAdmin ? await supabase.rpc('workflow_recent_auto_approvals', { p_days: 7 }) : { data: [] };
  const warnRes = isAdmin ? await supabase.rpc('workflow_recent_warnings', { p_days: 7 }) : { data: [] };
  const [todayRes, monthRes, ...qy] = await Promise.all([
    supabase.rpc('dashboard_today'),
    period(iso(mYear, mMonth, 1), iso(mYear, mMonth, lastDay(mYear, mMonth))),
    ...[1, 2, 3, 4].map((q) => period(iso(year, q * 3 - 2, 1), iso(year, q * 3, lastDay(year, q * 3)))),
    period(iso(year, 1, 1), iso(year, 12, 31)),
  ]);
  const today = (todayRes.data ?? []) as Today[];
  const month = monthRes.rows;
  const quarters = qy.slice(0, 4).map((r) => sumPeriod(r.rows));
  const yearTotal = sumPeriod(qy[4].rows);
  const yearByStore = qy[4].rows;
  const asOf = today[0]?.as_of
    ? new Date(today[0].as_of).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
    : null;
  const err = todayRes.error?.message || monthRes.error;
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const shownMonth = `${mYear}-${String(mMonth).padStart(2, '0')}`;

  return (
    <AuthedShell profile={profile}>
      <DashboardView today={today} month={month} quarters={quarters} yearTotal={yearTotal} yearByStore={yearByStore}
        mYear={mYear} mMonth={mMonth} year={year} nowYear={now.getFullYear()} thisMonth={thisMonth} shownMonth={shownMonth} asOf={asOf} err={err} />
      <WarningsCard rows={(warnRes.data ?? []) as any[]} />
      <AutoApprovalsCard rows={(autoRes.data ?? []) as any[]} />
    </AuthedShell>
  );
}
