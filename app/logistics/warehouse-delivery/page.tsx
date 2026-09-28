import {redirect} from 'next/navigation';
import {getSessionProfile} from '@/core/auth/getSessionProfile';
import {isAdminTier} from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
import {createAdminClient} from '@/core/auth/supabaseAdmin';
import {selectByScopedIds} from '@/core/auth/businessScope';
import {AuthedShell} from '@/core/layout/AuthedShell';
import {WarehouseDeliveryManagement} from '@/modules/logistics/warehouse-delivery/WarehouseDeliveryManagement';

export default async function Page(){
 const profile=await getSessionProfile(); if(!profile?.user.is_active) redirect('/login');
 // Build 52: this page had NO section gate at all — any signed-in user of any
 // department could open it — and read through the service-role client, so it
 // showed every business's delivery orders plus drivers' confidential
 // license_no. Same gate as /logistics/reports.
 const allowed=isAdminTier(profile)||profile.user.role==='logistics'||profile.access.some(a=>a.section_code==='logistics');
 if(!allowed) redirect('/dashboard');
 // Session-scoped client: business-isolation RLS applies.
 const db=createClient();
 const [{data:locations,error:e1},{data:items,error:e2},{data:customers,error:e3},{data:orders,error:e4},{data:dispatchRows,error:e5},{data:vehicles,error:e6},{data:driverRows,error:e7}]=await Promise.all([
  db.from('logistics_locations').select('id,location_code,location_name').eq('active',true).order('location_code'),
  db.from('logistics_inventory_items').select('id,item_code,item_name,unit').eq('active',true).order('item_code'),
  db.from('finance_customers').select('id,customer_code,legal_name').eq('active',true).order('legal_name'),
  db.from('logistics_delivery_orders').select('*,customer:finance_customers(customer_code,legal_name)').order('delivery_date',{ascending:false}),
  db.from('logistics_dispatches').select('*,delivery:logistics_delivery_orders(delivery_number),vehicle:fleet_vehicles(vehicle_no,plate_no),driver:fleet_drivers(id,employee_id),trip:fleet_trips(trip_no,status)').order('dispatch_date',{ascending:false}),
  db.from('fleet_vehicles').select('id,vehicle_no,plate_no,status,registration_expiry,insurance_expiry').in('status',['available','assigned']).order('vehicle_no'),
  // license_no deliberately not selected: CONFIDENTIAL (Admin approvers only,
  // see 20260924_admin_driver_license_confidentiality.sql).
  db.from('fleet_drivers').select('id,employee_id,license_expiry,authorized').eq('authorized',true).order('license_expiry')
 ]);
 for(const e of [e1,e2,e3,e4,e5,e6,e7]) if(e) throw new Error(e.message);
 // Driver display names: Logistics has no RLS read grant on `employees`, so an
 // embedded employees join came back empty for them. Resolve names by the
 // employee ids of the RLS-scoped driver/dispatch rows above
 // (core/auth/businessScope.ts pattern 2) — name columns only.
 const svc=createAdminClient();
 const employeeIds=[...(driverRows??[]).map((d:any)=>d.employee_id),...(dispatchRows??[]).map((d:any)=>d.driver?.employee_id)];
 const people=await selectByScopedIds<any>((ids)=>svc.from('employees').select('id,employee_no,first_name,last_name,preferred_name').in('id',ids),employeeIds);
 const byId=new Map(people.map((p:any)=>[p.id,p]));
 const drivers=(driverRows??[]).map((d:any)=>({...d,employee:byId.get(d.employee_id)??null}));
 const dispatches=(dispatchRows??[]).map((d:any)=>({...d,driver:d.driver?{...d.driver,employee:byId.get(d.driver.employee_id)??null}:null}));
 return <AuthedShell profile={profile}><WarehouseDeliveryManagement profile={profile} locations={locations??[]} items={items??[]} customers={customers??[]} orders={orders??[]} dispatches={dispatches} vehicles={vehicles??[]} drivers={drivers}/></AuthedShell>
}
