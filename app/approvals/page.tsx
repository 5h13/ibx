import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier, hasSectionWorkflowRole } from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { AuthedShell } from '@/core/layout/AuthedShell';
import { ApprovalQueue, type ApprovalItem } from '@/modules/approvals/ApprovalQueue';

const SECTION_TABLES: Record<string,string[]> = {
  admin:['expenses','internal_requests','fleet_expenses'],
  finance:['purchase_requisitions','purchase_orders','finance_supplier_invoices','finance_supplier_payments','finance_customer_invoices','finance_customer_receipts','finance_cash_transactions','finance_budgets','finance_journal_entries','payroll_runs'],
  logistics:['logistics_receipts','logistics_stock_transfers','logistics_delivery_orders'],
  sales:['sales_orders','sales_revenue_recognitions','sales_commissions','sales_commission_payouts'],
  marketing:['marketing_campaigns'],
};

const META: Record<string,{module:string;number:string;description:string;amount:string}> = {
  expenses:{module:'Admin Expense',number:'description',description:'description',amount:'amount'},
  internal_requests:{module:'Internal Request',number:'request_no',description:'title',amount:''},
  fleet_expenses:{module:'Fleet Expense',number:'description',description:'description',amount:'amount'},
  purchase_requisitions:{module:'Purchase Requisition',number:'pr_number',description:'purpose',amount:'estimated_total'},
  purchase_orders:{module:'Purchase Order',number:'po_number',description:'notes',amount:'total_amount'},
  finance_supplier_invoices:{module:'Supplier Invoice',number:'invoice_number',description:'notes',amount:'total_amount'},
  finance_supplier_payments:{module:'Supplier Payment',number:'payment_number',description:'reference_number',amount:'amount'},
  finance_customer_invoices:{module:'Customer Invoice',number:'invoice_number',description:'notes',amount:'total_amount'},
  finance_customer_receipts:{module:'Customer Receipt',number:'receipt_number',description:'reference_number',amount:'amount'},
  finance_cash_transactions:{module:'Cash / Bank Transaction',number:'transaction_number',description:'description',amount:'amount'},
  finance_budgets:{module:'Budget / Forecast',number:'budget_code',description:'name',amount:'total_budget'},
  finance_journal_entries:{module:'Journal Entry',number:'journal_number',description:'description',amount:'total_debit'},
  payroll_runs:{module:'Payroll Run',number:'run_number',description:'run_number',amount:'net_pay'},
  logistics_receipts:{module:'Goods Receipt',number:'receipt_number',description:'delivery_reference',amount:''},
  logistics_stock_transfers:{module:'Stock Transfer',number:'transfer_number',description:'notes',amount:''},
  logistics_delivery_orders:{module:'Delivery Order',number:'delivery_number',description:'delivery_address',amount:''},
  sales_orders:{module:'Sales Order',number:'order_number',description:'notes',amount:'total_amount'},
  sales_revenue_recognitions:{module:'Revenue Recognition',number:'recognition_number',description:'notes',amount:'revenue_amount'},
  sales_commissions:{module:'Sales Commission',number:'commission_number',description:'notes',amount:'commission_amount'},
  sales_commission_payouts:{module:'Commission Payout',number:'payout_number',description:'notes',amount:'net_commission'},
  marketing_campaigns:{module:'Marketing Campaign',number:'campaign_code',description:'campaign_name',amount:'budget'},
};

async function rowsFor(db:any,table:string,section:string):Promise<ApprovalItem[]> {
  const meta=META[table];
  if(!meta) return [];
  const fields=[...new Set(['id','status',meta.number,meta.description,meta.amount,'prepared_by','reviewed_by','approved_by'].filter(Boolean))].join(',');
  const {data,error}=await db.from(table).select(fields).in('status', ['prepared','reviewed', ...( ['finance_supplier_payments','finance_customer_receipts','finance_cash_transactions','finance_journal_entries','payroll_runs','logistics_receipts','logistics_stock_transfers'].includes(table) ? ['approved'] : []) ]).order('updated_at',{ascending:false}).limit(250);
  if(error) return [];
  const postable=['finance_supplier_payments','finance_customer_receipts','finance_cash_transactions','finance_journal_entries','payroll_runs','logistics_receipts','logistics_stock_transfers'].includes(table);
  return (data||[]).map((r:any)=>({
    id:r.id,sourceTable:table,section,module:meta.module,number:String(r[meta.number]??r.id.slice(0,8)),description:String(r[meta.description]??''),amount:meta.amount?r[meta.amount]:null,status:String(r.status),canReview:String(r.status)==='prepared',canApprove:String(r.status)==='reviewed',canPost:false,
    _postable:postable
  } as any));
}

export default async function ApprovalsPage(){
  const profile=await getSessionProfile();
  if(!profile) redirect('/login');
  const db=createClient();
  const allowed=isAdminTier(profile)
    ? Object.keys(SECTION_TABLES)
    : [...new Set(profile.access.map(a=>a.section_code).filter((x):x is string=>Boolean(x)).concat(profile.user.section_code||''))].filter(s=>SECTION_TABLES[s]);
  const all=(await Promise.all(allowed.flatMap(section=>SECTION_TABLES[section].map(table=>rowsFor(db,table,section))))).flat();
  const {data:historyRows}=await db.from('approval_decisions').select('id,source_table,section_code,action,from_status,to_status,reason,created_at,actor_id').order('created_at',{ascending:false}).limit(40);
  const visibleHistory=(historyRows||[]).filter((h:any)=>allowed.includes(h.section_code));
  // Build 58: decided per section from ALL of the user's grants (finding B),
  // approver may review (finding A), no approver-by-app-role fallback (C).
  const items=all.map((i:any)=>{const postable=['finance_supplier_payments','finance_customer_receipts','finance_cash_transactions','finance_journal_entries','payroll_runs','logistics_receipts','logistics_stock_transfers'].includes(i.sourceTable);const canReview=hasSectionWorkflowRole(profile,i.section,'reviewer')&&i.status==='prepared';const canApprove=hasSectionWorkflowRole(profile,i.section,'approver')&&i.status==='reviewed';return {...i,canReview,canApprove,canPost:postable&&i.status==='approved'&&hasSectionWorkflowRole(profile,i.section,'approver')};});
  return <AuthedShell profile={profile}><div className="space-y-5"><div><h1 className="text-2xl font-bold">Approvals / Decision Engine</h1><p className="text-sm text-slate-500">One queue for cross-module review, approval, return and supported posting decisions.</p></div><ApprovalQueue items={items}/><section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Recent decisions</h2><div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">When</th><th className="p-2">Section</th><th className="p-2">Source</th><th className="p-2">Decision</th><th className="p-2">Status</th><th className="p-2">Reason</th></tr></thead><tbody>{visibleHistory.map((h:any)=><tr key={h.id} className="border-t"><td className="p-2 whitespace-nowrap">{new Date(h.created_at).toLocaleString()}</td><td className="p-2 capitalize">{h.section_code}</td><td className="p-2">{META[h.source_table]?.module||h.source_table}</td><td className="p-2 capitalize">{h.action}</td><td className="p-2">{h.from_status} → {h.to_status}</td><td className="p-2">{h.reason||'—'}</td></tr>)}{visibleHistory.length===0&&<tr><td colSpan={6} className="p-6 text-center text-slate-500">No central decisions have been recorded yet.</td></tr>}</tbody></table></div></section></div></AuthedShell>;
}
