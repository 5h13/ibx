'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier, hasSectionWorkflowRole } from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
import { postSupplierPaymentAction } from '@/modules/finance/accountsPayableActions';
import { postCustomerReceiptAction } from '@/modules/finance/accountsReceivableActions';
import { postCashTransactionAction } from '@/modules/finance/bankCashActions';
import { postJournalAction } from '@/modules/finance/accountingActions';
import { postPayrollRunAction } from '@/modules/finance/payrollActions';
import { postReceiptAction, postTransferAction } from '@/modules/logistics/inventoryActions';
import { recordIntegrationEvent } from '@/shared/integration/service';
import { reviewRequisitionAction, approveRequisitionAction, reviewPurchaseOrderAction, approvePurchaseOrderAction } from '@/modules/finance/procurement/actions';

type SourceKey =
  | 'admin_expense' | 'internal_request' | 'fleet_expense'
  | 'purchase_requisition' | 'purchase_order' | 'supplier_invoice' | 'supplier_payment'
  | 'customer_invoice' | 'customer_receipt' | 'cash_transaction' | 'budget' | 'journal'
  | 'payroll' | 'inventory_receipt' | 'inventory_transfer' | 'delivery_order'
  | 'sales_order' | 'revenue_recognition' | 'commission' | 'commission_payout'
  | 'marketing_campaign';

type Config = {
  table: string; section: string; label: string; numberField: string;
  statusField?: string; actorFields?: { prepared?: string; reviewed?: string; approved?: string; posted?: string };
};

