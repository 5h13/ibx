import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { CostCenterManagement } from '@/modules/finance/cost-centers/CostCenterManagement';
// CC-01/CC-04/CC-05: reads now go through the session-scoped client so the
// restrictive business-isolation RLS A001 already put on finance_cost_centers
// (and every table below) actually applies — the prior createAdminClient()
// (service-role, bypasses RLS) would have shown every business's cost
// centers and expenses to any viewer, regardless of A001.
export default async function CostCentersPage(){
  const profile=await requireSection('finance');
  const db=createClient();
  const [{data:centers,error},{data:actuals,error:ae},{data:recovery,error:re}]=await Promise.all([
    db.from('finance_cost_centers').select('*').order('name'),
    db.from('expenses').select('cost_center_id,amount,month:months(year,month)').not('cost_center_id','is',null),
    db.from('finance_catalog_pricing_recovery').select('period_start,gross_pricing_recovery'),
  ]);
  if(error) throw error; if(ae) throw ae; if(re) throw re;
  return <AuthedShell profile={profile}><CostCenterManagement centers={centers||[]} actuals={actuals||[]} recovery={recovery||[]}/></AuthedShell>
}
