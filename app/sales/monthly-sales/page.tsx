// app/sales/monthly-sales/page.tsx
import { requireSection } from '@/core/auth/requireSection';
import { listSalesEntries } from '@/shared/sales/service';
import { SalesTable } from '@/shared/sales/SalesTable';
import { NewSalesForm } from '@/shared/sales/NewSalesForm';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { CounterSalesMonth } from '@/modules/sales/storefront/CounterSalesMonth';

export default async function MonthlySalesPage() {
  const profile = await requireSection('sales');
  const monthId = await getCurrentMonthId(profile.user.business_id);
  const rows = await listSalesEntries(monthId);
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Monthly Sales</h2>
      <ActionBar className="mb-4">
        <PopupAction label="+ New sales entry" title="New sales entry">
          <NewSalesForm monthId={monthId} />
        </PopupAction>
      </ActionBar>
      <h3 className="text-base font-semibold text-slate-900 mb-2">Sales entries</h3>
      <SalesTable rows={rows} profile={profile} />
      {/* Build 73 (SF-24b): counter sales appear here too */}
      <CounterSalesMonth year={now.getFullYear()} month={now.getMonth() + 1} />
    </AuthedShell>
  );
}