const CONFIG: Record<SourceKey, Config> = {
  admin_expense: { table:'expenses', section:'admin', label:'Admin Expense', numberField:'description', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  internal_request: { table:'internal_requests', section:'admin', label:'Internal Request', numberField:'request_no', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  fleet_expense: { table:'fleet_expenses', section:'admin', label:'Fleet Expense', numberField:'description', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  purchase_requisition: { table:'purchase_requisitions', section:'finance', label:'Purchase Requisition', numberField:'pr_number', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  purchase_order: { table:'purchase_orders', section:'finance', label:'Purchase Order', numberField:'po_number', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  supplier_invoice: { table:'finance_supplier_invoices', section:'finance', label:'Supplier Invoice', numberField:'invoice_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  supplier_payment: { table:'finance_supplier_payments', section:'finance', label:'Supplier Payment', numberField:'payment_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  customer_invoice: { table:'finance_customer_invoices', section:'finance', label:'Customer Invoice', numberField:'invoice_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  customer_receipt: { table:'finance_customer_receipts', section:'finance', label:'Customer Receipt', numberField:'receipt_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  cash_transaction: { table:'finance_cash_transactions', section:'finance', label:'Cash / Bank Transaction', numberField:'transaction_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  budget: { table:'finance_budgets', section:'finance', label:'Budget / Forecast', numberField:'budget_code', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  journal: { table:'finance_journal_entries', section:'finance', label:'Journal Entry', numberField:'journal_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  payroll: { table:'payroll_runs', section:'finance', label:'Payroll Run', numberField:'run_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  inventory_receipt: { table:'logistics_receipts', section:'logistics', label:'Goods Receipt', numberField:'receipt_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  inventory_transfer: { table:'logistics_stock_transfers', section:'logistics', label:'Stock Transfer', numberField:'transfer_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',posted:'posted_by'} },
  delivery_order: { table:'logistics_delivery_orders', section:'logistics', label:'Delivery Order', numberField:'delivery_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  sales_order: { table:'sales_orders', section:'sales', label:'Sales Order', numberField:'order_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  revenue_recognition: { table:'sales_revenue_recognitions', section:'sales', label:'Revenue Recognition', numberField:'recognition_number', statusField:'status' },
  commission: { table:'sales_commissions', section:'sales', label:'Sales Commission', numberField:'commission_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  commission_payout: { table:'sales_commission_payouts', section:'sales', label:'Commission Payout', numberField:'payout_number', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
  marketing_campaign: { table:'marketing_campaigns', section:'marketing', label:'Marketing Campaign', numberField:'campaign_code', statusField:'status', actorFields:{prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by'} },
};

function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}

const CONFIG_BY_TABLE = Object.fromEntries(Object.entries(CONFIG).map(([k,v])=>[v.table,{key:k,...v}])) as Record<string, Config & {key:SourceKey}>;

async function accessForAction(section: string, needed: 'reviewer'|'approver'|'preparer' = 'approver') {
  const profile = await getSessionProfile();
  if (!profile?.user.is_active) throw appError('Authentication required.');
  if (isAdminTier(profile)) return profile;
  // Build 58: every grant for the section is considered (finding B); an
  // approver may review (finding A); a workflow role is never inferred from
  // the user's app role alone (finding C — previously a plain Finance/Sales
  // user with no grant passed ANY step here).
  if (!hasSectionWorkflowRole(profile, section, needed)) throw appError(`${needed} access required for ${section}.`);
  return profile;
}

async function writeDecision(p:{user:{id:string;business_id:string|null}}, table:string, id:string, action:string, fromStatus:string, toStatus:string, section:string, reason?:string) {
  const db=createClient();
  const {error}=await db.from('approval_decisions').insert({...biz(p),source_table:table,source_record_id:id,section_code:section,action,from_status:fromStatus,to_status:toStatus,reason:reason||null,actor_id:p.user.id});
  if(error) throw appError(error.message);
}

export async function decideApprovalAction(sourceTable:string, id:string, action:'review'|'approve'|'return'|'reject', reason?:string) {
  const cfg=CONFIG_BY_TABLE[sourceTable];
  if(!cfg) throw appError('Unsupported approval source.');
  // PR-10/PR-11/PO-11: purchase_requisitions and purchase_orders are NOT
  // handled by this generic engine's own update+approval_decisions logic
  // below -- they delegate to the one authoritative implementation in
  // finance/procurement/actions.ts, so a decision made from this cross-module
  // queue and one made from /finance/procurement go through the exact same
  // function, the same role check, and the same audit_log history, instead
  // of maintaining two competing mechanisms with two separate history
  // tables for the same rows.
  if(sourceTable==='purchase_requisitions'||sourceTable==='purchase_orders'){
    const isPr=sourceTable==='purchase_requisitions';
    const {data:current}=await createClient().from(sourceTable).select('status').eq('id',id).single();
    const status=current?.status;
    if(action==='review') await (isPr?reviewRequisitionAction(id,true):reviewPurchaseOrderAction(id,true));
    else if(action==='approve') await (isPr?approveRequisitionAction(id,true):approvePurchaseOrderAction(id,true));
    else if(status==='reviewed') await (isPr?approveRequisitionAction(id,false,reason):approvePurchaseOrderAction(id,false,reason));
    else await (isPr?reviewRequisitionAction(id,false,reason):reviewPurchaseOrderAction(id,false,reason));
    revalidatePath('/approvals'); revalidatePath('/finance/procurement');
    return;
  }
  const needed = action==='review' ? 'reviewer' : 'approver';
  const p=await accessForAction(cfg.section, needed);
  const db=createClient();
  const {data:row,error}=await db.from(cfg.table).select('*').eq('id',id).single();
  if(error||!row) throw appError(error?.message||'Approval item not found.');
  const current=String(row[cfg.statusField||'status']||'');
  let next='';
  if(action==='review') { if(current!=='prepared') throw appError('Only prepared items can be reviewed.'); next='reviewed'; }
  else if(action==='approve') { if(current!=='reviewed') throw appError('Only reviewed items can be approved.'); next='approved'; }
  else { if(!['prepared','reviewed'].includes(current)) throw appError('Only pending items can be returned or rejected.'); next='draft'; }

  const patch:any={updated_at:new Date().toISOString()};
  if(cfg.statusField) patch[cfg.statusField]=next; else patch.status=next;
  if(action==='review' && cfg.actorFields?.reviewed) { patch[cfg.actorFields.reviewed]=p.user.id; patch.reviewed_at=new Date().toISOString(); }
  if(action==='approve' && cfg.actorFields?.approved) { patch[cfg.actorFields.approved]=p.user.id; patch.approved_at=new Date().toISOString(); }
  if(action==='return' && 'rejection_reason' in row) patch.rejection_reason=reason||null;
  if(action==='reject' && 'rejection_reason' in row) patch.rejection_reason=reason||null;

  const {data:changed,error:ue}=await db.from(cfg.table).update(patch).eq('id',id).eq(cfg.statusField||'status',current).select('id').single();
  if(ue||!changed) throw appError(ue?.message||'Item changed before your decision. Refresh the queue.');
  await writeDecision(p,cfg.table,id,action==='review'?'reviewed':action==='approve'?'approved':action,current,next,cfg.section,reason);
  await recordIntegrationEvent({
    sourceModule: cfg.section,
    targetModule: 'approvals',
    eventType: `approval_${action}`,
    sourceTable: cfg.table,
    sourceRecordId: id,
    message: `${cfg.label}: ${current} -> ${next}`,
    payload: { action, reason: reason || null },
    actorId: p.user.id,
  });
  revalidatePath('/approvals');
  revalidatePath('/admin/expenses'); revalidatePath('/admin/requests'); revalidatePath('/admin/fleet');
  revalidatePath('/finance/procurement'); revalidatePath('/finance/accounts-payable'); revalidatePath('/finance/accounts-receivable'); revalidatePath('/finance/payroll'); revalidatePath('/finance/bank-cash'); revalidatePath('/finance/budgets'); revalidatePath('/finance/accounting');
  revalidatePath('/logistics/inventory'); revalidatePath('/logistics/warehouse-delivery');
  revalidatePath('/sales/revenue'); revalidatePath('/sales/commission-report'); revalidatePath('/marketing');
}

export async function postApprovalAction(sourceTable:string,id:string){
  const cfg=CONFIG_BY_TABLE[sourceTable];
  if(!cfg) throw appError('Unsupported approval source.');
  const p=await accessForAction(cfg.section,'approver');
  switch(cfg.key){
    case 'supplier_payment': return postSupplierPaymentAction(id);
    case 'customer_receipt': return postCustomerReceiptAction(id);
    case 'cash_transaction': return postCashTransactionAction(id);
    case 'journal': return postJournalAction(id);
    case 'payroll': return postPayrollRunAction(id);
    case 'inventory_receipt': return postReceiptAction(id);
    case 'inventory_transfer': return postTransferAction(id);
    default: throw appError('Posting is not enabled for this source yet.');
  }
}
