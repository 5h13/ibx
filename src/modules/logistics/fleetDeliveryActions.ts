'use server';
import { appError } from '@/core/errors/appError';
import {revalidatePath} from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import {getSessionProfile} from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

async function logistics(){
 const p=await getSessionProfile();
 if(!p?.user.is_active) throw appError('Authentication required.');
 if(!isAdminTier(p)&&p.user.role!=='logistics'&&!p.access.some(a=>a.section_code==='logistics')) throw appError('Logistics access required.');
 return p;
}
const required=(fd:FormData,k:string)=>{const v=String(fd.get(k)??'').trim();if(!v)throw appError(`${k.replaceAll('_',' ')} is required.`);return v};
const optional=(fd:FormData,k:string)=>{const v=String(fd.get(k)??'').trim();return v||null};
function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
async function audit(actor:string,id:string,table:string,action:string,detail:Record<string,unknown>={}){const {error}=await createClient().from('audit_log').insert({actor_id:actor,entity_table:table,entity_id:id,action,detail});if(error)throw appError(error.message)}
async function event(db:any,p:{user:{id:string;business_id:string|null}},dispatchId:string,type:string,notes?:string){const {error}=await db.from('logistics_delivery_events').insert({...biz(p),dispatch_id:dispatchId,event_type:type,notes:notes||null,created_by:p.user.id});if(error)throw appError(error.message)}

export async function loadDispatchAction(id:string){
 const p=await logistics(),db=createClient();
 const {data:d,error}=await db.from('logistics_dispatches').select('id,delivery_order_id,delivery_status,vehicle_id,driver_id').eq('id',id).single();
 if(error||!d)throw appError('Dispatch not found.');
 if(!d.vehicle_id||!d.driver_id)throw appError('A vehicle and authorized driver are required before loading.');
 if(d.delivery_status!=='planned')throw appError('Only planned dispatches can be loaded.');
 const {data:v}=await db.from('fleet_vehicles').select('id,status,registration_expiry,insurance_expiry').eq('id',d.vehicle_id).single();
 if(!v||!['available','assigned'].includes(v.status))throw appError('Vehicle is not available for dispatch.');
 const today=new Date().toISOString().slice(0,10);
 if(v.registration_expiry&&v.registration_expiry<today)throw appError('Vehicle registration is expired.');
 if(v.insurance_expiry&&v.insurance_expiry<today)throw appError('Vehicle insurance is expired.');
 const {data:driver}=await db.from('fleet_drivers').select('id,authorized,license_expiry').eq('id',d.driver_id).single();
 if(!driver?.authorized)throw appError('Driver is not authorized.');
 if(driver.license_expiry&&driver.license_expiry<today)throw appError('Driver license is expired.');
 const {data:trip,error:te}=await db.from('fleet_trips').insert({...biz(p),trip_no:`TRIP-${String(d.id).slice(0,8)}-${Date.now().toString().slice(-5)}`,vehicle_id:d.vehicle_id,trip_date:new Date().toISOString().slice(0,10),purpose:'Delivery dispatch',status:'planned',created_by:p.user.id}).select('id').single();
 if(te||!trip)throw appError(te?.message||'Unable to create fleet trip.');
 const now=new Date().toISOString();
 const {error:ue}=await db.from('logistics_dispatches').update({delivery_status:'loaded',fleet_trip_id:trip.id,updated_at:now}).eq('id',id).eq('delivery_status','planned');
 if(ue)throw appError(ue.message);
 await event(db,p,id,'loaded'); await audit(p.user.id,id,'logistics_dispatches','dispatch_loaded',{fleet_trip_id:trip.id});
 revalidatePath('/logistics/warehouse-delivery');
}

export async function startDispatchTripAction(id:string){
 const p=await logistics(),db=createClient();
 const {data:d,error}=await db.from('logistics_dispatches').select('id,delivery_order_id,delivery_status,fleet_trip_id,vehicle_id').eq('id',id).single();
 if(error||!d)throw appError('Dispatch not found.'); if(d.delivery_status!=='loaded'||!d.fleet_trip_id)throw appError('Dispatch must be loaded first.');
 const now=new Date().toISOString();
 const {error:te}=await db.from('fleet_trips').update({status:'started',departure_at:now,updated_at:now}).eq('id',d.fleet_trip_id).eq('status','planned'); if(te)throw appError(te.message);
 const {error:de}=await db.from('logistics_dispatches').update({delivery_status:'in_transit',departure_time:now,updated_at:now}).eq('id',id).eq('delivery_status','loaded'); if(de)throw appError(de.message);
 await db.from('fleet_vehicles').update({status:'in_use',updated_at:now}).eq('id',d.vehicle_id).eq('status','available');
 await db.from('logistics_delivery_orders').update({status:'dispatched',dispatched_at:now,updated_at:now}).eq('id',d.delivery_order_id).eq('status','approved');
 await event(db,p,id,'departed'); await audit(p.user.id,id,'logistics_dispatches','dispatch_departed');
 revalidatePath('/logistics/warehouse-delivery');
}

