import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { BudgetManagement } from '@/modules/finance/budgets/BudgetManagement';
export default async function BudgetsPage(){const profile=await requireSection('finance');const db=createClient();const [{data:budgets,error:e1},{data:lines,error:e2},{data:actuals,error:e3}]=await Promise.all([db.from('finance_budgets').select('*').order('fiscal_year',{ascending:false}).order('version',{ascending:false}),db.from('finance_budget_lines').select('*').order('line_code'),db.from('finance_budget_actuals').select('*').order('month')]);const err=e1||e2||e3;if(err)throw new Error(err.message);return <AuthedShell profile={profile}><BudgetManagement profile={profile} budgets={budgets??[]} lines={lines??[]} actuals={actuals??[]}/></AuthedShell>}
