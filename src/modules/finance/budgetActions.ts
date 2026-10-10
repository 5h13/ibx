'use server';
import {hasFunction} from '@/core/auth/functions';
import { appError } from '@/core/errors/appError';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { applyScenario, MONTHS, sum, type BudgetAction, type BudgetLine } from './budgets/budgetMath';
import { looksLikeXlsx, readXlsxRows } from './procurement/xlsxReader';
function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
function req(fd:FormData,k:string){const v=String(fd.get(k)??'').trim();if(!v)throw appError(`${k.replaceAll('_',' ')} is required.`);return v}
function opt(fd:FormData,k:string){const v=String(fd.get(k)??'').trim();return v||null}
async function finance(){const p=await getSessionProfile();if(!p?.user.is_active)throw appError('Authentication required.');if(!isAdminTier(p)&&p.user.role!=='finance'&&!p.access.some(a=>a.section_code==='finance'))throw appError('Finance access required.');/* Build 90 */if(!hasFunction(p,'finance.budgets'))throw appError('Your access does not include this function.');return p}
async function audit(actor:string,id:string,table:string,action:string,detail:Record<string,unknown>){const {error}=await createClient().from('audit_log').insert({actor_id:actor,entity_table:table,entity_id:id,action,detail});if(error)throw appError(error.message)}
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export async function createBudgetAction(fd:FormData){const p=await finance(),db=createClient();const {data,error}=await db.from('finance_budgets').insert({...biz(p),budget_code:req(fd,'budget_code'),name:req(fd,'name'),fiscal_year:Number(req(fd,'fiscal_year')),scenario:req(fd,'scenario')||'budget',version:Number(fd.get('version')||1),notes:opt(fd,'notes'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create budget.');await audit(p.user.id,data.id,'finance_budgets','budget_created',{});revalidatePath('/finance/budgets')}
export async function addBudgetLineAction(budgetId:string,fd:FormData){const p=await finance(),db=createClient();const row:any={...biz(p),budget_id:budgetId,line_code:req(fd,'line_code'),account_name:req(fd,'account_name'),department:opt(fd,'department'),category:opt(fd,'category'),notes:opt(fd,'notes')};for(const m of months){row[`${m}_budget`]=Number(fd.get(`${m}_budget`)||0);row[`${m}_forecast`]=Number(fd.get(`${m}_forecast`)||0)}const {data,error}=await db.from('finance_budget_lines').insert(row).select('id').single();if(error||!data)throw appError(error?.message||'Unable to add budget line.');await db.rpc('recalculate_finance_budget_totals',{p_budget_id:budgetId});await audit(p.user.id,data.id,'finance_budget_lines','budget_line_created',{budget_id:budgetId});revalidatePath('/finance/budgets')}
export async function updateBudgetLineAction(id:string,fd:FormData){const p=await finance(),db=createClient();const row:any={account_name:req(fd,'account_name'),department:opt(fd,'department'),category:opt(fd,'category'),notes:opt(fd,'notes'),updated_at:new Date().toISOString()};for(const m of months){row[`${m}_budget`]=Number(fd.get(`${m}_budget`)||0);row[`${m}_forecast`]=Number(fd.get(`${m}_forecast`)||0)}const {data,error}=await db.from('finance_budget_lines').update(row).eq('id',id).select('budget_id').single();if(error||!data)throw appError(error?.message||'Unable to update budget line.');await db.rpc('recalculate_finance_budget_totals',{p_budget_id:data.budget_id});await audit(p.user.id,id,'finance_budget_lines','budget_line_updated',{});revalidatePath('/finance/budgets')}
export async function deleteBudgetLineAction(id:string){const p=await finance(),db=createClient();const {data}=await db.from('finance_budget_lines').select('budget_id').eq('id',id).single();if(!data)throw appError('Budget line not found.');const {error}=await db.from('finance_budget_lines').delete().eq('id',id);if(error)throw appError(error.message);await db.rpc('recalculate_finance_budget_totals',{p_budget_id:data.budget_id});await audit(p.user.id,id,'finance_budget_lines','budget_line_deleted',{});revalidatePath('/finance/budgets')}
export async function prepareBudgetAction(id:string){const p=await finance(),db=createClient();const {error}=await db.from('finance_budgets').update({status:'prepared',prepared_by:p.user.id,prepared_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('status','draft');if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budgets','prepared',{});revalidatePath('/finance/budgets');revalidatePath('/approvals')}
export async function reviewBudgetAction(id:string,accept:boolean){const p=await finance(),db=createClient();const {error}=await db.from('finance_budgets').update({status:accept?'reviewed':'draft',reviewed_by:accept?p.user.id:null,reviewed_at:accept?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',id).eq('status','prepared');if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budgets',accept?'reviewed':'returned',{});revalidatePath('/finance/budgets');revalidatePath('/approvals')}
export async function approveBudgetAction(id:string){const p=await finance(),db=createClient();const {error}=await db.from('finance_budgets').update({status:'approved',approved_by:p.user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('status','reviewed');if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budgets','approved',{});revalidatePath('/finance/budgets');revalidatePath('/approvals')}
export async function closeBudgetAction(id:string){const p=await finance(),db=createClient();const {error}=await db.from('finance_budgets').update({status:'closed',closed_by:p.user.id,closed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('status','approved');if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budgets','closed',{});revalidatePath('/finance/budgets')}
export async function saveActualAction(lineId:string,year:number,month:number,amount:number,sourceModule?:string){const p=await finance(),db=createClient();if(month<1||month>12)throw appError('Invalid month.');const {data:line}=await db.from('finance_budget_lines').select('budget_id').eq('id',lineId).single();if(!line)throw appError('Budget line not found.');const {error}=await db.from('finance_budget_actuals').upsert({budget_line_id:lineId,fiscal_year:year,month,actual_amount:amount,source_module:sourceModule||null,recorded_by:p.user.id,updated_at:new Date().toISOString()},{onConflict:'budget_line_id,month'});if(error)throw appError(error.message);await audit(p.user.id,lineId,'finance_budget_actuals','actual_saved',{year,month,amount});revalidatePath('/finance/budgets')}

// ---------------------------------------------------------------- Build 89 (BUD-01)
const num=(v:unknown)=>{const n=Number(v);if(!Number.isFinite(n))throw appError('Enter a valid amount.');return Math.round(n*100)/100;};
/** A new budget pre-filled from a year's actuals (one line per expense category, plus sales, cost of sales, payroll). */
export async function createBudgetFromActualsAction(input:{year:number;base_year:number;name?:string;baseline:'same_month'|'average'}){await finance();const {data,error}=await createClient().rpc('budget_create_from_actuals',{p_year:input.year,p_base_year:input.base_year,p_name:input.name??null,p_baseline:input.baseline});if(error)throw appError(error.message);revalidatePath('/finance/budgets');return data as string;}
/** Edit a line: name, timing (monthly / yearly accrued / one-time), yearly amount and pay month, the 12 months, note. */
export async function saveBudgetLineAction(id:string,input:{account_name:string;timing:'monthly'|'yearly'|'one_time';annual_amount?:number|null;pay_month?:number|null;months:number[];notes?:string}){
  const p=await finance(),db=createClient();if(!input.account_name?.trim())throw appError('Enter the line name.');
  const row:any={account_name:input.account_name.trim(),timing:input.timing,notes:input.notes?.trim()||null,updated_at:new Date().toISOString()};
  if(input.timing==='yearly'){const a=num(input.annual_amount??0);if(!(a>0))throw appError('Enter the yearly amount.');const pm=Number(input.pay_month||1);if(pm<1||pm>12)throw appError('Choose the month it is paid.');row.annual_amount=a;row.pay_month=pm;const each=Math.round(a/12*100)/100;MONTHS.forEach((m,i)=>{row[`${m}_budget`]=i===11?Math.round((a-each*11)*100)/100:each;});}
  else{row.annual_amount=null;row.pay_month=null;if(input.months.length!==12)throw appError('Twelve months are needed.');MONTHS.forEach((m,i)=>{row[`${m}_budget`]=num(input.months[i]||0);});}
  const {data,error}=await db.from('finance_budget_lines').update(row).eq('id',id).select('budget_id').single();if(error||!data)throw appError(error?.message||'Line not found.');
  await db.rpc('recalculate_finance_budget_totals',{p_budget_id:data.budget_id});await audit(p.user.id,id,'finance_budget_lines','budget_line_updated',{timing:input.timing});revalidatePath('/finance/budgets');}
export async function addCustomBudgetLineAction(budgetId:string,input:{account_name:string;line_type:'revenue'|'cogs'|'expense';category_id?:string|null;monthly:number}){
  const p=await finance(),db=createClient();if(!input.account_name?.trim())throw appError('Enter the line name.');
  const {count}=await db.from('finance_budget_lines').select('id',{count:'exact',head:true}).eq('budget_id',budgetId);
  const row:any={...biz(p),budget_id:budgetId,line_code:`NEW-${String((count??0)+1).padStart(3,'0')}`,account_name:input.account_name.trim(),line_type:input.line_type,category_id:input.category_id||null,
    line_key:input.category_id?`EXP:${input.category_id}`:null,category:input.line_type==='revenue'?'Sales':input.line_type==='cogs'?'Cost of sales':'Expenses',timing:'monthly',sort_order:900+(count??0),base_months:Array(12).fill(0)};
  MONTHS.forEach((m)=>{row[`${m}_budget`]=num(input.monthly||0);});
  const {data,error}=await db.from('finance_budget_lines').insert(row).select('id').single();if(error||!data)throw appError(error?.message||'Unable to add the line.');
  await db.rpc('recalculate_finance_budget_totals',{p_budget_id:budgetId});await audit(p.user.id,data.id,'finance_budget_lines','budget_line_created',{budget_id:budgetId});revalidatePath('/finance/budgets');}
export async function addScenarioAction(budgetId:string,input:{name:string;description?:string;copy_from?:string|null}){
  const p=await finance(),db=createClient();if(!input.name?.trim())throw appError('Name the scenario.');
  const {data,error}=await db.from('finance_budget_scenarios').insert({...biz(p),budget_id:budgetId,name:input.name.trim(),description:input.description?.trim()||null,created_by:p.user.id}).select('id').single();
  if(error||!data)throw appError(error?.message||'Unable to add the scenario.');
  if(input.copy_from){const {data:acts}=await db.from('finance_budget_actions').select('*').eq('scenario_id',input.copy_from);
    if(acts?.length){const {error:ce}=await db.from('finance_budget_actions').insert(acts.map(({id,created_at,updated_at,scenario_id,...a}:any)=>({...a,scenario_id:data.id,status:'planned',created_by:p.user.id})));if(ce)throw appError(ce.message);}}
  await audit(p.user.id,data.id,'finance_budget_scenarios','budget_scenario_created',{budget_id:budgetId});revalidatePath('/finance/budgets');return data.id as string;}
export async function deleteScenarioAction(id:string){const p=await finance(),db=createClient();const {data}=await db.from('finance_budget_scenarios').select('is_base').eq('id',id).single();if(data?.is_base)throw appError('The base scenario stays.');const {error}=await db.from('finance_budget_scenarios').delete().eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budget_scenarios','budget_scenario_deleted',{});revalidatePath('/finance/budgets');}
export async function saveBudgetActionAction(id:string|null,input:{scenario_id:string;title:string;target:'line'|'all_revenue'|'all_expense';budget_line_id?:string|null;change_kind:'percent'|'amount';value:number;start_month:number;end_month:number;cogs_follows?:boolean;owner?:string;notes?:string}){
  const p=await finance(),db=createClient();if(!input.title?.trim())throw appError('Describe the action.');if(input.target==='line'&&!input.budget_line_id)throw appError('Choose the budget line it changes.');
  if(input.end_month<input.start_month)throw appError('The end month is before the start month.');
  const row:any={...biz(p),scenario_id:input.scenario_id,title:input.title.trim(),target:input.target,budget_line_id:input.target==='line'?input.budget_line_id:null,change_kind:input.change_kind,value:num(input.value),
    start_month:input.start_month,end_month:input.end_month,cogs_follows:input.cogs_follows??true,owner:input.owner?.trim()||null,notes:input.notes?.trim()||null,updated_at:new Date().toISOString()};
  const q=id?db.from('finance_budget_actions').update(row).eq('id',id):db.from('finance_budget_actions').insert({...row,created_by:p.user.id});
  const {error}=await q;if(error)throw appError(error.message);await audit(p.user.id,id??input.scenario_id,'finance_budget_actions',id?'budget_action_updated':'budget_action_added',{title:row.title});revalidatePath('/finance/budgets');}
export async function setBudgetActionStatusAction(id:string,status:'planned'|'in_progress'|'done'|'dropped'){const p=await finance(),db=createClient();const {error}=await db.from('finance_budget_actions').update({status,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budget_actions','budget_action_status',{status});revalidatePath('/finance/budgets');}
export async function deleteBudgetActionAction(id:string){const p=await finance(),db=createClient();const {error}=await db.from('finance_budget_actions').delete().eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_budget_actions','budget_action_deleted',{});revalidatePath('/finance/budgets');}
/** Business Admin approves the reviewed budget with the chosen scenario. */
export async function approveBudgetScenarioAction(budgetId:string,scenarioId:string){const p=await finance(),db=createClient();if(!isAdminTier(p))throw appError('A Business Admin approves budgets.');
  const {data,error}=await db.from('finance_budgets').update({status:'approved',approved_by:p.user.id,approved_at:new Date().toISOString(),approved_scenario_id:scenarioId,updated_at:new Date().toISOString()}).eq('id',budgetId).eq('status','reviewed').select('id');
  if(error)throw appError(error.message);if(!data?.length)throw appError('Only a reviewed budget can be approved (Finance prepares, then reviews it).');
  await audit(p.user.id,budgetId,'finance_budgets','approved',{scenario_id:scenarioId});revalidatePath('/finance/budgets');}
/** Approved budget: create the accrual schedules (Expenses) for its yearly lines, from the approved scenario's amounts. */
export async function createBudgetAccrualsAction(budgetId:string){const p=await finance(),db=createClient();
  const {data:b}=await db.from('finance_budgets').select('id,status,fiscal_year,approved_scenario_id').eq('id',budgetId).single();if(!b||b.status!=='approved')throw appError('Approve the budget first.');
  const [{data:lines},{data:acts}]=await Promise.all([db.from('finance_budget_lines').select('*').eq('budget_id',budgetId),b.approved_scenario_id?db.from('finance_budget_actions').select('*').eq('scenario_id',b.approved_scenario_id):Promise.resolve({data:[]})]);
  const L=(lines??[]) as BudgetLine[];const vals=applyScenario(L,(acts??[]) as BudgetAction[]);let n=0;const skipped:string[]=[];
  // Build 89a: with payroll in the app, the month-end run already sets aside 13th month from payroll — no second accrual
  const {count:payrollRuns}=await db.from('payroll_runs').select('id',{count:'exact',head:true}).in('status',['approved','posted']);
  for(const l of L.filter(x=>x.timing==='yearly'&&!x.accrual_schedule_id)){
    if((l.gl_account_code==='5110'||l.line_key==='THIRTEENTH')&&(payrollRuns??0)>0){skipped.push(`${l.account_name} (13th month is set aside from payroll by the month-end run)`);continue;}
    if(!l.category_id){skipped.push(`${l.account_name} (no expense category)`);continue;}
    const total=sum(vals.get(l.id)??[]);if(!(total>0))continue;
    const {data:sid,error}=await db.rpc('expense_accrual_create',{p_description:`${l.account_name} ${b.fiscal_year} (budget)`,p_category:l.category_id,p_total:total,p_months:12,p_start:`${b.fiscal_year}-01-01`});
    if(error)throw appError(error.message);
    const {error:ue}=await db.from('finance_budget_lines').update({accrual_schedule_id:sid}).eq('id',l.id);if(ue)throw appError(ue.message);n++;}
  await audit(p.user.id,budgetId,'finance_budgets','budget_accruals_created',{count:n,skipped});revalidatePath('/finance/budgets');
  return {count:n,skipped};}

// ---------------------------------------------------------------- Build 89a: import from Excel
/** Read an exported (and edited) budget workbook back into a draft budget: rows with a known Line code are updated,
 *  rows without a code are added as new lines; lines not in the file are left as they are. */
export async function importBudgetAction(budgetId:string,fd:FormData){
  const p=await finance(),db=createClient();const file=fd.get('file');
  if(!(file instanceof File)||!file.size)throw appError('Choose the Excel file (.xlsx) exported from this budget.');
  const buf=await file.arrayBuffer();if(!(/\.xlsx$/i.test(file.name)||looksLikeXlsx(buf)))throw appError('Use the Excel workbook (.xlsx) from "Export to Excel".');
  let rows:string[][];try{rows=readXlsxRows(buf);}catch(e:any){throw appError(`The Excel file could not be read: ${e?.message||e}.`);}
  const {data:b}=await db.from('finance_budgets').select('id,status').eq('id',budgetId).single();if(!b)throw appError('Budget not found.');if(b.status!=='draft')throw appError('Only a draft budget can be imported into (send it back to draft first).');
  const head=(rows[0]??[]).map(h=>String(h??'').trim().toLowerCase());const col=(n:string)=>head.findIndex(h=>h===n.toLowerCase());
  const ci={code:col('Line code'),name:col('Line'),type:col('Type'),timing:col('Timing'),annual:col('Yearly amount'),paid:col('Paid in (month)'),note:col('Note')};
  const mi=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map(m=>head.findIndex(h=>h===m));
  if(ci.name<0||mi.some(i=>i<0))throw appError('This is not a budget export: the columns Line and Jan…Dec are needed (use "Export to Excel" and edit that file).');
  const {data:existing}=await db.from('finance_budget_lines').select('*').eq('budget_id',budgetId);const byCode=new Map(((existing??[]) as any[]).map(l=>[String(l.line_code).toLowerCase(),l]));
  const errs:string[]=[];let upd=0,add=0;const toNum=(v:unknown)=>{const s=String(v??'').replace(/[₱,\s]/g,'');if(s==='')return 0;const n=Number(s);return Number.isFinite(n)?Math.round(n*100)/100:NaN;};
  const monthNo=(v:string)=>{const s=v.trim().toLowerCase();if(!s)return null;const n=Number(s);if(Number.isInteger(n)&&n>=1&&n<=12)return n;const i=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(s.slice(0,3));return i>=0?i+1:NaN;};
  for(let r=1;r<rows.length;r++){const row=rows[r]??[];const cell=(i:number)=>i>=0?String(row[i]??'').trim():'';const name=cell(ci.name);if(!name&&!cell(ci.code))continue;const at=`Row ${r+1}`;
    const timingTxt=cell(ci.timing).toLowerCase();const timing=timingTxt.startsWith('year')?'yearly':timingTxt.startsWith('one')?'one_time':'monthly';
    const months=mi.map(i=>toNum(row[i]));if(months.some(Number.isNaN)){errs.push(`${at} (${name}): a month amount is not a number`);continue;}
    let annual:number|null=null,pay:number|null=null;
    if(timing==='yearly'){annual=toNum(cell(ci.annual))||months.reduce((s,v)=>s+v,0);pay=monthNo(cell(ci.paid))??1;if(Number.isNaN(annual)||!(annual>0)){errs.push(`${at} (${name}): enter the Yearly amount`);continue;}if(Number.isNaN(pay)){errs.push(`${at} (${name}): Paid in must be a month (Jan or 1)`);continue;}}
    const vals=timing==='yearly'?(()=>{const each=Math.round(annual!/12*100)/100;return months.map((_,i)=>i===11?Math.round((annual!-each*11)*100)/100:each);})():months;
    const row2:any={account_name:name||undefined,timing,annual_amount:annual,pay_month:pay,notes:cell(ci.note)||null,updated_at:new Date().toISOString()};
    ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].forEach((m,i)=>{row2[`${m}_budget`]=vals[i];});
    const hit=cell(ci.code)?byCode.get(cell(ci.code).toLowerCase()):undefined;
    if(!hit&&!name){errs.push(`${at}: a new line needs a name in the Line column`);continue;}
    if(cell(ci.code)&&!hit){errs.push(`${at}: line code ${cell(ci.code)} is not in this budget (clear the code to add it as a new line)`);continue;}
    if(hit){if(!name)delete row2.account_name;const {error}=await db.from('finance_budget_lines').update(row2).eq('id',hit.id);if(error){errs.push(`${at} (${name}): ${error.message}`);continue;}upd++;}
    else{const tt=cell(ci.type).toLowerCase();const line_type=tt.startsWith('sales')?'revenue':tt.startsWith('cost')?'cogs':'expense';
      const {error}=await db.from('finance_budget_lines').insert({...row2,...biz(p),budget_id:budgetId,line_code:`XL-${String(r).padStart(3,'0')}-${Date.now().toString(36).slice(-4)}`,line_type,category:line_type==='revenue'?'Sales':line_type==='cogs'?'Cost of sales':'Expenses',sort_order:950+r,base_months:Array(12).fill(0)});
      if(error){errs.push(`${at} (${name}): ${error.message}`);continue;}add++;}}
  await db.rpc('recalculate_finance_budget_totals',{p_budget_id:budgetId});
  await audit(p.user.id,budgetId,'finance_budgets','budget_imported',{updated:upd,added:add,errors:errs.length});revalidatePath('/finance/budgets');
  return {updated:upd,added:add,errors:errs};
}
