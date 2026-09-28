import {requireSection} from '@/core/auth/requireSection';
import {createClient} from '@/core/auth/supabaseServer';
import {AuthedShell} from '@/core/layout/AuthedShell';
import CommissionOperationsManagement from '@/modules/sales/CommissionOperationsManagement';
export default async function SalesCommissionReportPage(){
 const profile=await requireSection('sales'); const db=createClient();
 const [{data:commissions,error:ce},{data:payouts,error:pe},{data:employees,error:ee},{data:summary,error:se}]=await Promise.all([
  db.from('sales_commissions').select('*,employee:employees(employee_no,first_name,last_name),order:sales_orders(order_number)').order('created_at',{ascending:false}),
  db.from('sales_commission_payouts').select('*,employee:employees(employee_no,first_name,last_name)').order('period_start',{ascending:false}),
  db.from('employees').select('id,employee_no,first_name,last_name').eq('employment_status','active').order('last_name'),
  db.from('sales_commission_monthly_summary').select('*,employee:employees(employee_no,first_name,last_name)').order('year',{ascending:false}).order('month',{ascending:false})
 ]);
 const err=ce||pe||ee||se;if(err)throw new Error(err.message);
 return <AuthedShell profile={profile}><div className="mb-5"><h2 className="text-xl font-semibold">Sales / Commission Operations & Reporting</h2><p className="text-sm text-slate-500">Commission workflow, payout batches, employee summaries and monthly reporting.</p></div><CommissionOperationsManagement commissions={commissions??[]} payouts={payouts??[]} employees={employees??[]} summary={summary??[]}/></AuthedShell>
}
