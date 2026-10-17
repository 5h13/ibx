// app/sales/monthly-sales/page.tsx
// Build 130: a month picker — any month can be shown (sales entries and counter sales, including the
// loaded sales history). New sales entries still go to the current month. Build 135: loads on choosing (no Show).
import { requireSection } from '@/core/auth/requireSection';
import { listSalesEntries } from '@/shared/sales/service';
import { SalesTable } from '@/shared/sales/SalesTable';
import { NewSalesForm } from '@/shared/sales/NewSalesForm';
import { getCurrentMonthId, getMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { CounterSalesMonth } from '@/modules/sales/storefront/CounterSalesMonth';
import { MonthPicker } from '@/core/ui/MonthPicker';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default async function MonthlySalesPage(props: { searchParams?: Promise<{ month?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await requireSection('sales', 'sales.reports');
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const [py, pm] = (searchParams?.month ?? '').split('-').map(Number);
  const picked = py > 2000 && pm >= 1 && pm <= 12 && (py < now.getFullYear() || (py === now.getFullYear() && pm <= now.getMonth() + 1));
  const year = picked ? py : now.getFullYear();
  const month = picked ? pm : now.getMonth() + 1;
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
  const shown = `${year}-${String(month).padStart(2, '0')}`;

  const currentMonthId = await getCurrentMonthId(profile.user.business_id);
  const shownMonthId = isCurrent ? currentMonthId
    : profile.user.business_id ? await getMonthId(profile.user.business_id, year, month, false) : null;
  const rows = shownMonthId ? await listSalesEntries(shownMonthId) : [];

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Monthly Sales — {MONTHS[month - 1]} {year}</h2>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <MonthPicker action="/sales/monthly-sales" value={shown} max={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`} className="flex items-center gap-2" />
        {!isCurrent && <a href="/sales/monthly-sales" className="text-slate-500 underline">This month</a>}
      </div>
      {isCurrent && (
        <ActionBar className="mb-4">
          <PopupAction label="+ New sales entry" title="New sales entry">
            <NewSalesForm monthId={currentMonthId} />
          </PopupAction>
        </ActionBar>
      )}
      <h3 className="text-base font-semibold text-slate-900 mb-2">Sales entries</h3>
      <SalesTable rows={rows} profile={profile} />
      {/* Build 73 (SF-24b): counter sales appear here too */}
      <CounterSalesMonth year={year} month={month} />
    </AuthedShell>
  );
}
