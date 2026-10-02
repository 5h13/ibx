'use server';
import { appError } from '@/core/errors/appError';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { notifyWorkflowRole } from '@/shared/notifications/service';
function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
const req=(fd:FormData,k:string)=>{const v=String(fd.get(k)??'').trim();if(!v)throw appError(`${k.replaceAll('_',' ')} is required.`);return v};
const opt=(fd:FormData,k:string)=>{const v=String(fd.get(k)??'').trim();return v||null};
async function sales(){const p=await getSessionProfile();if(!p?.user.is_active)throw appError('Authentication required.');if(!isAdminTier(p)&&p.user.role!=='sales'&&p.user.section_code!=='sales'&&!p.access.some(a=>a.section_code==='sales'))throw appError('Sales access required.');return p}
async function audit(actor:string,id:string,table:string,action:string,detail:Record<string,unknown>={}){const {error}=await createClient().from('audit_log').insert({actor_id:actor,entity_table:table,entity_id:id,action,detail});if(error)throw appError(error.message)}
export async function createOpportunityAction(fd:FormData){const p=await sales(),db=createClient();const {data,error}=await db.from('sales_opportunities').insert({...biz(p),opportunity_number:req(fd,'opportunity_number'),lead_id:opt(fd,'lead_id'),customer_id:opt(fd,'customer_id'),opportunity_name:req(fd,'opportunity_name'),owner_id:opt(fd,'owner_id')||p.user.id,expected_close_date:opt(fd,'expected_close_date'),estimated_value:Number(fd.get('estimated_value')||0),probability:Number(fd.get('probability')||0),source:opt(fd,'source'),notes:opt(fd,'notes'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create opportunity.');await audit(p.user.id,data.id,'sales_opportunities','opportunity_created');revalidatePath('/sales/revenue')}
export async function updateOpportunityStatusAction(id:string,status:string){const p=await sales(),db=createClient();const {error}=await db.from('sales_opportunities').update({status,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'sales_opportunities','status_changed',{status});revalidatePath('/sales/revenue')}
export async function createQuotationAction(fd:FormData){const p=await sales(),db=createClient();const lines=JSON.parse(String(fd.get('lines')||'[]')) as any[];if(!lines.length)throw appError('Add at least one quotation line.');const customerId=req(fd,'customer_id');const priced=[] as any[];for(const l of lines){const qty=Number(l.quantity)||0;if(qty<=0)throw appError('Quotation quantities must be greater than zero.');if(l.catalog_item_id){const {data:pr,error:pe}=await db.rpc('get_catalog_sales_price',{p_item_id:l.catalog_item_id,p_customer_id:customerId,p_supplier_cost:null});if(pe||!pr?.[0])throw appError(pe?.message||'Unable to calculate catalog price.');const x=pr[0];priced.push({catalog_item_id:l.catalog_item_id,description:l.description||l.catalog_item_name||'Catalog item',quantity:qty,unit:l.unit||'unit',unit_price:Number(x.customer_price||0),notes:l.notes||null,pricing_supplier_cost:Number(x.supplier_cost||0),pricing_service_cost_basis:Number(x.service_cost_basis||0),pricing_item_type:x.item_type||'product',pricing_category_addon_percent:Number(x.category_addon_percent||0),pricing_acquisition_cost:Number(x.acquisition_cost||0),pricing_item_markup_percent:Number(x.item_markup_percent||0),pricing_srp:Number(x.srp||0),pricing_customer_discount_percent:Number(x.customer_discount_percent||0),pricing_snapshot_at:new Date().toISOString()});}else{/* CAT-13: a line resolves to a catalog item; the "not in catalog" escape needs a reason and is flagged on the quote */const reason=String(l.custom_reason??'').trim();const desc=String(l.description??'').trim();if(!desc)throw appError('Pick a catalog item for every line (or describe the item that is not in the catalog).');if(!reason)throw appError(`"${desc}" is not a catalog item: pick it from the catalog, or give the reason it is not in the catalog.`);priced.push({description:desc,quantity:qty,unit:l.unit||'unit',unit_price:Number(l.unit_price)||0,notes:l.notes||null,custom_reason:reason});}}const subtotal=priced.reduce((s,l)=>s+(Number(l.quantity)||0)*(Number(l.unit_price)||0),0);const {data,error}=await db.from('sales_quotations').insert({...biz(p),opportunity_id:opt(fd,'opportunity_id'),customer_id:customerId,quotation_date:req(fd,'quotation_date'),valid_until:opt(fd,'valid_until'),subtotal,discount_amount:Number(fd.get('discount_amount')||0),tax_amount:0,vat_applied:fd.get('vat_applied')==='1',other_charges:Number(fd.get('other_charges')||0),notes:opt(fd,'notes'),payment_terms:opt(fd,'payment_terms'),delivery_lead_time:opt(fd,'delivery_lead_time'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create quotation.');const {error:le}=await db.from('sales_quotation_items').insert(priced.map(l=>({...biz(p),quotation_id:data.id,...l})));if(le){await db.from('sales_quotations').delete().eq('id',data.id);throw appError(le.message)}await audit(p.user.id,data.id,'sales_quotations','quotation_created',{subtotal,pricing_integrated:priced.some(x=>x.catalog_item_id)});revalidatePath('/sales/revenue')}
async function qTransition(id:string,status:string,from:string,field?:string){const p=await sales(),db=createClient();const patch:any={status,updated_at:new Date().toISOString()};if(field){patch[field]=p.user.id;patch[field.replace('_by','_at')]=new Date().toISOString()}const {error}=await db.from('sales_quotations').update(patch).eq('id',id).eq('status',from);if(error)throw appError(error.message);await audit(p.user.id,id,'sales_quotations',status);revalidatePath('/sales/revenue');revalidatePath('/approvals')}
export const prepareQuotationAction=(id:string)=>qTransition(id,'prepared','draft','prepared_by');
export const reviewQuotationAction=(id:string,accept:boolean)=>qTransition(id,accept?'reviewed':'draft','prepared', 'reviewed_by');
export const approveQuotationAction=(id:string)=>qTransition(id,'approved','reviewed','approved_by');
export async function markQuotationSentAction(id:string){return qTransition(id,'sent','approved')}
export async function acceptQuotationAction(id:string){return qTransition(id,'accepted','sent')}
// Build 69: orders are created from the client's go-signal (createOrderFromGoSignalAction below); the typed-number version was removed.
async function orderTransition(id:string,status:string,from:string,field?:string){const p=await sales(),db=createClient();const patch:any={status,updated_at:new Date().toISOString()};if(field){patch[field]=p.user.id;patch[field.replace('_by','_at')]=new Date().toISOString()}const {error}=await db.from('sales_orders').update(patch).eq('id',id).eq('status',from);if(error)throw appError(error.message);await audit(p.user.id,id,'sales_orders',status);revalidatePath('/sales/revenue');revalidatePath('/approvals')}
export const prepareSalesOrderAction=(id:string)=>orderTransition(id,'prepared','draft','prepared_by');
export const reviewSalesOrderAction=(id:string,accept:boolean)=>orderTransition(id,accept?'reviewed':'draft','prepared','reviewed_by');
export const approveSalesOrderAction=(id:string)=>orderTransition(id,'approved','reviewed','approved_by');
export async function createDeliveryFromOrderAction(orderId:string,deliveryNumber:string,sourceLocationId:string){const p=await sales(),db=createClient();const {data:o,error:oe}=await db.from('sales_orders').select('*,items:sales_order_items(*)').eq('id',orderId).single();if(oe||!o)throw appError('Sales order not found.');if(o.status!=='approved')throw appError('Sales order must be approved before warehouse fulfillment.');const {data,error:dError}=await db.from('logistics_delivery_orders').insert({...biz(p),delivery_number:deliveryNumber,customer_id:o.customer_id,source_location_id:sourceLocationId,delivery_date:o.requested_delivery_date||new Date().toISOString().slice(0,10),requested_delivery_date:o.requested_delivery_date,delivery_address:o.delivery_address,contact_name:o.contact_name,contact_phone:o.contact_phone,sales_reference:o.order_number,notes:o.notes,created_by:p.user.id}).select('id').single();if(dError||!data)throw appError(dError?.message||'Unable to create delivery order.');const {error:le}=await db.from('logistics_delivery_order_items').insert((o.items||[]).map((l:any)=>({...biz(p),delivery_order_id:data.id,inventory_item_id:l.inventory_item_id,quantity:l.quantity,unit_price:l.unit_price,notes:l.notes})));if(le){await db.from('logistics_delivery_orders').delete().eq('id',data.id);throw appError(le.message)}await db.from('sales_orders').update({status:'processing',updated_at:new Date().toISOString()}).eq('id',orderId);await audit(p.user.id,orderId,'sales_orders','sent_to_logistics',{delivery_order_id:data.id});revalidatePath('/sales/revenue');revalidatePath('/logistics/warehouse-delivery')}
export async function createCommissionAction(fd:FormData){const p=await sales(),db=createClient();const orderId=req(fd,'sales_order_id');const {data:o,error:oe}=await db.from('sales_orders').select('id,total_amount').eq('id',orderId).single();if(oe||!o)throw appError('Sales order not found.');const base=Number(fd.get('commission_base')||o.total_amount);const rate=Number(fd.get('commission_rate')||0);const {data,error}=await db.from('sales_commissions').insert({...biz(p),commission_number:req(fd,'commission_number'),sales_order_id:orderId,employee_id:opt(fd,'employee_id'),user_id:opt(fd,'user_id'),commission_rate:rate,commission_base:base,notes:opt(fd,'notes'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create commission.');await audit(p.user.id,data.id,'sales_commissions','commission_created',{base,rate});revalidatePath('/sales/revenue')}

export async function createRevenueRecognitionDraftAction(orderId:string, deliveryId:string|null, recognitionNumber:string, invoiceNumber:string){
  const p=await sales(),db=createClient();
  const {data,error}=await db.rpc('create_sales_revenue_draft',{p_order_id:orderId,p_delivery_id:deliveryId||null,p_actor:p.user.id,p_recognition_number:recognitionNumber,p_invoice_number:invoiceNumber});
  if(error) throw appError(error.message);
  await audit(p.user.id,data,'sales_revenue_recognitions','revenue_recognition_draft_created',{order_id:orderId,delivery_id:deliveryId});
  revalidatePath('/sales/revenue'); revalidatePath('/sales/monthly-sales'); revalidatePath('/finance/accounts-receivable'); revalidatePath('/finance/financial-summary'); revalidatePath('/approvals');
}
export async function refreshSalesMonthlySummaryAction(year:number,month:number){
  const p=await sales(),db=createClient();
  const {error}=await db.rpc('refresh_sales_monthly_revenue_summary',{p_year:year,p_month:month});
  if(error) throw appError(error.message);
  await audit(p.user.id,'00000000-0000-0000-0000-000000000000','sales_monthly_revenue_summary','monthly_summary_refreshed',{year,month});
  revalidatePath('/sales/revenue'); revalidatePath('/sales/monthly-sales');
}

export async function transitionCommissionAction(id:string,status:'prepared'|'reviewed'|'approved'|'paid'|'cancelled'){
  const p=await sales(),db=createClient();
  const transitions:any={prepared:['draft'],reviewed:['prepared'],approved:['reviewed'],paid:['approved'],cancelled:['draft','prepared','reviewed']};
  const allowed=transitions[status]||[];
  const {data:current,error:ce}=await db.from('sales_commissions').select('status,commission_amount').eq('id',id).single();
  if(ce||!current) throw appError(ce?.message||'Commission not found.');
  if(!allowed.includes(current.status)) throw appError(`Commission cannot move from ${current.status} to ${status}.`);
  const patch:any={status,updated_at:new Date().toISOString()};
  const field:any={prepared:'prepared_by',reviewed:'reviewed_by',approved:'approved_by',paid:'paid_at',cancelled:'cancelled_at'}[status];
  if(field==='paid_at'||field==='cancelled_at') patch[field]=new Date().toISOString();
  else if(field){patch[field]=p.user.id;patch[field.replace('_by','_at')]=new Date().toISOString();}
  const {error}=await db.from('sales_commissions').update(patch).eq('id',id).eq('status',current.status);
  if(error) throw appError(error.message);
  await audit(p.user.id,id,'sales_commissions',`commission_${status}`,{amount:current.commission_amount});
  revalidatePath('/sales/revenue'); revalidatePath('/sales/commission-report'); revalidatePath('/approvals');
}

export async function createCommissionPayoutAction(fd:FormData){
  const p=await sales(),db=createClient();
  const employeeId=opt(fd,'employee_id'); const start=req(fd,'period_start'); const end=req(fd,'period_end');
  const q=db.from('sales_commissions').select('commission_amount').in('status',['approved','paid']).gte('created_at',start).lte('created_at',`${end}T23:59:59.999Z`);
  if(employeeId) q.eq('employee_id',employeeId);
  const {data,error}=await q;
  if(error) throw appError(error.message);
  const gross=(data||[]).reduce((s:any,x:any)=>s+Number(x.commission_amount||0),0);
  if(gross<=0) throw appError('No approved or paid commissions found for the selected period.');
  const {data:row,error:ie}=await db.from('sales_commission_payouts').insert({...biz(p),payout_number:req(fd,'payout_number'),employee_id:employeeId,period_start:start,period_end:end,gross_commission:gross,adjustments:Number(fd.get('adjustments')||0),notes:opt(fd,'notes'),created_by:p.user.id}).select('id').single();
  if(ie||!row) throw appError(ie?.message||'Unable to create payout.');
  await audit(p.user.id,row.id,'sales_commission_payouts','commission_payout_created',{gross});
  revalidatePath('/sales/commission-report'); revalidatePath('/approvals');
}

export async function transitionCommissionPayoutAction(id:string,status:'prepared'|'reviewed'|'approved'|'paid'|'cancelled'){
  const p=await sales(),db=createClient();
  const transitions:any={prepared:['draft'],reviewed:['prepared'],approved:['reviewed'],paid:['approved'],cancelled:['draft','prepared','reviewed']};
  const {data:current,error:ce}=await db.from('sales_commission_payouts').select('status,net_commission').eq('id',id).single();
  if(ce||!current) throw appError(ce?.message||'Payout not found.');
  if(!(transitions[status]||[]).includes(current.status)) throw appError(`Payout cannot move from ${current.status} to ${status}.`);
  const patch:any={status,updated_at:new Date().toISOString()};
  if(status==='prepared'||status==='reviewed'||status==='approved'){patch[`${status}_by`]=p.user.id;patch[`${status}_at`]=new Date().toISOString();}
  if(status==='paid') patch.paid_at=new Date().toISOString();
  const {error}=await db.from('sales_commission_payouts').update(patch).eq('id',id).eq('status',current.status);
  if(error) throw appError(error.message);
  await audit(p.user.id,id,'sales_commission_payouts',`payout_${status}`,{amount:current.net_commission});
  revalidatePath('/sales/commission-report'); revalidatePath('/approvals');
}

// ---------------------------------------------------------------------------
// Build 69 — Quote → Sales Order → PR (DOC-05/06/07/11/12/13). The database
// functions in migration 20261120 check business and role; these actions pass
// the request on, store the confirmation screenshot and send notifications.

const GO_SIGNAL_BUCKET = 'sales-go-signal';
async function rpcCall<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw appError(error.message);
  return data as T;
}

export async function reviseQuotationAction(quotationId: string) {
  await sales();
  const r = await rpcCall<{ quotation_number: string; old_subtotal: number; subtotal: number }>('sales_revise_quotation', { p_quote: quotationId });
  revalidatePath('/sales/revenue');
  return r;
}

export async function quotationDetailAction(quotationId: string) {
  await sales();
  const db = createClient();
  const { data: q, error } = await db.from('sales_quotations')
    .select('*,customer:finance_customers(legal_name,customer_code,payment_terms),items:sales_quotation_items(*)').eq('id', quotationId).single();
  if (error || !q) throw appError(error?.message || 'Quotation not found.');
  const [{ data: history }, { data: orders }] = await Promise.all([
    db.from('sales_quotations').select('id,quotation_number,revision,status,quotation_date,total_amount').eq('base_number', q.base_number).order('revision'),
    db.from('sales_orders').select('id,order_number,status').eq('quotation_id', q.id).neq('status', 'cancelled'),
  ]);
  return { quote: q, history: history ?? [], orders: orders ?? [] };
}

export async function quoteOrderLinesAction(quotationId: string) {
  await sales();
  return rpcCall<{ quotation_item_id: string; catalog_item_id: string | null; description: string; quantity: number; unit: string; unit_price: number;
    item_type: 'product' | 'service' | 'custom'; on_hand: number | null; current_cost: number | null }[]>('sales_quote_order_lines', { p_quote: quotationId });
}

const PROOF_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'];
export async function createOrderFromGoSignalAction(fd: FormData) {
  const p = await sales();
  const quotationId = req(fd, 'quotation_id');
  const file = fd.get('proof');
  let proofPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) throw appError('The screenshot must be 10 MB or smaller.');
    if (file.type && !PROOF_TYPES.includes(file.type)) throw appError('Attach the confirmation as an image (PNG, JPG, WEBP, HEIC) or a PDF.');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'png';
    proofPath = `${quotationId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await createAdminClient().storage.from(GO_SIGNAL_BUCKET).upload(proofPath, file, { contentType: file.type || 'image/png', upsert: false });
    if (error) throw appError(`Could not store the screenshot: ${error.message}`);
  }
  let lines: { quotation_item_id: string; fulfilment: 'stock' | 'source' }[] = [];
  try { lines = JSON.parse(String(fd.get('lines') || '[]')); } catch { throw appError('Invalid order lines.'); }
  try {
    const r = await rpcCall<{ id: string; order_number: string; lines_to_source: number }>('sales_create_order', {
      p: {
        quotation_id: quotationId, client_po_number: opt(fd, 'client_po_number'), go_signal_date: opt(fd, 'go_signal_date'),
        go_signal_via: opt(fd, 'go_signal_via'), confirmed_by: opt(fd, 'confirmed_by'), proof_path: proofPath,
        requested_delivery_date: opt(fd, 'requested_delivery_date'), delivery_address: opt(fd, 'delivery_address'),
        contact_name: opt(fd, 'contact_name'), contact_phone: opt(fd, 'contact_phone'), notes: opt(fd, 'notes'), lines,
      },
    });
    await audit(p.user.id, r.id, 'sales_orders', 'go_signal_recorded', { quotation_id: quotationId });
    await notifyWorkflowRole(p.user.business_id, 'sales', 'approver', {
      entity_table: 'sales_orders', entity_id: r.id,
      title: `Sales order to approve: ${r.order_number}`,
      message: r.lines_to_source > 0 ? `${r.lines_to_source} line(s) will go to Procurement as a PR once approved.` : 'All lines are from stock.',
      action_url: '/approvals',
    }).catch(() => undefined);
    revalidatePath('/sales/revenue'); revalidatePath('/approvals');
    return r;
  } catch (e) {
    if (proofPath) await createAdminClient().storage.from(GO_SIGNAL_BUCKET).remove([proofPath]).catch(() => undefined);
    throw e;
  }
}

export async function orderChainAction(orderId: string) {
  await sales();
  const db = createClient();
  const { data: o, error } = await db.from('sales_orders')
    .select('id,order_number,status,client_po_number,go_signal_date,go_signal_via,go_signal_confirmed_by,go_signal_proof_path,requested_delivery_date,delivery_address,contact_name,contact_phone,notes,total_amount,customer:finance_customers(legal_name),items:sales_order_items(id,description,quantity,unit,unit_price,amount,fulfilment)')
    .eq('id', orderId).single();
  if (error || !o) throw appError(error?.message || 'Sales order not found.');
  const chain = await rpcCall<OrderChain>('sales_order_chain', { p_order: orderId });
  let proofUrl: string | null = null;
  if (o.go_signal_proof_path) {
    const { data } = await createAdminClient().storage.from(GO_SIGNAL_BUCKET).createSignedUrl(o.go_signal_proof_path, 600);
    proofUrl = data?.signedUrl ?? null;
  }
  return { order: o, chain, proofUrl };
}

// ---------------------------------------------------------------------------
// Build 77 — quote chain stage 2 (DOC-01, DOC-03, DOC-13; migration 20261205).

export type OrderChain = {
  quotation_number: string | null; order_number: string; pr_number: string | null; pr_status: string | null; pr_fulfilment: string | null; po_numbers: string[];
  pos: { po_number: string; status: string; issuance_status: string; supplier: string; order_date: string; value: number; paid: number;
    receipts: { receipt_number: string; date: string; status: string; supplier_dr: string | null }[];
    invoices: { invoice_number: string; date: string; status: string; total: number; paid: number; balance: number }[];
    payments: { payment_number: string; date: string; amount: number; status: string; against: string; kind: string | null }[] }[];
  lines: { id: string; description: string; unit: string; fulfilment: string; ordered: number; received: number | null; delivered: number; released: number; chosen_supplier: string | null }[];
  drs: { sale_number: string; dr_number: string | null; date: string; total: number; release_status: string | null; si_number: string | null;
    invoice_number: string | null; invoice_status: string | null; balance_due: number | null }[];
};

export type QuoteStock = { item_id: string; item_type: string; on_hand_store: number | null; on_hand_business: number | null };
/** DOC-01: stock on hand for catalog items while quoting (quantities only, this business). */
export async function quoteStockAction(itemIds: string[]) {
  await sales();
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return [] as QuoteStock[];
  return rpcCall<QuoteStock[]>('sales_quote_stock', { p_items: ids });
}

export type QuoteLineStatus = {
  quotation_item_id: string; catalog_item_id: string | null; item_type: string; on_hand_store: number | null; on_hand_business: number | null;
  not_in_catalog: boolean; custom_reason: string | null; price_request_status: 'awaiting' | 'answered' | null; price_request_note: string | null;
  price_requested_at: string | null; chosen_supplier: string | null; supplier_unit_price: number | null; supplier_validity: string | null;
  supplier_lead_time: string | null; supplier_terms: string | null; price_answered_at: string | null;
};
export async function quoteLineStatusAction(quotationId: string) {
  await sales();
  return rpcCall<QuoteLineStatus[]>('sales_quote_line_status', { p_quote: quotationId });
}

/** DOC-03: "Ask Procurement for supplier price" on lines of a draft quote (the database notifies Procurement). */
export async function requestSupplierPriceAction(quotationId: string, itemIds: string[], note: string) {
  const p = await sales();
  if (!itemIds.length) throw appError('Tick the lines to ask Procurement about.');
  const r = await rpcCall<{ requested: number }>('sales_request_supplier_price', { p_quote: quotationId, p_items: itemIds, p_note: note.trim() || null });
  await audit(p.user.id, quotationId, 'sales_quotations', 'supplier_price_request_sent', { lines: r.requested });
  revalidatePath('/sales/revenue'); revalidatePath('/finance/price-requests');
  return r;
}

export async function cancelPriceRequestAction(quotationItemId: string) {
  await sales();
  await rpcCall('sales_cancel_price_request', { p_item: quotationItemId });
  revalidatePath('/sales/revenue'); revalidatePath('/finance/price-requests');
}
