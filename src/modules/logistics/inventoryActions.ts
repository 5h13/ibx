'use server';
import { appError } from '@/core/errors/appError';
import {revalidatePath} from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import {getSessionProfile} from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { notifyWorkflowRole, notifyUsers } from '@/shared/notifications/service';
function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
function req(fd:FormData,k:string){const v=String(fd.get(k)??'').trim();if(!v)throw appError(`${k.replaceAll('_',' ')} is required.`);return v}
function opt(fd:FormData,k:string){const v=String(fd.get(k)??'').trim();return v||null}
async function logistics(){const p=await getSessionProfile();if(!p?.user.is_active)throw appError('Authentication required.');if(!isAdminTier(p)&&p.user.role!=='logistics'&&!p.access.some(a=>a.section_code==='logistics'))throw appError('Logistics access required.');return p}
async function audit(actor:string,id:string,table:string,action:string,detail:Record<string,unknown>){const {error}=await createClient().from('audit_log').insert({actor_id:actor,entity_table:table,entity_id:id,action,detail});if(error)throw appError(error.message)}
export async function createLocationAction(fd:FormData){const p=await logistics(),db=createClient();const {data,error}=await db.from('logistics_locations').insert({...biz(p),location_code:req(fd,'location_code'),location_name:req(fd,'location_name'),location_type:req(fd,'location_type'),address:opt(fd,'address'),notes:opt(fd,'notes'),created_by:p.user.id}).select('id').single();if(error?.code==='23505')throw appError(`Location code ${String(fd.get('location_code')??'').trim()} is already used in this business.`);if(error||!data)throw appError(error?.message||'Unable to create location.');await audit(p.user.id,data.id,'logistics_locations','location_created',{});revalidatePath('/logistics/inventory')}
// LOG-48: edit / delete go through SECURITY DEFINER functions, which enforce
// role + business and refuse a code change or delete once the location is used.
export async function updateLocationAction(id:string,fd:FormData){const p=await logistics(),db=createClient();const code=opt(fd,'location_code');const {error}=await db.rpc('logistics_update_location',{p_location:id,p_code:code,p_name:req(fd,'location_name'),p_type:req(fd,'location_type'),p_address:opt(fd,'address'),p_notes:opt(fd,'notes')});if(error?.code==='23505')throw appError(`Location code ${code} is already used in this business.`);if(error)throw appError(error.message);await audit(p.user.id,id,'logistics_locations','location_updated',{location_code:code});revalidatePath('/logistics/inventory')}
export async function deleteLocationAction(id:string){const p=await logistics(),db=createClient();const {data,error}=await db.rpc('logistics_delete_location',{p_location:id});if(error)throw appError(error.message);await audit(p.user.id,id,'logistics_locations','location_deleted',{location_code:data});revalidatePath('/logistics/inventory')}
export async function toggleLocationAction(id:string,active:boolean){const p=await logistics(),db=createClient();const {error}=await db.from('logistics_locations').update({active,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'logistics_locations',active?'location_activated':'location_deactivated',{});revalidatePath('/logistics/inventory')}
export async function createInventoryItemAction(fd:FormData){
 const p=await logistics(),db=createClient();
 const procurementItemId=req(fd,'procurement_item_id');
 const {data:catalog,error:ce}=await db.from('finance_procurement_items').select('id,item_code,item_name,description,category,unit,active').eq('id',procurementItemId).single();
 if(ce||!catalog)throw appError('Selected catalog item was not found.');
 if(!catalog.active)throw appError('Only active catalog items can be added to inventory.');
 const {data:existing}=await db.from('logistics_inventory_items').select('id').eq('procurement_item_id',procurementItemId).maybeSingle();
 if(existing)throw appError('This catalog item is already linked to Logistics Inventory.');
 const {data,error}=await db.from('logistics_inventory_items').insert({...biz(p),item_code:catalog.item_code,item_name:catalog.item_name,description:catalog.description,category:catalog.category,unit:catalog.unit,procurement_item_id:catalog.id,reorder_level:0,created_by:p.user.id}).select('id').single();
 if(error||!data)throw appError(error?.message||'Unable to create inventory reference.');
 await audit(p.user.id,data.id,'logistics_inventory_items','inventory_item_created',{procurement_item_id:catalog.id});
 revalidatePath('/logistics/inventory')
}
export async function saveInventoryLocationSettingAction(fd:FormData){
 const p=await logistics(),db=createClient();
 const inventoryItemId=req(fd,'inventory_item_id'),locationId=req(fd,'location_id');
 const reorder=Number(fd.get('reorder_level')||0); if(!Number.isFinite(reorder)||reorder<0)throw appError('Reorder level must be zero or greater.');
 const {data,error}=await db.from('logistics_inventory_location_settings').upsert({inventory_item_id:inventoryItemId,location_id:locationId,reorder_level:reorder,active:true,created_by:p.user.id,updated_at:new Date().toISOString()},{onConflict:'inventory_item_id,location_id'}).select('id').single();
 if(error||!data)throw appError(error?.message||'Unable to save location inventory setting.');
 await audit(p.user.id,data.id,'logistics_inventory_location_settings','location_reorder_updated',{inventory_item_id:inventoryItemId,location_id:locationId,reorder_level:reorder});
 revalidatePath('/logistics/inventory')
}
// LOG-10/13/39: receipt lines carry delivered (quantity) = accepted + damaged +
// rejected. The database (logistics_receipt_item_guard) checks over-receipt
// against the PO's outstanding quantity, takes unit cost from the PO line and
// refuses a cost typed by a user who may not see cost; this action never sends
// unit_cost for such a user. The DB's refusals (over-receipt with the
// outstanding quantity, cost, split) are already worded for the user.
const num=(v:unknown)=>{const n=Number(v??0);return Number.isFinite(n)?n:NaN};
export async function createReceiptAction(fd:FormData){
 const p=await logistics(),db=createClient();
 const purchaseOrderId=opt(fd,'purchase_order_id');const supplierId=opt(fd,'supplier_id');const locationId=req(fd,'location_id');
 const lines=JSON.parse(String(fd.get('lines')||'[]'));
 if(!Array.isArray(lines)||!lines.length)throw appError('At least one receipt line is required.');
 const clean=lines.map((l:any)=>{const delivered=num(l.quantity),damaged=num(l.damaged_qty||0),rejected=num(l.rejected_qty||0);const accepted=delivered-damaged-rejected;
  if(!l.inventory_item_id||!(delivered>0))throw appError('Every receipt line requires an active catalog-linked item and a positive delivered quantity.');
  if(!(damaged>=0)||!(rejected>=0)||accepted<0)throw appError('Damaged and rejected quantities must be zero or more and cannot exceed the delivered quantity.');
  return {inventory_item_id:String(l.inventory_item_id),description:l.description||null,quantity:delivered,accepted_qty:accepted,damaged_qty:damaged,rejected_qty:rejected,unit_cost:num(l.unit_cost||0),lot_number:l.lot_number||null,expiry_date:l.expiry_date||null,notes:l.notes||null,over_receipt_approved:!!l.over_receipt_approved}});
 if(purchaseOrderId){
  const {data:po,error:poErr}=await db.from('purchase_orders').select('id,supplier_id,status,issuance_status').eq('id',purchaseOrderId).single();
  if(poErr||!po)throw appError('Selected purchase order was not found.');
  if(po.status!=='approved'||po.issuance_status!=='issued')throw appError('Only a purchase order that has been approved and issued to the supplier can be received.');
  if(supplierId&&supplierId!==po.supplier_id)throw appError('Supplier must match the selected purchase order.');
  const {data:status}=await db.rpc('logistics_po_receiving_status',{p_po:purchaseOrderId});
  const onPo=new Set(((status??[]) as any[]).map(x=>x.inventory_item_id).filter(Boolean));
  if(clean.some(l=>!onPo.has(l.inventory_item_id)))throw appError('Receipt line is not linked to an item on the selected purchase order.');
 }
 const {data:costOk}=await db.rpc('can_view_inventory_cost');
 const {data,error}=await db.from('logistics_receipts').insert({...biz(p),purchase_order_id:purchaseOrderId,supplier_id:supplierId,location_id:locationId,receipt_date:req(fd,'receipt_date'),delivery_reference:opt(fd,'delivery_reference'),received_by:p.user.id,notes:opt(fd,'notes')}).select('id').single();
 if(error||!data)throw appError(error?.message||'Unable to create receipt.');
 const rows=clean.map(({unit_cost,...l})=>({...biz(p),receipt_id:data.id,...l,...(costOk&&unit_cost>0?{unit_cost}:{})}));
 const {error:le}=await db.from('logistics_receipt_items').insert(rows);
 if(le){await db.from('logistics_receipts').delete().eq('id',data.id);throw appError(le.message);}
 await audit(p.user.id,data.id,'logistics_receipts','receipt_created',{purchase_order_id:purchaseOrderId,ad_hoc:!purchaseOrderId,damaged:clean.reduce((s,l)=>s+l.damaged_qty,0),rejected:clean.reduce((s,l)=>s+l.rejected_qty,0),over_receipt_lines:clean.filter(l=>l.over_receipt_approved).length});
 revalidatePath('/logistics/inventory')
}
// LOG-17: each receiving transition notifies the next workflow role (U006),
// a return notifies the preparer, approval tells the preparer it can be posted.
async function transition(id:string,status:string,from:string,actorField:string,action:string){
 const p=await logistics(),db=createClient();
 const patch:any={status,updated_at:new Date().toISOString()};
 if(actorField){patch[actorField]=p.user.id;patch[actorField.replace('_by','_at')]=new Date().toISOString()}
 const {data,error}=await db.from('logistics_receipts').update(patch).eq('id',id).eq('status',from).select('id,receipt_number,business_id,prepared_by,received_by').maybeSingle();
 if(error)throw appError(error.message);
 if(!data)throw appError(`This receipt is no longer ${from}; refresh and try again.`);
 await audit(p.user.id,id,'logistics_receipts',action,{});
 await notifyReceipt(data,action);
 revalidatePath('/logistics/inventory');revalidatePath('/approvals')
}
async function notifyReceipt(r:{id:string;receipt_number:string;business_id:string;prepared_by:string|null;received_by:string|null},action:string){
 const url=`/logistics/inventory?tab=receipts&receipt=${r.id}`;const base={entity_table:'logistics_receipts',entity_id:r.id,action_url:url};
 const owner=[r.prepared_by,r.received_by].filter(Boolean) as string[];
 try{
  if(action==='prepared')await notifyWorkflowRole(r.business_id,'logistics','reviewer',{...base,title:`Goods receipt ${r.receipt_number} needs review`,message:'A goods receipt was prepared and is awaiting your review.'});
  else if(action==='reviewed')await notifyWorkflowRole(r.business_id,'logistics','approver',{...base,title:`Goods receipt ${r.receipt_number} needs approval`,message:'A goods receipt was reviewed and is awaiting your approval.'});
  else if(action==='returned')await notifyUsers(owner,r.business_id,{...base,title:`Goods receipt ${r.receipt_number} returned`,message:'Returned by the reviewer for correction.'});
  else if(action==='approved'){await notifyUsers(owner,r.business_id,{...base,title:`Goods receipt ${r.receipt_number} approved`,message:'Approved — it can now be posted to stock.'});}
  else if(action==='posted')await notifyUsers(owner,r.business_id,{...base,title:`Goods receipt ${r.receipt_number} posted`,message:'The accepted quantities are now in stock.'});
 }catch{/* notifications are best-effort; never fail the workflow over them */}
}
export async function prepareReceiptAction(id:string){return transition(id,'prepared','draft','prepared_by','prepared')}
export async function reviewReceiptAction(id:string,accept:boolean){return transition(id,accept?'reviewed':'draft','prepared','reviewed_by',accept?'reviewed':'returned')}
export async function approveReceiptAction(id:string){return transition(id,'approved','reviewed','approved_by','approved')}
export async function postReceiptAction(id:string){
 const p=await logistics(),db=createClient();
 const {error}=await db.rpc('post_receipt_to_stock',{p_receipt_id:id,p_actor:p.user.id});
 if(error)throw appError(error.message);
 await audit(p.user.id,id,'logistics_receipts','posted',{});
 const {data:r}=await db.from('logistics_receipts').select('id,receipt_number,business_id,prepared_by,received_by').eq('id',id).maybeSingle();
 if(r)await notifyReceipt(r as any,'posted');
 revalidatePath('/logistics/inventory');revalidatePath('/finance/accounting');revalidatePath('/approvals')
}
export async function createTransferAction(fd:FormData){const p=await logistics(),db=createClient();if(req(fd,'from_location_id')===req(fd,'to_location_id'))throw appError('Source and destination locations must differ.');const {data,error}=await db.from('logistics_stock_transfers').insert({...biz(p),from_location_id:req(fd,'from_location_id'),to_location_id:req(fd,'to_location_id'),transfer_date:req(fd,'transfer_date'),requested_by:p.user.id,notes:opt(fd,'notes')}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create transfer.');const lines=JSON.parse(String(fd.get('lines')||'[]'));if(!Array.isArray(lines)||!lines.length)throw appError('At least one transfer line is required.');const {error:le}=await db.from('logistics_stock_transfer_items').insert(lines.map((l:any)=>({...biz(p),transfer_id:data.id,inventory_item_id:l.inventory_item_id,quantity:Number(l.quantity),lot_id:l.lot_id||null,notes:l.notes||null})));if(le)throw appError(le.message);await audit(p.user.id,data.id,'logistics_stock_transfers','transfer_created',{});revalidatePath('/logistics/inventory')}
async function transferTransition(id:string,status:string,from:string,actorField:string,action:string){const p=await logistics(),db=createClient();const patch:any={status,updated_at:new Date().toISOString()};if(actorField){patch[actorField]=p.user.id;patch[actorField.replace('_by','_at')]=new Date().toISOString()}const {error}=await db.from('logistics_stock_transfers').update(patch).eq('id',id).eq('status',from);if(error)throw appError(error.message);await audit(p.user.id,id,'logistics_stock_transfers',action,{});revalidatePath('/logistics/inventory');revalidatePath('/approvals')}
export async function prepareTransferAction(id:string){return transferTransition(id,'prepared','draft','prepared_by','prepared')}
export async function reviewTransferAction(id:string,accept:boolean){return transferTransition(id,accept?'reviewed':'draft','prepared','reviewed_by',accept?'reviewed':'returned')}
export async function approveTransferAction(id:string){return transferTransition(id,'approved','reviewed','approved_by','approved')}
export async function postTransferAction(id:string){const p=await logistics(),db=createClient();const {error}=await db.rpc('post_transfer_to_stock',{p_transfer_id:id,p_actor:p.user.id});if(error)throw appError(error.message);await audit(p.user.id,id,'logistics_stock_transfers','posted',{});revalidatePath('/logistics/inventory');revalidatePath('/approvals')}
// LOG-13/15: ordered / already received (any receipt status) / outstanding per
// PO line, from the database, for the receiving form.
export async function poReceivingStatusAction(purchaseOrderId:string):Promise<{inventory_item_id:string|null;procurement_item_id:string;description:string|null;ordered:number;received:number;outstanding:number}[]>{
 await logistics();const db=createClient();
 const {data,error}=await db.rpc('logistics_po_receiving_status',{p_po:purchaseOrderId});
 if(error)throw appError(error.message);
 return ((data??[]) as any[]).map(r=>({inventory_item_id:r.inventory_item_id,procurement_item_id:r.procurement_item_id,description:r.description,ordered:Number(r.ordered),received:Number(r.received),outstanding:Number(r.outstanding)}));
}

// ---------------------------------------------------------------------------
// Build 78 — lots (migration 20261208). Lot pickers, register, aging and trace
// read through SECURITY DEFINER functions that never return a lot's price to a
// user who may not see cost.
export type LotRow={lot_id:string;lot_code:string;received_date:string;supplier:string|null;supplier_lot_no:string|null;expiry_date:string|null;age_days:number;on_hand_here:number;on_hand_total:number;unit_cost:number|null};
async function lotReader(){const p=await getSessionProfile();if(!p?.user.is_active)throw appError('Authentication required.');return p}
export async function lotsForInventoryItemAction(inventoryItemId:string,locationId:string|null){await lotReader();if(!inventoryItemId)return [] as LotRow[];const {data,error}=await createClient().rpc('inventory_lots_for_item',{p_catalog_item:null,p_location:locationId||null,p_inventory_item:inventoryItemId});if(error)throw appError(error.message);return (data??[]) as LotRow[]}
export async function lotsForCatalogItemAction(catalogItemId:string,locationId:string|null){await lotReader();const {data,error}=await createClient().rpc('inventory_lots_for_item',{p_catalog_item:catalogItemId,p_location:locationId||null,p_inventory_item:null});if(error)throw appError(error.message);return (data??[]) as LotRow[]}
export async function lotTraceAction(lotId:string){await lotReader();const {data,error}=await createClient().rpc('inventory_lot_trace',{p_lot:lotId});if(error)throw appError(error.message);return data as any}
