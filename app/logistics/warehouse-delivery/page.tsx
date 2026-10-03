import {redirect} from 'next/navigation';
import {getSessionProfile} from '@/core/auth/getSessionProfile';
import {isAdminTier} from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
import {createAdminClient} from '@/core/auth/supabaseAdmin';
import {selectByScopedIds} from '@/core/auth/businessScope';
import {AuthedShell} from '@/core/layout/AuthedShell';
import {WarehouseDeliveryManagement} from '@/modules/logistics/warehouse-delivery/WarehouseDeliveryManagement';
import {DrReleasePanel} from '@/modules/sales/storefront/DrReleasePanel';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATUSES=['draft','prepared','picked','packed','reviewed','approved','dispatched','delivered','cancelled'];
const DISPATCH_STATUSES=['planned','loaded','in_transit','delivered','failed','cancelled'];
export default async function Page(
 props:{searchParams?: Promise<{from?:string;to?:string;status?:string;dispatch_status?:string}>}
) {
 const searchParams = await props.searchParams;
 const profile=await getSessionProfile();if(!profile?.user.is_active) redirect('/login');
 // Build 52: this page had NO section gate at all — any signed-in user of any
 // department could open it — and read through the service-role client, so it
 // showed every business's delivery orders plus drivers' confidential
 // license_no. Same gate as /logistics/reports.
 const allowed=isAdminTier(profile)||profile.user.role==='logistics'||profile.access.some(a=>a.section_code==='logistics');
 if(!allowed) redirect('/dashboard');
 // Session-scoped client: business-isolation RLS applies.
 const db=createClient();
 // LOG-03: drill-down from the Logistics dashboard — optional period / status filters
 const sp=searchParams??{};const from=DATE.test(sp.from??'')?sp.from!:'';const to=DATE.test(sp.to??'')?sp.to!:'';
 const status=ORDER_STATUSES.includes(sp.status??'')?sp.status!:'';const dispatchStatus=DISPATCH_STATUSES.includes(sp.dispatch_status??'')?sp.dispatch_status!:'';
 let orderQ=db.from('logistics_delivery_orders').select('*,customer:finance_customers(customer_code,legal_name)').order('delivery_date',{ascending:false});
 if(from)orderQ=orderQ.gte('delivery_date',from);if(to)orderQ=orderQ.lte('delivery_date',to);if(status)orderQ=orderQ.eq('status',status);
 let dispatchQ=db.from('logistics_dispatches').select('*,delivery:logistics_delivery_orders(delivery_number),vehicle:fleet_vehicles(vehicle_no,plate_no),driver:fleet_drivers(id,employee_id),trip:fleet_trips(trip_no,status)').order('dispatch_date',{ascending:false});
 if(from)dispatchQ=dispatchQ.gte('dispatch_date',from);if(to)dispatchQ=dispatchQ.lte('dispatch_date',to);if(dispatchStatus)dispatchQ=dispatchQ.eq('delivery_status',dispatchStatus);
 const filtered=!!(from||to||status||dispatchStatus);
 const [{data:locations,error:e1},{data:items,error:e2},{data:customers,error:e3},{data:orders,error:e4},{data:dispatchRows,error:e5},{data:vehicles,error:e6},{data:driverRows,error:e7}]=await Promise.all([
  db.from('logistics_locations').select('id,location_code,location_name').eq('active',true).order('location_code'),
  db.from('logistics_inventory_items').select('id,item_code,item_name,unit').eq('active',true).order('item_code'),
  db.from('finance_customers').select('id,customer_code,legal_name').eq('active',true).order('legal_name'),
  orderQ,
  dispatchQ,
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
 /* Build 74 (SF-01): Storefront DRs from sales orders waiting for the physical release */
 const {data:drs}=await db.rpc('storefront_drs_awaiting_release');
 return <AuthedShell profile={profile}>{filtered&&<div className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm flex flex-wrap justify-between gap-2"><span>Filtered from the dashboard:{from||to?` ${from||'…'} to ${to||'…'}`:''}{status?` · delivery orders ${status.replace('_',' ')}`:''}{dispatchStatus?` · dispatches ${dispatchStatus.replace('_',' ')}`:''}</span><a className="text-blue-700" href="/logistics/warehouse-delivery">Show everything</a></div>}<div className="mb-6"><DrReleasePanel drs={(drs??[]) as any} locations={locations??[]}/></div><WarehouseDeliveryManagement profile={profile} locations={locations??[]} items={items??[]} customers={customers??[]} orders={orders??[]} dispatches={dispatches} vehicles={vehicles??[]} drivers={drivers}/></AuthedShell>
}
