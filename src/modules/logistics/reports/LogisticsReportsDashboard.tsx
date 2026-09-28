'use client';
import Link from 'next/link';

type Row=Record<string,any>;
type InventoryItemRow={id:string;item_code:string;item_name:string;unit:string;reorder_level:number|null;active:boolean};
type LocationRow={id:string;location_code:string;location_name:string;location_type:string;active:boolean};
const money=(n:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(n||0);
const num=(n:number)=>new Intl.NumberFormat('en-PH',{maximumFractionDigits:3}).format(n||0);
const pct=(n:number)=>`${n.toFixed(1)}%`;
const label=(v:string)=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());

export function LogisticsReportsDashboard({month,locations,items,movements,receipts,deliveryOrders,dispatches,stops,events,vehicles,drivers,trips,fleetExpenses,maintenance,expenses}:{month:string;locations:LocationRow[];items:InventoryItemRow[];movements:Row[];receipts:Row[];deliveryOrders:Row[];dispatches:Row[];stops:Row[];events:Row[];vehicles:Row[];drivers:Row[];trips:Row[];fleetExpenses:Row[];maintenance:Row[];expenses:Row[]}){
 const activeLocations=locations.filter(x=>x.active).length;
 const activeItems=items.filter(x=>x.active).length;
 const movementQty=(type:string)=>movements.filter(x=>x.movement_type===type).reduce((s,x)=>s+Number(x.quantity||0),0);
 const receiptsPosted=receipts.filter(x=>x.status==='approved').length;
 const ordersDelivered=deliveryOrders.filter(x=>x.status==='delivered').length;
 const ordersCancelled=deliveryOrders.filter(x=>x.status==='cancelled').length;
 const dispatchDelivered=dispatches.filter(x=>x.delivery_status==='delivered').length;
 const dispatchInTransit=dispatches.filter(x=>x.delivery_status==='in_transit').length;
 const dispatchFailed=dispatches.filter(x=>x.delivery_status==='failed').length;
 const completionRate=dispatches.length?dispatchDelivered/dispatches.length*100:0;
 const onTimeStops=stops.filter(s=>s.planned_arrival&&s.actual_arrival&&new Date(s.actual_arrival)<=new Date(s.planned_arrival)).length;
 const measuredStops=stops.filter(s=>s.planned_arrival&&s.actual_arrival).length;
 const onTimeRate=measuredStops?onTimeStops/measuredStops*100:0;
 const fleetCost=fleetExpenses.reduce((s,x)=>s+Number(x.amount||0),0);
 const maintenanceCost=maintenance.reduce((s,x)=>s+Number(x.cost||0),0);
 const logisticsExpense=expenses.filter(x=>['approved','reviewed'].includes(x.status)).reduce((s,x)=>s+Number(x.amount||0),0);
 const stockByItem=new Map<string,number>();
 for(const m of movements){const q=Number(m.quantity||0)*(m.movement_type==='receipt'||m.movement_type==='transfer_in'?1:-1);stockByItem.set(m.inventory_item_id,(stockByItem.get(m.inventory_item_id)||0)+q)}
 const lowStock=items.filter(i=>i.active && (stockByItem.get(i.id)||0)<=Number(i.reorder_level||0)).map(i=>({...i,stock:stockByItem.get(i.id)||0})).sort((a,b)=>a.stock-b.stock).slice(0,8);
 const locationStock=locations.map(l=>{let q=0;for(const m of movements.filter(x=>x.location_id===l.id)){q+=Number(m.quantity||0)*(m.movement_type==='receipt'||m.movement_type==='transfer_in'?1:-1)}return {...l,qty:q}}).filter(x=>x.qty!==0).sort((a,b)=>b.qty-a.qty).slice(0,8);
 const statusRows=['draft','prepared','picked','packed','reviewed','approved','dispatched','delivered','cancelled'].map(status=>({status,count:deliveryOrders.filter(x=>x.status===status).length})).filter(x=>x.count);
 const topFleet=vehicles.map(v=>({vehicle:v,expense:fleetExpenses.filter(x=>x.vehicle_id===v.id).reduce((s,x)=>s+Number(x.amount||0),0)})).filter(x=>x.expense>0).sort((a,b)=>b.expense-a.expense).slice(0,6);
 const tripDistance=trips.reduce((s,t)=>s+(t.starting_odometer!=null&&t.ending_odometer!=null?Number(t.ending_odometer)-Number(t.starting_odometer):0),0);
 return <div className="space-y-6">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-slate-900">Logistics Reporting & Operations Dashboard</h1><p className="text-sm text-slate-500">Operational view for inventory, warehouse, deliveries, fleet and logistics cost.</p></div><form className="flex items-end gap-2"><div><label className="block text-xs font-medium text-slate-600">Reporting month</label><input name="month" type="month" defaultValue={month} className="border rounded px-3 py-2 text-sm"/></div><button className="bg-slate-900 text-white rounded px-4 py-2 text-sm">Apply</button></form></div>
  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">{[
   ['Locations',activeLocations],['Active items',activeItems],['Receipts approved',receiptsPosted],['Deliveries',deliveryOrders.length],['Delivered',ordersDelivered],['In transit',dispatchInTransit],['On-time',pct(onTimeRate)],['Fleet cost',money(fleetCost+maintenanceCost)]
  ].map(([k,v])=><div key={String(k)} className="bg-white border rounded-xl p-4 shadow-sm"><div className="text-xs text-slate-500">{k}</div><div className="text-xl font-semibold mt-1">{v}</div></div>)}</div>
  <div className="grid xl:grid-cols-3 gap-5">
   <section className="bg-white border rounded-xl p-5 xl:col-span-2"><div className="flex justify-between items-center mb-4"><h2 className="font-semibold">Delivery operations</h2><Link href="/logistics/warehouse-delivery" className="text-sm text-blue-600">Open operations</Link></div><div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[['Orders',deliveryOrders.length],['Delivered',ordersDelivered],['In transit',dispatchInTransit],['Failed',dispatchFailed],['Cancelled',ordersCancelled]].map(([k,v])=><div key={String(k)} className="border rounded-lg p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>)}</div><div className="mt-5 space-y-2">{statusRows.map(r=><div key={r.status} className="flex items-center gap-3 text-sm"><span className="w-24 text-slate-600">{label(r.status)}</span><div className="h-2 bg-slate-100 rounded flex-1 overflow-hidden"><div className="h-full bg-slate-700" style={{width:`${Math.min(100,r.count/Math.max(1,deliveryOrders.length)*100)}%`}}/></div><span className="w-8 text-right">{r.count}</span></div>)}</div></section>
   <section className="bg-white border rounded-xl p-5"><h2 className="font-semibold mb-4">Fleet operations</h2><div className="space-y-3 text-sm"><div className="flex justify-between"><span>Trips</span><b>{trips.length}</b></div><div className="flex justify-between"><span>Completed trips</span><b>{trips.filter(t=>t.status==='completed').length}</b></div><div className="flex justify-between"><span>Distance recorded</span><b>{num(tripDistance)}</b></div><div className="flex justify-between"><span>Authorized drivers</span><b>{drivers.filter(d=>d.authorized).length}</b></div><div className="flex justify-between"><span>Active vehicles</span><b>{vehicles.filter(v=>!['retired','disposed'].includes(v.status)).length}</b></div><div className="flex justify-between"><span>Fleet expenses</span><b>{money(fleetCost)}</b></div><div className="flex justify-between"><span>Maintenance</span><b>{money(maintenanceCost)}</b></div></div></section>
  </div>
  <div className="grid xl:grid-cols-3 gap-5">
   <section className="bg-white border rounded-xl p-5"><div className="flex justify-between mb-4"><h2 className="font-semibold">Low-stock items</h2><Link href="/logistics/inventory" className="text-sm text-blue-600">Inventory</Link></div>{lowStock.length?<div className="space-y-3">{lowStock.map(i=><div key={i.id} className="flex justify-between border-b pb-2 text-sm"><div><div className="font-medium">{i.item_name}</div><div className="text-xs text-slate-500">{i.item_code} · reorder {num(Number(i.reorder_level))}</div></div><div className="font-semibold">{num(i.stock)} {i.unit}</div></div>)}</div>:<p className="text-sm text-slate-500">No items are at or below reorder level.</p>}</section>
   <section className="bg-white border rounded-xl p-5"><h2 className="font-semibold mb-4">Stock by location</h2>{locationStock.length?<div className="space-y-3">{locationStock.map(l=><div key={l.id} className="flex justify-between text-sm"><span>{l.location_name}</span><b>{num(l.qty)}</b></div>)}</div>:<p className="text-sm text-slate-500">No stock movements recorded for this period.</p>}<div className="mt-4 pt-3 border-t text-xs text-slate-500">Receipts: {num(movementQty('receipt'))} · Issues: {num(movementQty('issue'))}</div></section>
   <section className="bg-white border rounded-xl p-5"><h2 className="font-semibold mb-4">Top fleet costs</h2>{topFleet.length?<div className="space-y-3">{topFleet.map(x=><div key={x.vehicle.id} className="flex justify-between text-sm"><span>{x.vehicle.vehicle_no} {x.vehicle.plate_no?`· ${x.vehicle.plate_no}`:''}</span><b>{money(x.expense)}</b></div>)}</div>:<p className="text-sm text-slate-500">No fleet expenses recorded for this period.</p>}<div className="mt-4 pt-3 border-t text-xs text-slate-500">Approved/reviewed logistics expenses: {money(logisticsExpense)}</div></section>
  </div>
  <section className="bg-white border rounded-xl p-5"><div className="flex justify-between items-center mb-4"><div><h2 className="font-semibold">Operational summary</h2><p className="text-xs text-slate-500">Period: {month}</p></div><Link href="/logistics/expenses" className="text-sm text-blue-600">Logistics expenses</Link></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">Metric</th><th className="py-2">Value</th><th className="py-2">Notes</th></tr></thead><tbody>{[['Inbound quantity',num(movementQty('receipt')),'Posted receipt movements'],['Outbound quantity',num(movementQty('issue')),'Delivery/issue movements'],['Transfers in',num(movementQty('transfer_in')),'Warehouse transfers'],['Transfers out',num(movementQty('transfer_out')),'Warehouse transfers'],['Dispatch completion',pct(completionRate),'Delivered dispatches / dispatches'],['On-time stop rate',pct(onTimeRate),`${onTimeStops} of ${measuredStops} measured stops`],['Fleet + maintenance cost',money(fleetCost+maintenanceCost),'Fleet operating cost for period']].map(r=><tr key={r[0]} className="border-b last:border-0"><td className="py-2 font-medium">{r[0]}</td><td className="py-2">{r[1]}</td><td className="py-2 text-slate-500">{r[2]}</td></tr>)}</tbody></table></div></section>
 </div>;
}
