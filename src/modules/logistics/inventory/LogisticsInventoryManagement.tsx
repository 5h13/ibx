'use client';
import { errorText } from '@/core/errors/appError';
import { CatalogItemPicker } from '@/shared/catalog/CatalogItemPicker';
import Link from 'next/link';
import {useState,useTransition} from 'react';
import type {SessionProfile} from '@/core/auth/types';
import {hasSectionWorkflowRole} from '@/core/auth/types';
import {StatusBadge} from '@/core/utils/statusBadge';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import * as A from '../inventoryActions';
import {ledgerQuery, LEDGER_PAGE_SIZE, MOVEMENT_TYPES, type LedgerFilters} from './ledgerFilters';
import {LotsTab, TransferForm, type AgingRow, type LotRegisterRow} from './LotsTab';

type Kpi={business_id:string;business_code:string;business_name:string;active_locations:number;active_items:number;receipts_in_workflow:number;receipts_awaiting_post:number;adhoc_receipts_open:number;transfers_pending:number;low_stock_items:number;on_hand_qty:number;on_hand_value:number|null};
type View={receipt_view?:string;receipt_status?:string;receipt_from?:string;receipt_to?:string;low?:boolean;transfer_status?:string;receipt?:string};
type Ledger={rows:any[];total:number;filters:LedgerFilters};
const BASE='/logistics/inventory';
const href=(q:Record<string,string|undefined>)=>{const p=new URLSearchParams();for(const [k,v] of Object.entries(q))if(v)p.set(k,v);const s=p.toString();return s?`${BASE}?${s}`:BASE};
const qty=(n:unknown)=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:3});
const peso=(n:unknown)=>`₱${Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const TABS:[string,string][]=[['overview','Overview'],['locations','Locations'],['items','Inventory Items'],['receipts','Receiving'],['transfers','Transfers'],['lots','Lots'],['ledger','Stock Ledger']];

export function LogisticsInventoryManagement({lots,profile,showCost=false,initialTab,view={},kpis=[],ledger,balances=[],locations,items,receipts,receiptItems,transfers,transferItems,orders,poItems,suppliers,catalogItems,locationSettings,locationUsage={}}:{lots?:{rows:LotRegisterRow[];aging:AgingRow[];filters:{q?:string;loc?:string;all?:boolean;page:number}};profile:SessionProfile;showCost?:boolean;initialTab?:string;view?:View;kpis?:Kpi[];ledger:Ledger;balances?:{inventory_item_id:string;location_id:string;on_hand:number}[];locationUsage?:Record<string,string[]>;locations:any[];items:any[];receipts:any[];receiptItems:any[];transfers:any[];transferItems:any[];orders:any[];poItems:any[];suppliers:any[];catalogItems:any[];locationSettings:any[]}){
 const tab=TABS.some(([k])=>k===initialTab)?initialTab!:'overview';
 const[pending,start]=useTransition(),[msg,setMsg]=useState('');
 const run=(f:()=>Promise<void>)=>start(async()=>{try{setMsg('');await f();setMsg('Saved successfully.')}catch(e:any){setMsg(errorText(e)||'Operation failed.')}});
 // on-hand per item+location from logistics_stock_balance (all rows, not a 1,000-movement sample)
 const bal=new Map(balances.map(b=>[`${b.inventory_item_id}|${b.location_id}`,Number(b.on_hand)]));
 const onHand=(itemId:string,locationId:string)=>bal.get(`${itemId}|${locationId}`)??0;
 return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Logistics Inventory</h1><p className="text-sm text-slate-500">Warehouses, receiving, stock movements and transfers.</p></div>{msg&&<div className="rounded-lg bg-slate-100 px-4 py-2 text-sm">{msg}</div>}
  <div className="flex gap-2 flex-wrap">{TABS.map(([k,l])=><Link key={k} href={href({tab:k})} className={tab===k?'button':'button-secondary'}>{l}</Link>)}</div>
  {tab==='overview'&&<Overview kpis={kpis} showCost={showCost} profile={profile}/>}
  {tab==='locations'&&<Locations msg={msg} locations={locations} usage={locationUsage} pending={pending} run={run}/>}
  {tab==='items'&&<Items msg={msg} items={items} locations={locations} onHand={onHand} catalogItems={catalogItems} locationSettings={locationSettings} pending={pending} run={run} lowOnly={!!view.low}/>}
  {tab==='receipts'&&<Receipts msg={msg} profile={profile} showCost={showCost} view={view} receipts={receipts} receiptItems={receiptItems} locations={locations} items={items} orders={orders} suppliers={suppliers} pending={pending} run={run}/>}
  {tab==='transfers'&&<Transfers msg={msg} statusFilter={view.transfer_status} transfers={transfers} transferItems={transferItems} locations={locations} items={items} pending={pending} run={run}/>}
  {tab==='lots'&&lots&&<LotsTab rows={lots.rows} aging={lots.aging} filters={lots.filters} locations={locations} showCost={showCost} base={BASE}/>}
  {tab==='ledger'&&<LedgerView ledger={ledger} showCost={showCost} locations={locations} items={items} onHand={onHand}/>}
 </div>
}

// LOG-02 / LOG-03: figures are explicitly per business, and every tile opens the matching filtered list.
function Overview({kpis,showCost,profile}:{kpis:Kpi[];showCost:boolean;profile:SessionProfile}){
 const own=kpis.find(k=>k.business_id===profile.user.business_id);
 const scope=own?[own]:kpis;
 const sum=(f:keyof Kpi)=>scope.reduce((s,k)=>s+Number(k[f]||0),0);
 const label=scope.length===1?`${scope[0].business_name} (${scope[0].business_code})`:scope.length?`${scope.length} businesses combined — see the per-business breakdown below`:'No business selected';
 const tiles:[string,string,string][]=[
  ['Active locations',qty(sum('active_locations')),href({tab:'locations'})],
  ['Active items',qty(sum('active_items')),href({tab:'items'})],
  ['Receipts in review',qty(sum('receipts_in_workflow')),href({tab:'receipts',receipt_status:'pending'})],
  ['Receipts awaiting posting',qty(sum('receipts_awaiting_post')),href({tab:'receipts',receipt_status:'approved'})],
  ['Ad-hoc receipts (no PO) open',qty(sum('adhoc_receipts_open')),href({tab:'receipts',receipt_view:'adhoc',receipt_status:'open'})],
  ['Transfers pending',qty(sum('transfers_pending')),href({tab:'transfers',transfer_status:'pending'})],
  ['Low stock items',qty(sum('low_stock_items')),href({tab:'items',low:'1'})],
  ['Units on hand',qty(sum('on_hand_qty')),href({tab:'ledger'})],
 ];
 if(showCost)tiles.push(['On-hand value (weighted avg.)',peso(sum('on_hand_value')),href({tab:'ledger'})]);
 return <section className="space-y-4">
  <p className="text-sm text-slate-600">Figures for <b>{label}</b>. Click a figure to open the records behind it.</p>
  <div className="grid md:grid-cols-4 gap-4">{tiles.map(([a,b,h])=><Link key={a} href={h} className="rounded-xl border bg-white p-5 hover:border-slate-400 hover:shadow-sm"><div className="text-sm text-slate-500">{a}</div><div className="text-2xl font-semibold mt-1">{b}</div><div className="text-xs text-blue-600 mt-2">View records →</div></Link>)}</div>
  {kpis.length>1&&<div className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-3">Per-business breakdown</h3><T h={['Business','Locations','Items','In review','Awaiting posting','Ad-hoc open','Transfers pending','Low stock','Units on hand',...(showCost?['On-hand value']:[])]} r={kpis.map(k=><tr key={k.business_id} className="border-b"><td className="p-3 font-medium">{k.business_name} ({k.business_code})</td><td className="p-3">{qty(k.active_locations)}</td><td className="p-3">{qty(k.active_items)}</td><td className="p-3">{qty(k.receipts_in_workflow)}</td><td className="p-3">{qty(k.receipts_awaiting_post)}</td><td className="p-3">{qty(k.adhoc_receipts_open)}</td><td className="p-3">{qty(k.transfers_pending)}</td><td className="p-3">{qty(k.low_stock_items)}</td><td className="p-3">{qty(k.on_hand_qty)}</td>{showCost&&<td className="p-3">{peso(k.on_hand_value)}</td>}</tr>)}/><p className="text-xs text-slate-500 mt-2">Choose an acting business in the header to open one business's records.</p></div>}
 </section>
}

const LOCATION_TYPES=['warehouse','store','office','transit','other'];
function Locations({locations,usage,pending,run,msg}:any){
 const usedIn=(l:any):string[]=>usage?.[l.id]??[];
 return <section className="space-y-5"><ActionBar><PopupAction label="+ Add location" title="Add location" notice={msg}>{(close)=><form action={fd=>run(async()=>{await A.createLocationAction(fd);close()})} className="grid md:grid-cols-4 gap-3"><F l="Code"><input className="input" name="location_code" required/></F><F l="Name"><input className="input" name="location_name" required/></F><F l="Type"><select className="input" name="location_type">{LOCATION_TYPES.map(t=><option key={t}>{t}</option>)}</select></F><F l="Address"><input className="input" name="address"/></F><div className="md:col-span-4"><F l="Notes"><input className="input" name="notes"/></F></div><div className="md:col-span-4"><button disabled={pending} className="button">Save location</button></div></form>}</PopupAction></ActionBar>
 <T h={['Code','Name','Type','Address','Status','Action']} r={locations.map((l:any)=>{const used=usedIn(l);const locked=used.length>0;const why=locked?`Used in ${used.join(', ')}. Its code cannot change and it cannot be deleted; deactivate it instead.`:'';
  return <tr key={l.id} className="border-b"><td className="p-3 font-medium">{l.location_code}</td><td className="p-3">{l.location_name}</td><td className="p-3">{l.location_type}</td><td className="p-3">{l.address||'—'}</td><td className="p-3"><StatusBadge status={l.active?'active':'inactive'}/></td><td className="p-3"><div className="flex flex-wrap gap-1">
   <PopupAction label="Edit" title={`Edit location ${l.location_code}`} variant="secondary" notice={msg}>{(close)=><form action={fd=>run(async()=>{await A.updateLocationAction(l.id,fd);close()})} className="grid md:grid-cols-4 gap-3">
    <F l="Code"><input className="input" name="location_code" defaultValue={l.location_code} required readOnly={locked} disabled={locked} title={why||undefined}/></F>
    <F l="Name"><input className="input" name="location_name" defaultValue={l.location_name} required/></F>
    <F l="Type"><select className="input" name="location_type" defaultValue={l.location_type}>{LOCATION_TYPES.map(t=><option key={t}>{t}</option>)}</select></F>
    <F l="Address"><input className="input" name="address" defaultValue={l.address||''}/></F>
    <div className="md:col-span-4"><F l="Notes"><input className="input" name="notes" defaultValue={l.notes||''}/></F></div>
    {locked&&<p className="md:col-span-4 text-xs text-slate-500">The code is locked: this location is used in {used.join(', ')}.</p>}
    <div className="md:col-span-4"><button disabled={pending} className="button">Save changes</button></div></form>}</PopupAction>
   <button className="button-secondary" disabled={pending} onClick={()=>run(()=>A.toggleLocationAction(l.id,!l.active))}>{l.active?'Deactivate':'Activate'}</button>
   <button className="button-secondary disabled:opacity-50 disabled:cursor-not-allowed" disabled={pending||locked} title={locked?why:'Delete this unused location'} onClick={()=>{if(window.confirm(`Delete location ${l.location_code}? This cannot be undone.`))run(()=>A.deleteLocationAction(l.id))}}>Delete</button>
  </div></td></tr>})}/></section>}
function Items({items,locations,onHand,catalogItems,locationSettings,pending,run,msg,lowOnly}:any){
 const setting=(itemId:string,locationId:string)=>locationSettings.find((x:any)=>x.inventory_item_id===itemId&&x.location_id===locationId);
 const rows=items.flatMap((i:any)=>locations.filter((l:any)=>l.active).map((l:any)=>{const st=setting(i.id,l.id);const reorder=Number(st?.reorder_level||0);const stock=onHand(i.id,l.id);return {i,l,reorder,stock,status:i.catalog?.stock_type==='order_only'?'Order only':st?.active!==false&&reorder>0&&stock<=reorder?'Reorder':'OK'}})).filter((r:any)=>!lowOnly||r.status==='Reorder');
 return <section className="space-y-5">
  <ActionBar><PopupAction label="+ Link catalog item" title="Link catalog item to inventory" notice={msg}>{(close)=><><p className="text-sm text-slate-500 mb-4">Logistics does not create a second product master. Select an active shared catalog item; inventory records quantities and physical movement by location.</p>
   <form action={fd=>run(async()=>{await A.createInventoryItemAction(fd);close()})} className="grid md:grid-cols-3 gap-3">
    <F l="Catalog item"><CatalogItemPicker name="procurement_item_id" required/></F>
    <div className="md:col-span-2 flex items-end"><button disabled={pending} className="button">Add to inventory</button></div>
   </form></>}
  </PopupAction>
  <Link href={lowOnly?href({tab:'items'}):href({tab:'items',low:'1'})} className="button-secondary">{lowOnly?'Show all items':'Show low stock only'}</Link></ActionBar>
  <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-3">Inventory by location{lowOnly&&<span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Low stock only</span>}</h3><p className="text-sm text-slate-500 mb-4">On-hand quantity is derived only from posted stock movements. Click an on-hand figure to see the movements behind it. Reorder levels are configured per inventory item and warehouse/location.</p>
   <T h={['Item','Location','On hand','Reorder level','Status','Setup']} r={rows.map(({i,l,reorder,stock,status}:any)=>
    <tr key={`${i.id}-${l.id}`} className="border-b"><td className="p-3 font-medium">{i.item_code} — {i.item_name}</td><td className="p-3">{l.location_code} — {l.location_name}</td><td className="p-3 font-medium"><Link className="text-blue-700 underline-offset-2 hover:underline" title="Open this item's movement history at this location" href={`${BASE}?${ledgerQuery({item:i.id,location:l.id})}`}>{qty(stock)}</Link></td><td className="p-3"><form action={fd=>run(()=>A.saveInventoryLocationSettingAction(fd))} className="flex gap-2 items-center"><input type="hidden" name="inventory_item_id" value={i.id}/><input type="hidden" name="location_id" value={l.id}/><input className="input w-28" name="reorder_level" type="number" min="0" step=".001" defaultValue={reorder}/><button disabled={pending} className="button-secondary">Save</button></form></td><td className="p-3"><span className={`rounded px-2 py-1 text-xs ${status==='Reorder'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`}>{status}</span></td><td className="p-3 text-xs text-slate-500">Location-specific</td></tr>)}/>
   {!rows.length&&<p className="text-sm text-slate-500 p-3">{lowOnly?'No item is at or below its reorder level.':'No inventory items or active locations yet.'}</p>}
  </section>
  <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-3">Inventory references</h3><T h={['Catalog code','Item','Category','Unit','Active','History']} r={items.map((i:any)=><tr key={i.id} className="border-b"><td className="p-3 font-medium">{i.item_code}</td><td className="p-3">{i.item_name}</td><td className="p-3">{i.category||'—'}</td><td className="p-3">{i.unit}</td><td className="p-3">{i.active?'Active':'Inactive'}</td><td className="p-3"><Link className="text-blue-700 hover:underline" href={`${BASE}?${ledgerQuery({item:i.id})}`}>Movements</Link></td></tr>)}/></section>
 </section>
}

type Line={inventory_item_id:string;quantity:number;damaged_qty:number;rejected_qty:number;unit_cost:number;lot_number:string;expiry_date:string;description?:string;over_receipt_approved?:boolean};
const blankLine=():Line=>({inventory_item_id:'',quantity:1,damaged_qty:0,rejected_qty:0,unit_cost:0,lot_number:'',expiry_date:''});
const RECEIPT_STATUS:Record<string,(s:string)=>boolean>={all:()=>true,open:s=>s!=='posted',pending:s=>['draft','prepared','reviewed'].includes(s),approved:s=>s==='approved',posted:s=>s==='posted'};
function Receipts({receipts,receiptItems,locations,items,orders,suppliers,pending,run,msg,profile,showCost,view}:any){
 const canApproveOver=hasSectionWorkflowRole(profile,'logistics','approver');
 const[poId,setPoId]=useState('');const[poStatus,setPoStatus]=useState<any[]>([]);const[locationId,setLocationId]=useState('');
 const[lines,setLines]=useState<Line[]>([blankLine()]);
 const[open,setOpen]=useState<string|null>(view.receipt||null);
 const selectedPo=orders.find((o:any)=>o.id===poId);
 const set=(i:number,patch:Partial<Line>)=>setLines(lines.map((x,j)=>j===i?{...x,...patch}:x));
 const outstanding=(itemId:string)=>poStatus.find((x:any)=>x.inventory_item_id===itemId);
 const selectPo=(id:string)=>{setPoId(id);setPoStatus([]);const po=orders.find((o:any)=>o.id===id);if(!po){setLines([blankLine()]);return;}
  // LOG-15: the PO's delivery address picks the receiving location when one matches
  const addr=String(po.delivery_address||'').trim().toLowerCase();const match=addr&&locations.find((l:any)=>l.active&&String(l.address||'').trim().toLowerCase()===addr);if(match)setLocationId(match.id);
  run(async()=>{const rows=await A.poReceivingStatusAction(id);setPoStatus(rows);setLines(rows.filter(r=>r.inventory_item_id&&r.outstanding>0).map(r=>({...blankLine(),inventory_item_id:r.inventory_item_id!,quantity:r.outstanding,description:r.description||''})));})};
 const totals=(rid:string)=>receiptItems.filter((x:any)=>x.receipt_id===rid).reduce((s:any,x:any)=>({d:s.d+Number(x.quantity||0),a:s.a+Number(x.accepted_qty??x.quantity??0),dm:s.dm+Number(x.damaged_qty||0),rj:s.rj+Number(x.rejected_qty||0),over:s.over||!!x.over_receipt_approved}),{d:0,a:0,dm:0,rj:0,over:false});
 const rv=['po','adhoc','damaged'].includes(view.receipt_view)?view.receipt_view:'all';const rs=RECEIPT_STATUS[view.receipt_status]?view.receipt_status:'all';
 const rf=view.receipt_from,rt=view.receipt_to;
 const viewOk=(r:any)=>rv==='all'||(rv==='adhoc'&&!r.purchase_order_id)||(rv==='po'&&!!r.purchase_order_id)||(rv==='damaged'&&(()=>{const t=totals(r.id);return t.dm>0||t.rj>0})());
 const shown=receipts.filter((r:any)=>viewOk(r)&&RECEIPT_STATUS[rs](r.status)&&(!rf||r.receipt_date>=rf)&&(!rt||r.receipt_date<=rt));
 const keep={receipt_from:rf,receipt_to:rt};
 const adhocCount=receipts.filter((r:any)=>!r.purchase_order_id).length;
 const itemLabel=(id:string)=>{const i=items.find((x:any)=>x.id===id);return i?`${i.item_code} — ${i.item_name}`:id};
 return <section className="space-y-5"><ActionBar><PopupAction label="Record goods receipt" title="Record goods receipt" notice={msg} wide>{(close)=><form action={fd=>run(async()=>{fd.set('lines',JSON.stringify(lines));await A.createReceiptAction(fd);setLines([blankLine()]);setPoId('');setPoStatus([]);close()})} className="grid md:grid-cols-4 gap-3">
  <F l="Purchase order"><select className="input" name="purchase_order_id" value={poId} onChange={e=>selectPo(e.target.value)}><option value="">No linked PO (ad-hoc receipt)</option>{orders.map((o:any)=><option key={o.id} value={o.id}>{o.po_number}{o.order_date?` — ${o.order_date}`:''}</option>)}</select></F>
  <F l="Supplier"><select key={poId||'adhoc'} className="input" name="supplier_id" defaultValue={selectedPo?.supplier_id||''} disabled={!!selectedPo}><option value="">Select supplier</option>{suppliers.map((s:any)=><option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>)}</select>{selectedPo&&<input type="hidden" name="supplier_id" value={selectedPo.supplier_id}/>}</F>
  <F l="Location"><select className="input" name="location_id" required value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">Select location</option>{locations.filter((l:any)=>l.active).map((l:any)=><option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}</select></F>
  <F l="Receipt date"><input className="input" name="receipt_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/></F>
  <F l="Delivery reference"><input className="input" name="delivery_reference" placeholder="Supplier DR / waybill no."/></F>
  {selectedPo&&<div className="md:col-span-4 rounded-lg bg-slate-50 p-3 text-sm grid md:grid-cols-4 gap-2"><div><div className="text-xs text-slate-500">Purchase order</div><b>{selectedPo.po_number}</b></div><div><div className="text-xs text-slate-500">Order date</div>{selectedPo.order_date||'—'}</div><div><div className="text-xs text-slate-500">Expected delivery</div>{selectedPo.expected_delivery_date||'—'}</div><div><div className="text-xs text-slate-500">Deliver to</div>{selectedPo.delivery_address||'—'}</div><div className="md:col-span-4 text-xs text-slate-500">Lines are pre-filled with each item's outstanding quantity (ordered minus what other receipts of this PO already accepted, in any status). Damaged and rejected units stay outstanding.</div></div>}
  {!selectedPo&&<div className="md:col-span-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Ad-hoc receipt: not linked to a purchase order. It is flagged as ad-hoc in the receiving register and reports.</div>}
  <div className="md:col-span-4 border rounded-lg p-3 space-y-2"><div className="flex justify-between"><b>Received lines</b><button type="button" className="button-secondary" onClick={()=>setLines([...lines,blankLine()])}>Add line</button></div>
   <div className="hidden md:grid md:grid-cols-12 gap-2 text-xs text-slate-500"><span className="md:col-span-3">Item</span><span>Delivered</span><span>Damaged</span><span>Rejected</span><span>Accepted</span><span className="md:col-span-2">Lot</span><span className="md:col-span-2">Expiry</span>{showCost&&!poId?<span>Unit cost</span>:<span/>}</div>
   {lines.map((l,i)=>{const o=poId?outstanding(l.inventory_item_id):null;const accepted=Number(l.quantity||0)-Number(l.damaged_qty||0)-Number(l.rejected_qty||0);const over=o?accepted-Number(o.outstanding):0;
    return <div key={i} className="space-y-1"><div className="grid md:grid-cols-12 gap-2"><select className="input md:col-span-3" value={l.inventory_item_id} onChange={e=>set(i,{inventory_item_id:e.target.value})}><option value="">Item</option>{items.filter((x:any)=>x.active).map((x:any)=><option key={x.id} value={x.id}>{x.item_code} — {x.item_name}</option>)}</select>
     <input className="input" type="number" min=".001" step=".001" title="Delivered" value={l.quantity} onChange={e=>set(i,{quantity:Number(e.target.value)})}/>
     <input className="input" type="number" min="0" step=".001" title="Damaged" value={l.damaged_qty} onChange={e=>set(i,{damaged_qty:Number(e.target.value)})}/>
     <input className="input" type="number" min="0" step=".001" title="Rejected" value={l.rejected_qty} onChange={e=>set(i,{rejected_qty:Number(e.target.value)})}/>
     <div className={`input bg-slate-50 ${accepted<0?'text-red-700':''}`} title="Accepted = delivered − damaged − rejected; only this goes into stock">{qty(accepted)}</div>
     <input className="input md:col-span-2" placeholder="Lot" value={l.lot_number} onChange={e=>set(i,{lot_number:e.target.value})}/>
     <input className="input md:col-span-2" type="date" value={l.expiry_date} onChange={e=>set(i,{expiry_date:e.target.value})}/>
     {showCost&&!poId?<input className="input" type="number" min="0" step=".01" title="Unit cost" value={l.unit_cost} onChange={e=>set(i,{unit_cost:Number(e.target.value)})}/>:<span/>}</div>
     {o&&<div className="text-xs text-slate-500">Ordered {qty(o.ordered)} · already received {qty(o.received)} · <b>outstanding {qty(o.outstanding)}</b></div>}
     {poId&&l.inventory_item_id&&!o&&<div className="text-xs text-red-700">This item is not on the selected purchase order.</div>}
     {over>0&&<div className="text-xs text-red-700">Over-receipt: {qty(over)} more than outstanding. {canApproveOver?<label className="ml-2 inline-flex items-center gap-1 text-slate-700"><input type="checkbox" checked={!!l.over_receipt_approved} onChange={e=>set(i,{over_receipt_approved:e.target.checked})}/> Approve the over-receipt (recorded in the audit log)</label>:'Reduce the accepted quantity, or ask a logistics approver / Business Admin to record it.'}</div>}
    </div>})}
   {poId&&<p className="text-xs text-slate-500">Unit cost is taken from the purchase order line.</p>}</div>
  <div className="md:col-span-4"><button disabled={pending} className="button">Save draft receipt</button></div></form>}</PopupAction>
  <span className="text-sm text-slate-500 ml-2">Show:</span>{[['all','All'],['po','Against a PO'],['adhoc',`Ad-hoc (no PO) · ${adhocCount}`],['damaged','With damaged / rejected']].map(([k,l])=><Link key={k} href={href({tab:'receipts',receipt_view:k==='all'?undefined:k,receipt_status:rs==='all'?undefined:rs,...keep})} className={rv===k?'button':'button-secondary'}>{l}</Link>)}
  <select className="input w-auto" value={rs} onChange={e=>{window.location.href=href({tab:'receipts',receipt_view:rv==='all'?undefined:rv,receipt_status:e.target.value==='all'?undefined:e.target.value,...keep})}}><option value="all">Any status</option><option value="open">Not yet posted</option><option value="pending">In review (draft / prepared / reviewed)</option><option value="approved">Approved, awaiting posting</option><option value="posted">Posted</option></select>{(rf||rt)&&<Link href={href({tab:'receipts',receipt_view:rv==='all'?undefined:rv,receipt_status:rs==='all'?undefined:rs})} className="button-secondary">Dated {rf||'…'} to {rt||'…'} — show all dates</Link>}</ActionBar>
  <T h={['Receipt','Date','Source','Location','Supplier','Delivered','Accepted','Damaged','Rejected','Status','Actions']} r={shown.flatMap((r:any)=>{const t=totals(r.id);
   const row=<tr key={r.id} className={`border-b ${open===r.id?'bg-slate-50':''}`}><td className="p-3 font-medium">{r.receipt_number}</td><td className="p-3">{r.receipt_date}</td><td className="p-3">{r.purchase_order_id?<span>PO {r.purchase_order?.po_number||''}</span>:<span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Ad-hoc · no PO</span>}{t.over&&<span className="ml-1 rounded bg-red-50 px-2 py-0.5 text-xs text-red-700" title="Contains an approved over-receipt">Over-receipt</span>}</td><td className="p-3">{r.location?.location_code||'—'}</td><td className="p-3">{r.supplier?.legal_name||'—'}</td><td className="p-3">{qty(t.d)}</td><td className="p-3">{qty(t.a)}</td><td className={`p-3 ${t.dm?'text-amber-700 font-medium':''}`}>{qty(t.dm)}</td><td className={`p-3 ${t.rj?'text-red-700 font-medium':''}`}>{qty(t.rj)}</td><td className="p-3"><StatusBadge status={r.status}/></td><td className="p-3 whitespace-nowrap space-x-1"><button className="button-secondary" onClick={()=>setOpen(open===r.id?null:r.id)}>Details</button>{r.status==='draft'&&<button className="button-secondary" onClick={()=>run(()=>A.prepareReceiptAction(r.id))}>Prepare</button>}{r.status==='prepared'&&<><button className="button-secondary" onClick={()=>run(()=>A.reviewReceiptAction(r.id,true))}>Review</button><button className="button-secondary" onClick={()=>run(()=>A.reviewReceiptAction(r.id,false))}>Return</button></>}{r.status==='reviewed'&&<button className="button" onClick={()=>run(()=>A.approveReceiptAction(r.id))}>Approve</button>}{r.status==='approved'&&<button className="button" onClick={()=>run(()=>A.postReceiptAction(r.id))}>Post</button>}</td></tr>;
   const detail=open===r.id?<tr key={`${r.id}-d`} className="bg-slate-50"><td colSpan={11} className="p-4"><div className="text-xs text-slate-500 mb-2">Only accepted quantities are posted to stock; damaged and rejected quantities are recorded here and in the reports.{r.delivery_reference?` Delivery ref: ${r.delivery_reference}.`:''}</div><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="p-2">Item</th><th className="p-2">Delivered</th><th className="p-2">Accepted</th><th className="p-2">Damaged</th><th className="p-2">Rejected</th><th className="p-2">Lot</th><th className="p-2">Expiry</th>{showCost&&<th className="p-2">Unit cost</th>}<th className="p-2">Note</th></tr></thead><tbody>{receiptItems.filter((x:any)=>x.receipt_id===r.id).map((x:any)=><tr key={x.id} className="border-t"><td className="p-2">{itemLabel(x.inventory_item_id)}</td><td className="p-2">{qty(x.quantity)}</td><td className="p-2">{qty(x.accepted_qty??x.quantity)}</td><td className="p-2">{qty(x.damaged_qty)}</td><td className="p-2">{qty(x.rejected_qty)}</td><td className="p-2">{x.lot_number||'—'}</td><td className="p-2">{x.expiry_date||'—'}</td>{showCost&&<td className="p-2">{peso(x.unit_cost)}</td>}<td className="p-2">{x.over_receipt_approved?<span className="text-red-700">Over-receipt approved{x.over_receipt_approved_at?` ${String(x.over_receipt_approved_at).slice(0,10)}`:''}</span>:(x.notes||'—')}</td></tr>)}</tbody></table></td></tr>:null;
   return detail?[row,detail]:[row]})}/>
  {!shown.length&&<p className="text-sm text-slate-500">No receipts match this view.</p>}</section>}

// LOG-40 / 41 / 35 / 26: the ledger is filtered, paged and balanced in the database.
function LedgerView({ledger,showCost,locations,items,onHand}:{ledger:Ledger;showCost:boolean;locations:any[];items:any[];onHand:(i:string,l:string)=>number}){
 const f=ledger.filters;const total=ledger.total;const first=total?(f.page-1)*LEDGER_PAGE_SIZE+1:0;const last=Math.min(total,f.page*LEDGER_PAGE_SIZE);
 const loc=locations.find(l=>l.id===f.location);const item=items.find(i=>i.id===f.item);
 const atLocation=loc?items.map(i=>({i,q:onHand(i.id,loc.id)})).filter(x=>x.q!==0):[];
 return <section className="space-y-4">
  <form method="get" action={BASE} className="rounded-xl border bg-white p-4 flex flex-wrap gap-2 items-end"><input type="hidden" name="tab" value="ledger"/>
   <F l="Search"><input className="input" name="q" defaultValue={f.q} placeholder="Item, movement, reference or lot"/></F>
   <F l="Movement"><select className="input" name="type" defaultValue={f.type}><option value="">All movements</option>{MOVEMENT_TYPES.map(x=><option key={x} value={x}>{x.replace('_',' ')}</option>)}</select></F>
   <F l="Location"><select className="input" name="location" defaultValue={f.location}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}</select></F>
   <F l="Item"><select className="input" name="item" defaultValue={f.item}><option value="">All items</option>{items.map(i=><option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}</select></F>
   <F l="From"><input className="input" type="date" name="from" defaultValue={f.from}/></F>
   <F l="To"><input className="input" type="date" name="to" defaultValue={f.to}/></F>
   <button className="button">Apply</button><Link className="button-secondary" href={href({tab:'ledger'})}>Clear</Link>
   <a className="button-secondary" href={`/logistics/inventory/ledger/export?${ledgerQuery(f,true)}`}>Export CSV</a>
  </form>
  {loc&&<div className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-1">Location view: {loc.location_code} — {loc.location_name}</h3><p className="text-xs text-slate-500 mb-3">On hand at this location; the ledger below shows the running balance of each item at this location.</p>{atLocation.length?<div className="flex flex-wrap gap-2">{atLocation.map(({i,q})=><Link key={i.id} href={`${BASE}?${ledgerQuery({location:loc.id,item:i.id})}`} className={`rounded border px-3 py-1 text-sm hover:border-slate-500 ${f.item===i.id?'bg-slate-100 border-slate-500':''}`}>{i.item_code}: <b>{qty(q)}</b> {i.unit}</Link>)}</div>:<p className="text-sm text-slate-500">No stock at this location.</p>}</div>}
  <section className="rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-2 mb-3"><h3 className="font-semibold">Stock movement ledger{item?` — ${item.item_code} ${item.item_name}`:''}</h3><span className="text-sm text-slate-500">{total?`${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} movements`:'No movements match these filters.'}</span></div>
   <T h={['Date','Movement','Type','Item','Location','Lot','Qty','Balance at location',...(showCost?['Unit cost']:[]),'Reference']} r={ledger.rows.map((m:any)=><tr key={m.id} className="border-b"><td className="p-3">{m.movement_date}</td><td className="p-3 text-xs">{m.movement_number}</td><td className="p-3">{String(m.movement_type).replace('_',' ')}</td><td className="p-3"><Link className="hover:underline" href={`${BASE}?${ledgerQuery({...f,page:1,item:m.inventory_item_id})}`}>{m.item_code} — {m.item_name}</Link></td><td className="p-3"><Link className="hover:underline" href={`${BASE}?${ledgerQuery({...f,page:1,location:m.location_id})}`}>{m.location_code}</Link></td><td className="p-3">{m.lot_number||'—'}</td><td className={`p-3 ${Number(m.signed_quantity)<0?'text-red-700':''}`}>{Number(m.signed_quantity)>0?'+':''}{qty(m.signed_quantity)}</td><td className="p-3 font-medium">{qty(m.running_balance)}</td>{showCost&&<td className="p-3">{m.unit_cost==null?'—':peso(m.unit_cost)}</td>}<td className="p-3">{m.source_table==='logistics_receipts'?<Link className="text-blue-700 hover:underline" href={href({tab:'receipts',receipt:m.source_record_id})}>{m.reference_number||m.movement_number}</Link>:(m.reference_number||'—')}</td></tr>)}/>
   <div className="flex justify-between mt-3">{f.page>1?<Link className="button-secondary" href={`${BASE}?${ledgerQuery({...f,page:f.page-1})}`}>← Newer</Link>:<span/>}{last<total?<Link className="button-secondary" href={`${BASE}?${ledgerQuery({...f,page:f.page+1})}`}>Older →</Link>:<span/>}</div>
  </section>
 </section>
}
function Transfers({statusFilter,transfers,transferItems,locations,items,pending,run,msg}:any){
 const[open,setOpen]=useState<string|null>(null);
 const lineFor=(id:string)=>transferItems.filter((x:any)=>x.transfer_id===id);
 return <section className="space-y-5"><ActionBar>{statusFilter==='pending'&&<Link href={href({tab:'transfers'})} className="button-secondary">Showing pending only — show all</Link>}<PopupAction label="+ Create stock transfer" title="Create stock transfer" notice={msg} wide>{(close)=><TransferForm locations={locations} items={items} pending={pending} run={run} onSaved={close}/>}</PopupAction></ActionBar><T h={['Transfer','Date','From','To','Status','Actions']} r={transfers.filter((t:any)=>statusFilter!=='pending'||t.status!=='posted').flatMap((t:any)=>{const row=<tr key={t.id} className="border-b"><td className="p-3 font-medium">{t.transfer_number}</td><td className="p-3">{t.transfer_date}</td><td className="p-3">{t.from_location?.location_code}</td><td className="p-3">{t.to_location?.location_code}</td><td className="p-3"><StatusBadge status={t.status}/></td><td className="p-3 whitespace-nowrap space-x-1"><button className="button-secondary" onClick={()=>setOpen(open===t.id?null:t.id)}>Details</button>{t.status==='draft'&&<button className="button-secondary" onClick={()=>run(()=>A.prepareTransferAction(t.id))}>Prepare</button>}{t.status==='prepared'&&<><button className="button-secondary" onClick={()=>run(()=>A.reviewTransferAction(t.id,true))}>Review</button><button className="button-secondary" onClick={()=>run(()=>A.reviewTransferAction(t.id,false))}>Return</button></>}{t.status==='reviewed'&&<button className="button" onClick={()=>run(()=>A.approveTransferAction(t.id))}>Approve</button>}{t.status==='approved'&&<button className="button" onClick={()=>run(()=>A.postTransferAction(t.id))}>Post</button>}</td></tr>;
 const detail=open===t.id?<tr key={`${t.id}-detail`} className="bg-slate-50"><td colSpan={6} className="p-4"><div className="grid md:grid-cols-4 gap-3 text-sm mb-3"><div><b>Transfer number</b><div>{t.transfer_number}</div></div><div><b>Status</b><div>{t.status}</div></div><div><b>Source</b><div>{t.from_location?.location_name}</div></div><div><b>Destination</b><div>{t.to_location?.location_name}</div></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="p-2">Item</th><th className="p-2">Lot</th><th className="p-2">Quantity</th><th className="p-2">Notes</th></tr></thead><tbody>{lineFor(t.id).map((l:any)=><tr key={l.id} className="border-t"><td className="p-2">{items.find((i:any)=>i.id===l.inventory_item_id)?.item_code || l.inventory_item_id}</td><td className="p-2">{l.lot_code||<span className="text-slate-500">Oldest first</span>}</td><td className="p-2">{Number(l.quantity).toLocaleString()}</td><td className="p-2">{l.notes||'—'}</td></tr>)}</tbody></table></div></td></tr>:null; return detail?[row,detail]:[row]})}/></section>}
function F({l,children}:{l:string;children:any}){return <div><label className="label">{l}</label>{children}</div>}function T({h,r}:{h:string[];r:any[]}){return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500">{h.map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{r}</tbody></table></div>}
