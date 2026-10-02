'use server';
import { appError } from '@/core/errors/appError';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier, grantSatisfies } from '@/core/auth/types';
import { notifyWorkflowRole, notifyUsers } from '@/shared/notifications/service';

function req(fd: FormData, key: string) { const v=String(fd.get(key)??'').trim(); if(!v) throw appError(`${key.replaceAll('_',' ')} is required.`); return v; }
function opt(fd: FormData,key:string){const v=String(fd.get(key)??'').trim();return v||null;}
async function finance(){const p=await getSessionProfile();if(!p?.user.is_active)throw appError('Authentication required.');if(!isAdminTier(p)&&p.user.section_code!=='finance'&&!p.access.some(a=>a.section_code==='finance'))throw appError('Finance access required.');return p;}
function hasFinanceWorkflowRole(p:any, role:'preparer'|'reviewer'|'approver'){if(isAdminTier(p))return true;if(p.user.section_code==='finance'&&p.user.role==='finance'&&role==='preparer')return true;return p.access.some((a:any)=>a.section_code==='finance'&&grantSatisfies(a.workflow_role,role));}
function requireFinanceWorkflowRole(p:any, role:'preparer'|'reviewer'|'approver'){if(!hasFinanceWorkflowRole(p,role))throw appError(`Finance ${role} access required.`);}
function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
async function audit(actor:string,id:string,table:string,action:string,detail:Record<string,unknown>){const {error}=await createClient().from('audit_log').insert({actor_id:actor,entity_table:table,entity_id:id,action,detail});if(error)throw appError(error.message);}

