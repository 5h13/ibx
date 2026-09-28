// app/sales/monthly-sales/page.tsx
import { requireSection } from '@/core/auth/requireSection';
import { listSalesEntries } from '@/shared/sales/service';
import { SalesTable } from '@/shared/sales/SalesTable';
import { NewSalesForm } from '@/shared/sales/NewSalesForm';
import { getCurrentMonthId } from '@/core/utils/currentMonth';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';

export default async function MonthlySalesPage() {
  const profile = await requireSection('sales');
  const monthId = await getCurrentMonthId(profile.user.business_id);
  const rows = await listSalesEntries(monthId);

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-4">Monthly Sales</h2>
      <ActionBar className="mb-4">
        <PopupAction label="+ New sales entry" title="New sales entry">
          <NewSalesForm monthId={monthId} />
        </PopupAction>
      </ActionBar>
      <SalesTable rows={rows} profile={profile} />
    </AuthedShell>
  );
}
