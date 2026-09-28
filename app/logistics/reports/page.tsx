import {getSessionProfile} from '@/core/auth/getSessionProfile';
import {isAdminTier} from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
import {createAdminClient} from '@/core/auth/supabaseAdmin';
import {scopeToBusiness} from '@/core/auth/businessScope';
import {AuthedShell} from '@/core/layout/AuthedShell';
import {LogisticsReportsDashboard} from '@/modules/logistics/reports/LogisticsReportsDashboard';

function monthBounds(value?: string) {
  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  const month = /^\d{4}-\d{2}$/.test(value ?? '') ? value! : fallback;
  const [y,m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth()+1).padStart(2,'0')}-${String(endDate.getUTCDate()).padStart(2,'0')}`;
  return {month,start,end};
}

export default async function LogisticsReportsPage({searchParams}:{searchParams:{month?:string}}){
 const profile=await getSessionProfile();
 if(!profile?.user.is_active) return null;
 const allowed=isAdminTier(profile)||profile.user.role==='logistics'||profile.access.some(a=>a.section_code==='logistics');
 if(!allowed) return null;
 const {month,start,end}=monthBounds(searchParams?.month);
 // Build 52 (CC-01-class fix): session-scoped client so business-isolation RLS
 // applies — previously service role, so this report aggregated every
 // business's logistics and fleet data together.
 const db=createClient();
 // Fleet expense/maintenance COSTS are Admin-owned tables with no Logistics RLS
 // read grant, but this report has always shown their totals to Logistics.
 // Kept, via service role with an explicit business filter
 // (core/auth/businessScope.ts pattern 1), rather than widening Admin RLS.
 const svc=createAdminClient();
 const [locationRes,itemRes,movementRes,receiptRes,deliveryRes,dispatchRes,stopRes,eventRes,vehicleRes,driverRes,tripRes,fleetExpenseRes,maintenanceRes,expenseRes]=await Promise.all([
  db.from('logistics_locations').select('id,location_code,location_name,location_type,active').order('location_code'),
  db.from('logistics_inventory_items').select('id,item_code,item_name,unit,reorder_level,active').order('item_code'),
  db.from('logistics_stock_movements').select('id,inventory_item_id,location_id,movement_date,movement_type,quantity,unit_cost,reference_number').gte('movement_date',start).lte('movement_date',end),
  db.from('logistics_receipts').select('id,receipt_number,receipt_date,status,location_id,supplier_id').gte('receipt_date',start).lte('receipt_date',end),
  db.from('logistics_delivery_orders').select('id,delivery_number,status,delivery_date,requested_delivery_date,source_location_id').gte('delivery_date',start).lte('delivery_date',end),
  db.from('logistics_dispatches').select('id,dispatch_number,delivery_order_id,dispatch_date,delivery_status,departure_time,actual_arrival,vehicle_id,driver_id').gte('dispatch_date',start).lte('dispatch_date',end),
  db.from('logistics_delivery_stops').select('id,dispatch_id,status,planned_arrival,actual_arrival,stop_type').gte('created_at',`${start}T00:00:00`).lte('created_at',`${end}T23:59:59`),
  db.from('logistics_delivery_events').select('id,dispatch_id,event_type,event_at').gte('event_at',`${start}T00:00:00`).lte('event_at',`${end}T23:59:59`),
  db.from('fleet_vehicles').select('id,vehicle_no,plate_no,status,registration_expiry,insurance_expiry'),
  db.from('fleet_drivers').select('id,authorized,license_expiry'),
  db.from('fleet_trips').select('id,trip_no,vehicle_id,driver_employee_id,trip_date,status,starting_odometer,ending_odometer').gte('trip_date',start).lte('trip_date',end),
  scopeToBusiness(svc.from('fleet_expenses').select('id,vehicle_id,expense_date,expense_type,amount'),profile).gte('expense_date',start).lte('expense_date',end),
  scopeToBusiness(svc.from('fleet_maintenance').select('id,vehicle_id,service_date,cost,next_service_date,status'),profile).gte('service_date',start).lte('service_date',end),
  db.from('expenses').select('id,amount,status,created_at').eq('section_id',(await db.from('sections').select('id').eq('code','logistics').single()).data?.id ?? '').gte('created_at',`${start}T00:00:00`).lte('created_at',`${end}T23:59:59`),
 ]);
 const locations=locationRes.data??[], items=itemRes.data??[], movements=movementRes.data??[], receipts=receiptRes.data??[], deliveryOrders=deliveryRes.data??[], dispatches=dispatchRes.data??[], stops=stopRes.data??[], events=eventRes.data??[], vehicles=vehicleRes.data??[], drivers=driverRes.data??[], trips=tripRes.data??[], fleetExpenses=fleetExpenseRes.data??[], maintenance=maintenanceRes.data??[], expenses=expenseRes.data??[];
 return <AuthedShell profile={profile}><LogisticsReportsDashboard month={month} locations={locations??[]} items={items??[]} movements={movements??[]} receipts={receipts??[]} deliveryOrders={deliveryOrders??[]} dispatches={dispatches??[]} stops={stops??[]} events={events??[]} vehicles={vehicles??[]} drivers={drivers??[]} trips={trips??[]} fleetExpenses={fleetExpenses??[]} maintenance={maintenance??[]} expenses={expenses??[]}/></AuthedShell>;
}
