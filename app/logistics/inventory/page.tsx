import {requireSection} from '@/core/auth/requireSection';
import {createClient} from '@/core/auth/supabaseServer';
import {AuthedShell} from '@/core/layout/AuthedShell';
import {LogisticsInventoryManagement} from '@/modules/logistics/inventory/LogisticsInventoryManagement';
import {ledgerFilters, LEDGER_PAGE_SIZE, type LedgerSearchParams} from '@/modules/logistics/inventory/ledgerFilters';

// PostgREST returns at most 1,000 rows per request: read a whole result set
// page by page (LOG-40 class fix — on-hand totals used to be summed from the
// first 1,000 movements only).
async function fetchAll<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>):Promise<T[]>{
 const out:T[]=[];const size=1000;
 for(let from=0;;from+=size){const {data,error}=await page(from,from+size-1);if(error)throw new Error(error.message);out.push(...(data??[]));if(!data||data.length<size)break;}
 return out;
}

export default async function LogisticsInventoryPage({searchParams}:{searchParams?:LedgerSearchParams&{tab?:string;lot_q?:string;lot_loc?:string;lot_all?:string;lot_page?:string;receipt_view?:string;receipt_status?:string;receipt_from?:string;receipt_to?:string;low?:string;transfer_status?:string;receipt?:string}}){
 const profile=await requireSection('logistics');const db=createClient();
 const sp=searchParams??{};
 // LOG-39 / RA-08: Logistics screens show quantities, not costs.
 const {data:canCost}=await db.rpc('can_view_inventory_cost');const showCost=canCost===true;
 const receiptItemCols=`id,receipt_id,inventory_item_id,description,quantity,accepted_qty,damaged_qty,rejected_qty,lot_number,expiry_date,notes,over_receipt_approved,over_receipt_approved_at${showCost?',unit_cost':''}`;
 const poItemCols=`id,purchase_order_id,item_id,description,quantity,unit${showCost?',unit_cost':''}`;
 const lf=ledgerFilters(sp);
 const [{data:locations,error:e1},{data:items,error:e2},{data:receipts,error:e3},{data:receiptItems,error:e4},{data:transfers,error:e6},{data:transferItems,error:e7},{data:orders,error:e8},{data:poItems,error:e9},{data:suppliers,error:e10},{data:locationSettings,error:e12},{data:kpis,error:e14},{data:ledgerRows,error:e15}]=await Promise.all([
  db.from('logistics_locations').select('*').order('location_code'),
  db.from('logistics_inventory_items').select('*,catalog:finance_procurement_items(stock_type)').order('item_code'),
  db.from('logistics_receipts').select('*,location:logistics_locations(location_code,location_name),supplier:finance_suppliers(supplier_code,legal_name),purchase_order:purchase_orders(po_number)').order('receipt_date',{ascending:false}),
  db.from('logistics_receipt_items').select(receiptItemCols),
  db.from('logistics_stock_transfers').select('*,from_location:logistics_locations!logistics_stock_transfers_from_location_id_fkey(location_code,location_name),to_location:logistics_locations!logistics_stock_transfers_to_location_id_fkey(location_code,location_name)').order('transfer_date',{ascending:false}),
  db.from('logistics_stock_transfer_items').select('*'),
  db.from('purchase_orders').select(`id,po_number,supplier_id,status,order_date,expected_delivery_date,delivery_address${showCost?',total_amount':''}`).eq('status','approved').eq('issuance_status','issued').order('order_date',{ascending:false}),
  db.from('purchase_order_items').select(poItemCols).order('created_at'),
  db.from('finance_suppliers').select('id,supplier_code,legal_name').eq('active',true).order('legal_name'),
  db.from('logistics_inventory_location_settings').select('*'),
  // LOG-02: KPIs computed in the database, one row per visible business
  db.rpc('logistics_dashboard_kpis'),
  // LOG-40: one page of the ledger, filtered and paged in the database
  db.rpc('logistics_stock_ledger',{p_search:lf.q||null,p_movement_type:lf.type||null,p_location:lf.location||null,p_item:lf.item||null,p_date_from:lf.from||null,p_date_to:lf.to||null,p_limit:LEDGER_PAGE_SIZE,p_offset:(lf.page-1)*LEDGER_PAGE_SIZE}),
 ]);
 const err=e1||e2||e3||e4||e6||e7||e8||e9||e10||e12||e14||e15;if(err)throw new Error(err.message);
 // On-hand per item+location from the balance view (all rows, paged)
 const balances=await fetchAll<{inventory_item_id:string;location_id:string;on_hand:number}>((a,b)=>db.from('logistics_stock_balance').select('inventory_item_id,location_id,on_hand').order('inventory_item_id').order('location_id').range(a,b));
 /* LOG-48: which locations are used (blocks code change / delete) */
 const {data:usage,error:e13}=await db.rpc('logistics_locations_in_use');if(e13)throw new Error(e13.message);
 const locationUsage=Object.fromEntries(((usage??[]) as {location_id:string;used_in:string[]|null}[]).map(u=>[u.location_id,u.used_in??[]]));
 const ledger={rows:(ledgerRows??[]) as any[],total:Number((ledgerRows as any[]|null)?.[0]?.total_count??0),filters:lf};
 // Build 78: lot register and aging (only when the Lots tab is open)
 let lots:any;
 if(sp.tab==='lots'){
  const page=Math.max(1,Number(sp.lot_page)||1);const filters={q:(sp.lot_q??'').trim().slice(0,60)||undefined,loc:/^[0-9a-f-]{36}$/i.test(sp.lot_loc??'')?sp.lot_loc:undefined,all:sp.lot_all==='1',page};
  const [{data:lr,error:le},{data:ag,error:ae}]=await Promise.all([
   db.rpc('inventory_lot_register',{p_search:filters.q??null,p_location:filters.loc??null,p_open_only:!filters.all,p_limit:100,p_offset:(page-1)*100}),
   db.rpc('inventory_lot_aging'),
  ]);
  if(le||ae)throw new Error((le||ae)!.message);
  lots={rows:lr??[],aging:ag??[],filters};
 }
 return <AuthedShell profile={profile}><LogisticsInventoryManagement lots={lots} profile={profile} showCost={showCost} initialTab={sp.tab} view={{receipt_view:sp.receipt_view,receipt_status:sp.receipt_status,receipt_from:/^\d{4}-\d{2}-\d{2}$/.test(sp.receipt_from??'')?sp.receipt_from:undefined,receipt_to:/^\d{4}-\d{2}-\d{2}$/.test(sp.receipt_to??'')?sp.receipt_to:undefined,low:sp.low==='1',transfer_status:sp.transfer_status,receipt:sp.receipt}} kpis={(kpis??[]) as any[]} ledger={ledger} balances={balances} locations={locations??[]} items={items??[]} receipts={receipts??[]} receiptItems={(receiptItems??[]) as any[]} transfers={transfers??[]} transferItems={transferItems??[]} orders={orders??[]} poItems={(poItems??[]) as any[]} suppliers={suppliers??[]} catalogItems={[]} locationSettings={locationSettings??[]} locationUsage={locationUsage}/></AuthedShell>
}