// U050 — controlled supplier creation, mirroring CAT-09's duplicate-product
// check: the supplier master is shared across every business, so a second
// record for the same company splits its purchase history, credit exposure
// and relationships. Reject a case/space-insensitive legal-name match or a
// matching tax id, naming the existing record.
async function assertNoDuplicateSupplier(db:ReturnType<typeof createClient>,legalName:string,taxId:string|null,excludeId?:string){
 const norm=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
 const {data:candidates,error}=await db.from('finance_suppliers').select('id,supplier_code,legal_name,tax_id').ilike('legal_name',legalName.trim().replace(/[%_]/g,'\\$&'));
 if(error)throw appError(error.message);
 const byName=(candidates??[]).find((c:any)=>c.id!==excludeId&&norm(c.legal_name)===norm(legalName));
 if(byName)throw appError(`A supplier with this legal name already exists: ${byName.supplier_code} — ${byName.legal_name}. Use the existing supplier instead of creating a duplicate.`);
 const tin=(taxId||'').replace(/[^0-9a-z]/gi,'');
 if(tin){/* U052 (Build 77): tax IDs live in finance_supplier_private (Finance/admin only) */const {data:sameTax,error:te}=await db.from('finance_supplier_private').select('id:supplier_id,tax_id,supplier:finance_suppliers!inner(supplier_code,legal_name)').not('tax_id','is',null);if(te)throw appError(te.message);const hit=(sameTax??[]).map((c:any)=>({...c,supplier_code:c.supplier?.supplier_code,legal_name:c.supplier?.legal_name})).find((c:any)=>c.id!==excludeId&&String(c.tax_id||'').replace(/[^0-9a-z]/gi,'').toLowerCase()===tin.toLowerCase());if(hit)throw appError(`Another supplier already has this tax ID: ${hit.supplier_code} — ${hit.legal_name}.`);}
}
// U052 (Build 77): tax ID, bank details and payment destination are kept in
// finance_supplier_private (readable by Finance / admin only), never on the
// shared supplier row that every signed-in user can read.
async function savePrivateDetails(db:ReturnType<typeof createClient>,supplierId:string,fd:FormData){const {error}=await db.rpc('supplier_set_private_details',{p_supplier_id:supplierId,p_tax_id:opt(fd,'tax_id'),p_bank_details:opt(fd,'bank_details'),p_payment_destination:opt(fd,'payment_destination')});if(error)throw appError(error.message);}
export async function createSupplierAction(fd:FormData){const p=await finance(),db=createClient();await assertNoDuplicateSupplier(db,req(fd,'legal_name'),opt(fd,'tax_id'));const {data,error}=await db.from('finance_suppliers').insert({legal_name:req(fd,'legal_name'),trade_name:opt(fd,'trade_name'),contact_person:opt(fd,'contact_person'),email:opt(fd,'email'),phone:opt(fd,'phone'),address:opt(fd,'address'),billing_address:opt(fd,'billing_address'),shipping_address:opt(fd,'shipping_address'),payment_terms:opt(fd,'payment_terms'),credit_limit:(opt(fd,'credit_limit')===null?null:Number(opt(fd,'credit_limit'))),credit_currency:opt(fd,'credit_currency')||'PHP',credit_warning_enabled:String(fd.get('credit_warning_enabled')||'')==='true',preferred_payment_method:opt(fd,'preferred_payment_method'),notes:opt(fd,'notes'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create supplier.');await savePrivateDetails(db,data.id,fd);await audit(p.user.id,data.id,'finance_suppliers','supplier_created',{});revalidatePath('/finance/procurement');}

export async function updateSupplierAction(fd:FormData){const p=await finance(),db=createClient();const id=req(fd,'supplier_id');await assertNoDuplicateSupplier(db,req(fd,'legal_name'),opt(fd,'tax_id'),id);const creditLimitRaw=opt(fd,'credit_limit');const creditLimit=creditLimitRaw===null?null:Number(creditLimitRaw);if(creditLimit!==null&&(!Number.isFinite(creditLimit)||creditLimit<0))throw appError('Credit limit must be zero or greater.');const {data,error}=await db.from('finance_suppliers').update({legal_name:req(fd,'legal_name'),trade_name:opt(fd,'trade_name'),contact_person:opt(fd,'contact_person'),email:opt(fd,'email'),phone:opt(fd,'phone'),address:opt(fd,'address'),billing_address:opt(fd,'billing_address'),shipping_address:opt(fd,'shipping_address'),payment_terms:opt(fd,'payment_terms'),preferred_payment_method:opt(fd,'preferred_payment_method'),notes:opt(fd,'notes'),credit_limit:creditLimit,credit_currency:opt(fd,'credit_currency')||'PHP',credit_warning_enabled:String(fd.get('credit_warning_enabled')||'')==='true',updated_at:new Date().toISOString()}).eq('id',id).select('id').single();if(error||!data)throw appError(error?.message||'Unable to update supplier.');await savePrivateDetails(db,id,fd);await audit(p.user.id,id,'finance_suppliers','supplier_updated',{});revalidatePath('/finance/procurement');}
export async function setSupplierDocumentStatusAction(id:string,status:'active'|'superseded'|'archived'){const p=await finance(),db=createClient();const {data,error}=await db.from('finance_supplier_documents').update({status,updated_at:new Date().toISOString()}).eq('id',id).select('id,supplier_id,status').single();if(error||!data)throw appError(error?.message||'Unable to update supplier document.');await audit(p.user.id,id,'finance_supplier_documents','supplier_document_status_changed',{status});revalidatePath('/finance/procurement');}
export async function getSupplierDocumentUrlAction(id:string){await finance();const db=createAdminClient();const dbc=createClient();const {data,error}=await dbc.from('finance_supplier_documents').select('storage_path,document_name').eq('id',id).single();if(error||!data)throw appError(error?.message||'Supplier document not found.');const {data:urlData,error:urlError}=await db.storage.from('supplier-documents').createSignedUrl(data.storage_path,300);if(urlError||!urlData?.signedUrl)throw appError(urlError?.message||'Unable to create document link.');return {url:urlData.signedUrl,name:data.document_name};}
export async function updateSupplierCreditAction(fd:FormData){const p=await finance(),db=createClient();const id=req(fd,'supplier_id');const raw=opt(fd,'credit_limit');const creditLimit=raw===null?null:Number(raw);if(creditLimit!==null&&(!Number.isFinite(creditLimit)||creditLimit<0))throw appError('Credit limit must be zero or greater.');const {error}=await db.from('finance_suppliers').update({credit_limit:creditLimit,credit_currency:opt(fd,'credit_currency')||'PHP',credit_warning_enabled:String(fd.get('credit_warning_enabled')||'')==='true',updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_suppliers','supplier_credit_terms_updated',{credit_limit:creditLimit});revalidatePath('/finance/procurement');}

export async function toggleSupplierContactAction(id:string,active:boolean){const p=await finance(),db=createClient();const {error}=await db.from('finance_supplier_contacts').update({active,updated_at:new Date().toISOString(),is_primary:active?undefined:false}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_supplier_contacts',active?'supplier_contact_activated':'supplier_contact_deactivated',{});revalidatePath('/finance/procurement');}
export async function createSupplierContactAction(fd:FormData){const p=await finance(),db=createClient();const supplierId=req(fd,'supplier_id');const {data,error}=await db.from('finance_supplier_contacts').insert({supplier_id:supplierId,contact_name:req(fd,'contact_name'),job_title:opt(fd,'job_title'),email:opt(fd,'contact_email'),phone:opt(fd,'contact_phone'),mobile:opt(fd,'mobile'),is_primary:String(fd.get('is_primary')||'')==='true',notes:opt(fd,'contact_notes'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create supplier contact.');await audit(p.user.id,data.id,'finance_supplier_contacts','supplier_contact_created',{supplier_id:supplierId});revalidatePath('/finance/procurement');}
export async function uploadSupplierDocumentAction(fd:FormData){const p=await finance(),db=createAdminClient(),dbc=createClient();const supplierId=req(fd,'supplier_id');const file=fd.get('document');if(!(file instanceof File)||file.size===0)throw appError('Select a supplier document.');if(file.size>10*1024*1024)throw appError('Supplier documents must be 10 MB or smaller.');const allowed=['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'];if(file.type&&!allowed.includes(file.type))throw appError('Unsupported document type. Use PDF, JPG, PNG or Word.');const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_');const path=`${supplierId}/${crypto.randomUUID()}-${safe}`;const {error:up}=await db.storage.from('supplier-documents').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(up)throw appError(up.message);const {data,error}=await dbc.from('finance_supplier_documents').insert({supplier_id:supplierId,document_type:req(fd,'document_type'),document_name:file.name,storage_path:path,issue_date:opt(fd,'issue_date'),expiry_date:opt(fd,'expiry_date'),notes:opt(fd,'document_notes'),uploaded_by:p.user.id}).select('id').single();if(error||!data){await db.storage.from('supplier-documents').remove([path]);throw appError(error?.message||'Unable to save supplier document.');}await audit(p.user.id,data.id,'finance_supplier_documents','supplier_document_uploaded',{supplier_id:supplierId,document_name:file.name});revalidatePath('/finance/procurement');}

export async function toggleSupplierAction(id:string,active:boolean){const p=await finance(),db=createClient();const {error}=await db.from('finance_suppliers').update({active,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_suppliers',active?'supplier_activated':'supplier_deactivated',{});revalidatePath('/finance/procurement');}

// SUP-05: finance_suppliers is a deliberately GLOBAL shared master; this
// upserts the current business's own status/terms/notes overlay for a
// given supplier, never touching the global row.
export async function upsertSupplierBusinessRelationshipAction(fd:FormData){const p=await finance();const businessId=p.user.business_id;if(!businessId)throw appError('Select an acting business before setting supplier relationship terms.');const db=createClient();const supplierId=req(fd,'supplier_id');const status=req(fd,'status');if(!['active','inactive'].includes(status))throw appError('Invalid relationship status.');const {data,error}=await db.from('finance_supplier_business_relationships').upsert({business_id:businessId,supplier_id:supplierId,status,payment_terms_override:opt(fd,'payment_terms_override'),preferred:String(fd.get('preferred')||'')==='true',relationship_notes:opt(fd,'relationship_notes'),created_by:p.user.id,updated_at:new Date().toISOString()},{onConflict:'business_id,supplier_id'}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to save supplier relationship.');await audit(p.user.id,data.id,'finance_supplier_business_relationships','supplier_business_relationship_saved',{supplier_id:supplierId,business_id:businessId,status});revalidatePath('/finance/procurement');}
// Build 60: catalog item create/update/import moved to catalogItemActions.ts
export async function createRequisitionAction(fd:FormData){const p=await finance();requireFinanceWorkflowRole(p,'preparer');const db=createClient();const lines=JSON.parse(String(fd.get('lines')||'[]')) as Array<{item_id?:string;description:string;quantity:number;unit:string;estimated_unit_cost:number;notes?:string}>;if(!lines.length)throw appError('Add at least one requisition line.');const requestedFor=opt(fd,'requested_for_employee_id')||null;let department:string|null=null;if(requestedFor){const {data:re}=await db.from('employees').select('department').eq('id',requestedFor).single();if(!re)throw appError('Requested employee not found.');department=re.department||null;}else{const {data:me}=await db.from('employees').select('department').eq('user_id',p.user.id).maybeSingle();department=me?.department||null;}const estimatedTotal=lines.reduce((s,l)=>s+(Number(l.quantity)||0)*(Number(l.estimated_unit_cost)||0),0);const {data,error}=await db.from('purchase_requisitions').insert({...biz(p),requested_by:p.user.id,requested_for_employee_id:requestedFor,department,needed_by:opt(fd,'needed_by'),purpose:req(fd,'purpose'),notes:opt(fd,'notes'),estimated_total:estimatedTotal}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create purchase requisition.');const {error:le}=await db.from('purchase_requisition_items').insert(lines.map(l=>({...biz(p),requisition_id:data.id,item_id:l.item_id||null,description:l.description,quantity:Number(l.quantity),unit:l.unit||'unit',estimated_unit_cost:Number(l.estimated_unit_cost)||0,notes:l.notes||null})));if(le){await db.from('purchase_requisitions').delete().eq('id',data.id);throw appError(le.message);}await audit(p.user.id,data.id,'purchase_requisitions','purchase_requisition_created',{estimated_total:estimatedTotal});revalidatePath('/finance/procurement');}
export async function prepareRequisitionAction(id:string){const p=await finance();requireFinanceWorkflowRole(p,'preparer');const db=createClient();const {data,error}=await db.from('purchase_requisitions').update({status:'prepared',prepared_by:p.user.id,prepared_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('status','draft').select('business_id,pr_number').single();if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_requisitions','prepared',{});
 // PR-13: hand off to whoever holds the reviewer role in Finance for this business.
 if(data) await notifyWorkflowRole(data.business_id,'finance','reviewer',{title:`PR ${data.pr_number} needs review`,message:'A purchase requisition was submitted and is awaiting your review.',entity_table:'purchase_requisitions',entity_id:id,action_url:'/finance/procurement'});
 revalidatePath('/finance/procurement');revalidatePath('/approvals');}
export async function reviewRequisitionAction(id:string,approve:boolean,reason?:string){const p=await finance();requireFinanceWorkflowRole(p,'reviewer');const db=createClient();const next=approve?'reviewed':'draft';const patch:any={status:next,reviewed_by:approve?p.user.id:null,reviewed_at:approve?new Date().toISOString():null,rejection_reason:approve?null:(reason||'Returned by reviewer.'),updated_at:new Date().toISOString()};const {data,error}=await db.from('purchase_requisitions').update(patch).eq('id',id).eq('status','prepared').select('business_id,pr_number,prepared_by').single();if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_requisitions',approve?'reviewed':'returned',{reason:reason||null});
 // PR-13: notify the approver on review, or notify the preparer (originator of this hop) on return.
 if(data){
   if(approve) await notifyWorkflowRole(data.business_id,'finance','approver',{title:`PR ${data.pr_number} needs approval`,message:'A purchase requisition was reviewed and is awaiting your approval.',entity_table:'purchase_requisitions',entity_id:id,action_url:'/finance/procurement'});
   else if(data.prepared_by) await notifyUsers([data.prepared_by],data.business_id,{title:`PR ${data.pr_number} returned`,message:reason||'Returned by reviewer for correction.',entity_table:'purchase_requisitions',entity_id:id,action_url:'/finance/procurement'});
 }
 revalidatePath('/finance/procurement');revalidatePath('/approvals');}
// PR-10/PR-11: this is the ONE authoritative place a PR's approval decision is
// made and logged (audit_log). /approvals is a valid alternate UI entry point
// for the same decision, but it delegates here rather than re-implementing
// the transition, so there is a single mechanism and a single history trail
// regardless of which screen a reviewer/approver actually uses.
export async function approveRequisitionAction(id:string,approve:boolean=true,reason?:string){const p=await finance();requireFinanceWorkflowRole(p,'approver');const db=createClient();const next=approve?'approved':'draft';const patch:any={status:next,updated_at:new Date().toISOString()};if(approve){patch.approved_by=p.user.id;patch.approved_at=new Date().toISOString();}else{patch.rejection_reason=reason||'Returned by approver.';patch.reviewed_by=null;patch.reviewed_at=null;}const {data,error}=await db.from('purchase_requisitions').update(patch).eq('id',id).eq('status','reviewed').select('business_id,pr_number,requested_by,prepared_by').single();if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_requisitions',approve?'approved':'returned',{reason:approve?undefined:(reason||null)});
 // PR-13: notify the original requester once approved (their turn to convert to a PO or wait), or the preparer if the approver sends it back.
 if(data){
   const recipient=approve?data.requested_by:data.prepared_by;
   if(recipient) await notifyUsers([recipient],data.business_id,{title:approve?`PR ${data.pr_number} approved`:`PR ${data.pr_number} returned`,message:approve?'Your purchase requisition was approved.':(reason||'Returned by approver for correction.'),entity_table:'purchase_requisitions',entity_id:id,action_url:'/finance/procurement'});
 }
 revalidatePath('/finance/procurement');revalidatePath('/approvals');}

export async function createPurchaseOrderFromRequisitionAction(fd:FormData){
 const p=await finance(); requireFinanceWorkflowRole(p,'preparer'); const db=createClient();
 const requisitionId=req(fd,'requisition_id'); const supplierId=req(fd,'supplier_id');
 const {data:pr,error:pe}=await db.from('purchase_requisitions').select('id,pr_number,status,estimated_total').eq('id',requisitionId).single();
 if(pe||!pr) throw appError(pe?.message||'Purchase requisition not found.');
 if(pr.status!=='approved') throw appError('Only an approved purchase requisition can be converted to a purchase order.');
 const {data:sourceLines,error:le}=await db.from('purchase_requisition_items').select('id,item_id,description,quantity,unit,estimated_unit_cost,notes').eq('requisition_id',requisitionId).order('created_at');
 if(le) throw appError(le.message); if(!sourceLines?.length) throw appError('The approved purchase requisition has no line items.');
 const sourceById=new Map(sourceLines.map((l:any)=>[l.id,l]));
 // PO-04/PO-05: the ordered lines submitted by the preparer may adjust
 // quantity/cost from what was requested, but every line must still trace
 // back to a line actually on THIS requisition — no substituting arbitrary
 // lines in under an approved PR's cover — and every requested-vs-ordered
 // change is captured for audit, not silently accepted.
 const submitted=JSON.parse(String(fd.get('lines')||'[]')) as Array<{source_requisition_item_id?:string;item_id?:string;description:string;quantity:number;unit:string;unit_cost:number;notes?:string}>;
 const orderedLines=submitted.length?submitted:sourceLines.map((l:any)=>({source_requisition_item_id:l.id,item_id:l.item_id,description:l.description,quantity:l.quantity,unit:l.unit,unit_cost:l.estimated_unit_cost,notes:l.notes}));
 const changes:{description:string;requested_quantity:number;ordered_quantity:number;requested_unit_cost:number;ordered_unit_cost:number}[]=[];
 for(const l of orderedLines){
   if(l.source_requisition_item_id){
     const src:any=sourceById.get(l.source_requisition_item_id);
     if(!src) throw appError('A submitted line does not belong to this purchase requisition.');
     if(Number(l.quantity)!==Number(src.quantity)||Number(l.unit_cost)!==Number(src.estimated_unit_cost)){
       changes.push({description:l.description||src.description,requested_quantity:Number(src.quantity),ordered_quantity:Number(l.quantity),requested_unit_cost:Number(src.estimated_unit_cost),ordered_unit_cost:Number(l.unit_cost)});
     }
   }
 }
 const subtotal=orderedLines.reduce((sum:number,l:any)=>sum+(Number(l.quantity)||0)*(Number(l.unit_cost)||0),0);
 const {data:po,error}=await db.from('purchase_orders').insert({...biz(p),requisition_id:requisitionId,supplier_id:supplierId,order_date:opt(fd,'order_date')||new Date().toISOString().slice(0,10),expected_delivery_date:opt(fd,'expected_delivery_date'),delivery_address:opt(fd,'delivery_address'),payment_terms:opt(fd,'payment_terms'),notes:opt(fd,'notes'),subtotal,tax_amount:Number(fd.get('tax_amount')||0),other_charges:Number(fd.get('other_charges')||0),prepared_by:p.user.id}).select('id,po_number').single();
 if(error||!po) throw appError(error?.message||'Unable to create purchase order.');
 const {error:ile}=await db.from('purchase_order_items').insert(orderedLines.map((l:any)=>({...biz(p),purchase_order_id:po.id,source_requisition_item_id:l.source_requisition_item_id||null,item_id:l.item_id||null,description:l.description,quantity:Number(l.quantity),unit:l.unit||'unit',unit_cost:Number(l.unit_cost)||0,notes:l.notes||null})));
 if(ile){await db.from('purchase_orders').delete().eq('id',po.id);throw appError(ile.message);}
 await audit(p.user.id,po.id,'purchase_orders','purchase_order_created_from_requisition',{requisition_id:requisitionId,pr_number:pr.pr_number,source_line_count:sourceLines.length,requested_vs_ordered_changes:changes});
 revalidatePath('/finance/procurement'); return {id:po.id,po_number:po.po_number};
}

export async function createPurchaseOrderAction(fd:FormData){const p=await finance();requireFinanceWorkflowRole(p,'preparer');const db=createClient();const lines=JSON.parse(String(fd.get('lines')||'[]')) as Array<{item_id?:string;description:string;quantity:number;unit:string;unit_cost:number;notes?:string}>;if(!lines.length)throw appError('Add at least one purchase-order line.');const subtotal=lines.reduce((s,l)=>s+(Number(l.quantity)||0)*(Number(l.unit_cost)||0),0);const {data,error}=await db.from('purchase_orders').insert({...biz(p),requisition_id:opt(fd,'requisition_id'),supplier_id:req(fd,'supplier_id'),order_date:req(fd,'order_date'),expected_delivery_date:opt(fd,'expected_delivery_date'),delivery_address:opt(fd,'delivery_address'),payment_terms:opt(fd,'payment_terms'),notes:opt(fd,'notes'),subtotal,tax_amount:Number(fd.get('tax_amount')||0),other_charges:Number(fd.get('other_charges')||0),prepared_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create purchase order.');const {error:le}=await db.from('purchase_order_items').insert(lines.map(l=>({...biz(p),purchase_order_id:data.id,item_id:l.item_id||null,description:l.description,quantity:Number(l.quantity),unit:l.unit||'unit',unit_cost:Number(l.unit_cost)||0,notes:l.notes||null})));if(le){await db.from('purchase_orders').delete().eq('id',data.id);throw appError(le.message);}await audit(p.user.id,data.id,'purchase_orders','purchase_order_created',{subtotal});revalidatePath('/finance/procurement');}
export async function preparePurchaseOrderAction(id:string){const p=await finance();requireFinanceWorkflowRole(p,'preparer');const db=createClient();const {data,error}=await db.from('purchase_orders').update({status:'prepared',prepared_by:p.user.id,prepared_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('status','draft').select('business_id,po_number').single();if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_orders','prepared',{});
 if(data) await notifyWorkflowRole(data.business_id,'finance','reviewer',{title:`PO ${data.po_number} needs review`,message:'A purchase order was submitted and is awaiting your review.',entity_table:'purchase_orders',entity_id:id,action_url:'/finance/procurement'});
 revalidatePath('/finance/procurement');revalidatePath('/approvals');}
export async function reviewPurchaseOrderAction(id:string,approve:boolean,reason?:string){const p=await finance();requireFinanceWorkflowRole(p,'reviewer');const db=createClient();const next=approve?'reviewed':'draft';const {data,error}=await db.from('purchase_orders').update({status:next,reviewed_by:approve?p.user.id:null,reviewed_at:approve?new Date().toISOString():null,rejection_reason:approve?null:(reason||'Returned by reviewer.'),updated_at:new Date().toISOString()}).eq('id',id).eq('status','prepared').select('business_id,po_number,prepared_by').single();if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_orders',approve?'reviewed':'returned',{reason:reason||null});
 if(data){
   if(approve) await notifyWorkflowRole(data.business_id,'finance','approver',{title:`PO ${data.po_number} needs approval`,message:'A purchase order was reviewed and is awaiting your approval.',entity_table:'purchase_orders',entity_id:id,action_url:'/finance/procurement'});
   else if(data.prepared_by) await notifyUsers([data.prepared_by],data.business_id,{title:`PO ${data.po_number} returned`,message:reason||'Returned by reviewer for correction.',entity_table:'purchase_orders',entity_id:id,action_url:'/finance/procurement'});
 }
 revalidatePath('/finance/procurement');revalidatePath('/approvals');}
export async function approvePurchaseOrderAction(id:string,approve:boolean=true,reason?:string){const p=await finance();requireFinanceWorkflowRole(p,'approver');const db=createClient();const next=approve?'approved':'draft';const patch:any={status:next,updated_at:new Date().toISOString()};if(approve){patch.approved_by=p.user.id;patch.approved_at=new Date().toISOString();}else{patch.rejection_reason=reason||'Returned by approver.';patch.reviewed_by=null;patch.reviewed_at=null;}const {data,error}=await db.from('purchase_orders').update(patch).eq('id',id).eq('status','reviewed').select('business_id,po_number,prepared_by').single();if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_orders',approve?'approved':'returned',{reason:approve?undefined:(reason||null)});
 if(data?.prepared_by) await notifyUsers([data.prepared_by],data.business_id,{title:approve?`PO ${data.po_number} approved`:`PO ${data.po_number} returned`,message:approve?'Your purchase order was approved and can now be issued to the supplier.':(reason||'Returned by approver for correction.'),entity_table:'purchase_orders',entity_id:id,action_url:'/finance/procurement'});
 revalidatePath('/finance/procurement');revalidatePath('/approvals');}
export async function issuePurchaseOrderAction(fd:FormData){const p=await finance();requireFinanceWorkflowRole(p,'approver');const db=createClient();const id=req(fd,'po_id');const method=req(fd,'issuance_method');const {error}=await db.rpc('issue_purchase_order',{p_po_id:id,p_actor:p.user.id,p_method:method});if(error)throw appError(error.message);await audit(p.user.id,id,'purchase_orders','issued',{issuance_method:method});revalidatePath('/finance/procurement');}


export async function addCatalogSupplierAction(fd:FormData){const p=await finance(),db=createClient();const itemId=req(fd,'item_id'),supplierId=req(fd,'supplier_id');const {data,error}=await db.from('finance_procurement_item_suppliers').insert({item_id:itemId,supplier_id:supplierId,supplier_item_code:opt(fd,'supplier_item_code'),supplier_description:opt(fd,'supplier_description'),last_purchase_cost:fd.get('last_purchase_cost')?Number(fd.get('last_purchase_cost')):null,preferred:String(fd.get('preferred')||'')==='true',created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to add supplier relationship.');await audit(p.user.id,data.id,'finance_procurement_item_suppliers','catalog_supplier_relationship_created',{item_id:itemId,supplier_id:supplierId});revalidatePath('/finance/procurement');}
export async function toggleCatalogSupplierRelationshipAction(id:string,active:boolean){const p=await finance(),db=createClient();const {error}=await db.from('finance_procurement_item_suppliers').update({active,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_procurement_item_suppliers',active?'catalog_supplier_relationship_activated':'catalog_supplier_relationship_deactivated',{});revalidatePath('/finance/procurement');}
export async function toggleCatalogItemAction(id:string,active:boolean){const p=await finance(),db=createClient();const {error}=await db.from('finance_procurement_items').update({active,updated_at:new Date().toISOString()}).eq('id',id);if(error?.code==='23505')throw appError('This item cannot be activated: another active catalog item already has the same name, category and unit. Edit its name first, or keep the other item.');if(error)throw appError(error.message);await audit(p.user.id,id,'finance_procurement_items',active?'catalog_item_activated':'catalog_item_deactivated',{});revalidatePath('/finance/procurement');}
export async function createCatalogCategoryAction(fd:FormData){const p=await finance();if(p.user.role!=='super_admin')throw appError('Only Global Super Admin can change catalog schema masters.');const name=req(fd,'name');const {data,error}=await createClient().from('finance_catalog_categories').insert({name}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create category.');await audit(p.user.id,data.id,'finance_catalog_categories','catalog_category_created',{name});revalidatePath('/finance/procurement');}
export async function toggleCatalogCategoryAction(id:string,active:boolean){const p=await finance();if(p.user.role!=='super_admin')throw appError('Only Global Super Admin can change catalog schema masters.');const {error}=await createClient().from('finance_catalog_categories').update({active}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_catalog_categories',active?'catalog_category_activated':'catalog_category_deactivated',{});revalidatePath('/finance/procurement');}
export async function createCatalogUnitAction(fd:FormData){const p=await finance();if(p.user.role!=='super_admin')throw appError('Only Global Super Admin can change catalog schema masters.');const name=req(fd,'name');const {data,error}=await createClient().from('finance_catalog_units').insert({name}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create unit.');await audit(p.user.id,data.id,'finance_catalog_units','catalog_unit_created',{name});revalidatePath('/finance/procurement');}
export async function toggleCatalogUnitAction(id:string,active:boolean){const p=await finance();if(p.user.role!=='super_admin')throw appError('Only Global Super Admin can change catalog schema masters.');const {error}=await createClient().from('finance_catalog_units').update({active}).eq('id',id);if(error)throw appError(error.message);await audit(p.user.id,id,'finance_catalog_units',active?'catalog_unit_activated':'catalog_unit_deactivated',{});revalidatePath('/finance/procurement');}

export async function upsertCatalogCategoryPricingAction(fd:FormData){
 const p=await finance(); const db=createClient();
 const categoryId=req(fd,'category_id'); const addon=Number(fd.get('addon_percent')||0);
 if(!Number.isFinite(addon)||addon<0||addon>1000) throw appError('Category add-on must be between 0% and 1000%.');
 if(!p.user.business_id) throw appError('Select a business in "Acting as" before setting a category add-on — add-ons are set per business.');
 const {data,error}=await db.from('finance_catalog_category_pricing').upsert({business_id:p.user.business_id,category_id:categoryId,addon_percent:addon,active:true,updated_at:new Date().toISOString(),created_by:p.user.id},{onConflict:'business_id,category_id'}).select('id').single();
 if(error||!data) throw appError(error?.message||'Unable to save category pricing.');
 await audit(p.user.id,data.id,'finance_catalog_category_pricing','category_addon_updated',{addon_percent:addon}); revalidatePath('/finance/procurement');
}
export async function upsertCatalogItemPricingAction(fd:FormData){
 const p=await finance(); const db=createClient();
 const itemId=req(fd,'item_id'); const markup=Number(fd.get('markup_percent')||0);
 if(!Number.isFinite(markup)||markup<0||markup>1000) throw appError('Item markup must be between 0% and 1000%.');
 if(!p.user.business_id) throw appError('Select a business in "Acting as" before setting an item markup — markups are set per business.');
 const {data,error}=await db.from('finance_catalog_item_pricing').upsert({business_id:p.user.business_id,item_id:itemId,markup_percent:markup,active:true,updated_at:new Date().toISOString(),created_by:p.user.id},{onConflict:'business_id,item_id'}).select('id').single();
 if(error||!data) throw appError(error?.message||'Unable to save item pricing.');
 await audit(p.user.id,data.id,'finance_catalog_item_pricing','item_markup_updated',{markup_percent:markup}); revalidatePath('/finance/procurement');
}
export async function upsertCatalogCustomerDiscountAction(fd:FormData){
 const p=await finance(); const db=createClient();
 const customerId=req(fd,'customer_id'); const itemId=req(fd,'item_id'); const discount=Number(fd.get('discount_percent')||0);
 if(!Number.isFinite(discount)||discount<0||discount>100) throw appError('Customer discount must be between 0% and 100%.');
 if(!p.user.business_id) throw appError('Select a business in "Acting as" before setting a customer discount.');
 const {data,error}=await db.from('finance_catalog_customer_discounts').upsert({business_id:p.user.business_id,customer_id:customerId,item_id:itemId,discount_percent:discount,active:true,updated_at:new Date().toISOString(),created_by:p.user.id},{onConflict:'customer_id,item_id'}).select('id').single();
 if(error||!data) throw appError(error?.message||'Unable to save customer discount.');
 await audit(p.user.id,data.id,'finance_catalog_customer_discounts','customer_discount_updated',{discount_percent:discount,item_id:itemId}); revalidatePath('/finance/procurement');
}

// ---------------------------------------------------------------------------
// Build 55 — item ↔ supplier purchase price history.
// Rows are created by the database when a PO is approved (PO price), take the
// invoice price automatically when AP records a supplier invoice line linked
// to the PO line, and can be corrected here by a Finance user with a reason.
// All reads/writes go through the session client, so business-isolation RLS
// applies (each business sees only its own purchase prices).
// ---------------------------------------------------------------------------
export async function getItemPriceHistoryAction(itemId:string){
 await finance();
 const db=createClient();
 const [{data:rows,error},{data:links,error:le}]=await Promise.all([
  db.from('finance_item_supplier_price_history').select('id,supplier_id,supplier_item_code,purchase_order_id,purchase_date,quantity,unit,po_unit_price,invoice_unit_price,effective_unit_price,price_source,invoice_reference,adjustment_note,adjusted_at,business_id,supplier:finance_suppliers(supplier_code,legal_name),po:purchase_orders(po_number)').eq('item_id',itemId).order('purchase_date',{ascending:false}).order('created_at',{ascending:false}),
  db.from('finance_procurement_item_suppliers').select('supplier_id,supplier_item_code,preferred,active,supplier:finance_suppliers(supplier_code,legal_name)').eq('item_id',itemId),
 ]);
 if(error)throw appError(error.message);
 if(le)throw appError(le.message);
 return {rows:rows??[],links:links??[]};
}

export async function getLastPurchasePricesAction(itemIds:string[]){
 await finance();
 const ids=[...new Set((itemIds||[]).filter(Boolean))].slice(0,100);
 if(!ids.length)return [];
 const {data,error}=await createClient().from('finance_item_supplier_last_price').select('item_id,supplier_id,supplier_item_code,last_purchase_date,last_unit_price,price_source,business_id,supplier:finance_suppliers(legal_name)').in('item_id',ids);
 if(error)throw appError(error.message);
 return data??[];
}

function requireAnyFinanceWorkflowRole(p:any){if(!(hasFinanceWorkflowRole(p,'preparer')||hasFinanceWorkflowRole(p,'reviewer')||hasFinanceWorkflowRole(p,'approver')))throw appError('A Finance preparer, reviewer or approver role is required to correct a purchase price.');}

export async function adjustPurchasePriceAction(fd:FormData){
 const p=await finance(); requireAnyFinanceWorkflowRole(p); const db=createClient();
 const id=req(fd,'history_id');
 const price=Number(req(fd,'invoice_unit_price'));
 if(!Number.isFinite(price)||price<0)throw appError('Invoice price must be zero or greater.');
 const note=req(fd,'adjustment_note');
 const {data:before,error:be}=await db.from('finance_item_supplier_price_history').select('id,po_unit_price,invoice_unit_price,price_source').eq('id',id).single();
 if(be||!before)throw appError('Purchase price record not found.');
 const {error}=await db.from('finance_item_supplier_price_history').update({invoice_unit_price:price,invoice_reference:opt(fd,'invoice_reference'),price_source:'manual',adjustment_note:note,adjusted_by:p.user.id,adjusted_at:new Date().toISOString()}).eq('id',id);
 if(error)throw appError(error.message);
 await audit(p.user.id,id,'finance_item_supplier_price_history','purchase_price_corrected',{from:{price_source:before.price_source,invoice_unit_price:before.invoice_unit_price},to:{invoice_unit_price:price},po_unit_price:before.po_unit_price,note});
 revalidatePath('/finance/procurement');
}

export async function revertPurchasePriceAction(id:string){
 const p=await finance(); requireAnyFinanceWorkflowRole(p); const db=createClient();
 const {data:h,error:he}=await db.from('finance_item_supplier_price_history').select('id,purchase_order_item_id,invoice_unit_price,price_source').eq('id',id).single();
 if(he||!h)throw appError('Purchase price record not found.');
 if(h.price_source!=='manual')throw appError('Only a manual correction can be reverted.');
 // Back to the linked AP invoice price if one exists, otherwise the PO price.
 const {data:inv}=await db.from('finance_supplier_invoice_items').select('unit_cost,invoice:finance_supplier_invoices!inner(id,invoice_number,status)').eq('purchase_order_item_id',h.purchase_order_item_id).neq('invoice.status','voided').order('id').limit(1).maybeSingle();
 const patch:any=inv?{invoice_unit_price:(inv as any).unit_cost,supplier_invoice_id:(inv as any).invoice.id,invoice_reference:(inv as any).invoice.invoice_number,price_source:'invoice',adjustment_note:null,adjusted_by:null,adjusted_at:null}:{invoice_unit_price:null,supplier_invoice_id:null,invoice_reference:null,price_source:'po',adjustment_note:null,adjusted_by:null,adjusted_at:null};
 const {error}=await db.from('finance_item_supplier_price_history').update(patch).eq('id',id);
 if(error)throw appError(error.message);
 await audit(p.user.id,id,'finance_item_supplier_price_history','purchase_price_correction_reverted',{from_invoice_unit_price:h.invoice_unit_price,to_source:patch.price_source});
 revalidatePath('/finance/procurement');
}

// ---------------------------------------------------------------------------
// Build 77 — PROC-01 procurement dashboard (computed in the database for the
// viewer's store; see procurement_dashboard()) and CAT-11 pricing history.
// ---------------------------------------------------------------------------
export async function getProcurementDashboardAction(period:'month'|'quarter'|'ytd'){
 await finance();
 const p=['month','quarter','ytd'].includes(period)?period:'month';
 const {data,error}=await createClient().rpc('procurement_dashboard',{p_period:p});
 if(error)throw appError(error.message);
 return data as any;
}
export async function getItemPricingHistoryAction(itemId:string){
 await finance();
 const {data,error}=await createClient().rpc('catalog_item_pricing_history',{p_item_id:itemId});
 if(error)throw appError(error.message);
 return (data??[]) as {id:string;captured_at:string;business_code:string|null;rule_type:string;subject:string;value_percent:number;previous_percent:number|null;effective_from:string|null;captured_by_name:string|null}[];
}
// Build 78 — the item's lots in this store: each receipt (purchase) with its
// supplier, date and price, and what is left of it (inventory_item_purchase_history).
export async function getItemLotsAction(itemId:string){
 await finance();
 const {data,error}=await createClient().rpc('inventory_item_purchase_history',{p_catalog_item:itemId});
 if(error)throw appError(error.message);
 return (data??[]) as {lot_id:string;lot_code:string;received_date:string;supplier:string|null;receipt_number:string|null;po_number:string|null;received_qty:number;unit_cost:number;supplier_lot_no:string|null;on_hand:number;source:string}[];
}
// Build 79 (CAT-37): delete deactivated catalog items that nothing uses (Super Admin; the database decides).
export async function purgeUnusedItemsAction(apply:boolean){
 const p=await finance();
 if(p.user.role!=='super_admin')throw appError('Only the Super Admin can delete catalog items.');
 const {data,error}=await createClient().rpc('catalog_purge_unused',{p_apply:apply});
 if(error)throw appError(error.message);
 if(apply)revalidatePath('/finance/procurement');
 return (data??[]) as {item_id:string;item_code:string;item_name:string;deleted:boolean;reason:string}[];
}