export async function completeDeliveryOperationsAction(id:string,fd:FormData){
 const p=await logistics(),db=createClient();
 const {data:d,error}=await db.from('logistics_dispatches').select('id,delivery_order_id,delivery_status,fleet_trip_id,vehicle_id,proof_of_delivery_reference,recipient_name').eq('id',id).single();
 if(error||!d)throw appError('Dispatch not found.'); if(d.delivery_status!=='in_transit')throw appError('Dispatch must be in transit.');
 const recipient=optional(fd,'recipient_name'); const pod=optional(fd,'proof_of_delivery_reference'); const notes=optional(fd,'notes');
 if(!recipient)throw appError('Recipient name is required for proof of delivery.');
 const now=new Date().toISOString();
 const {error:de}=await db.from('logistics_dispatches').update({delivery_status:'delivered',actual_arrival:now,proof_of_delivery_reference:pod,recipient_name:recipient,updated_at:now}).eq('id',id).eq('delivery_status','in_transit'); if(de)throw appError(de.message);
 if(d.fleet_trip_id){const {error:te}=await db.from('fleet_trips').update({status:'completed',return_at:now,updated_at:now,notes:notes||undefined}).eq('id',d.fleet_trip_id);if(te)throw appError(te.message)}
 if(d.vehicle_id) await db.from('fleet_vehicles').update({status:'available',updated_at:now}).eq('id',d.vehicle_id);
 await db.from('logistics_delivery_orders').update({status:'delivered',delivered_at:now,updated_at:now}).eq('id',d.delivery_order_id).eq('status','dispatched');
 const {data:lines}=await db.from('logistics_delivery_order_items').select('id,inventory_item_id,quantity').eq('delivery_order_id',d.delivery_order_id);
 const {data:order}=await db.from('logistics_delivery_orders').select('source_location_id,delivery_number').eq('id',d.delivery_order_id).single();
 for(const line of lines??[]){const {error:me}=await db.from('logistics_stock_movements').insert({...biz(p),movement_number:`ISS-${String(d.delivery_order_id).slice(0,8)}-${String(line.id).slice(0,8)}`,inventory_item_id:line.inventory_item_id,location_id:order?.source_location_id,movement_date:now.slice(0,10),movement_type:'issue',quantity:line.quantity,unit_cost:0,source_table:'logistics_delivery_orders',source_record_id:d.delivery_order_id,reference_number:order?.delivery_number,created_by:p.user.id});if(me)throw appError(me.message)}
 await event(db,p,id,'delivered',pod||undefined); if(pod)await event(db,p,id,'pod_recorded',pod); await audit(p.user.id,id,'logistics_dispatches','delivery_completed',{pod_reference:pod});
 revalidatePath('/logistics/warehouse-delivery');revalidatePath('/logistics/inventory');revalidatePath('/finance/accounting');
}

export async function failDispatchAction(id:string,reason:string){
 const p=await logistics(),db=createClient(); if(!reason.trim())throw appError('Failure reason is required.');
 const {data:d,error}=await db.from('logistics_dispatches').select('id,delivery_order_id,delivery_status,fleet_trip_id,vehicle_id').eq('id',id).single(); if(error||!d)throw appError('Dispatch not found.'); if(!['loaded','in_transit'].includes(d.delivery_status))throw appError('Only active dispatches can be failed.');
 const now=new Date().toISOString(); await db.from('logistics_dispatches').update({delivery_status:'failed',failed_reason:reason,updated_at:now}).eq('id',id); if(d.fleet_trip_id)await db.from('fleet_trips').update({status:'cancelled',return_at:now,notes:reason,updated_at:now}).eq('id',d.fleet_trip_id); if(d.vehicle_id)await db.from('fleet_vehicles').update({status:'available',updated_at:now}).eq('id',d.vehicle_id); await db.from('logistics_delivery_orders').update({status:'cancelled',updated_at:now}).eq('id',d.delivery_order_id).in('status',['approved','dispatched']); await event(db,p,id,'failed',reason); await audit(p.user.id,id,'logistics_dispatches','dispatch_failed',{reason}); revalidatePath('/logistics/warehouse-delivery');
}
