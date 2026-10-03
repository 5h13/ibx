'use client';

import { Form } from '@/core/ui/Form';
// Build 67 — Storefront / Counter Sales (DOC-15), counter sale screen.
// Layout rule (Build 65): the page opens on the day's figures and the sales
// register; "+ New sale" and store settings open in pop-ups.
// Build 68: Receive AR payment, Return / refund and Close the day (pop-ups),
// plus Returns and Daily closings tabs.
// Build 74: cash tendered / change and checks on every payment line (PayRow),
// late encoding and cancellation with approval (SF-17), no-cost items need an
// approver (SF-14), search past sales (SF-19), Orders tab with DRs from sales
// orders (SF-01), Checks tab (SF-27), read-only view for Finance (SF-20).

import { useMemo, useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { CatalogItemPicker } from '@/shared/catalog/CatalogItemPicker';
import {
  addCustomerAction, approveSaleAction, cancelSaleAction, completeSaleAction, decideCancelAction, priceLinesAction, requestCancelAction,
  setStoreLocationAction, submitSaleAction, type LotOption, type PriceLine, type StoreOrder,
} from './actions';
import { CONDITION_LABEL, METHODS, REASON_LABEL, changeDue, lotLabel, methodLabel, num, paysToInput, peso, r2, type Pay } from './storefrontShared';
import { PayRow } from './PayRow';
import { OrdersTab } from './StorefrontOrders';
import { ChecksTab } from './StorefrontChecks';
import { ArCollectionForm, CashDrawerForm, ClosingForm, ClosingsTab, ReturnForm, ReturnsTab } from './StorefrontCounterOps';
import { CustomerBox } from './CustomerBox';
import { AccountPicker, StoreAccountsContext, type StoreAccount } from './accountsContext';
import { StoreSettingsExtra } from './StoreSettingsExtra';

type Ctx = { business_id: string; location_id: string | null; location_name: string | null; walk_in_customer_id: string; can_approve: boolean; can_setup: boolean; read_only?: boolean; can_handle_checks?: boolean;
  is_super_admin?: boolean; booklet_business_id?: string; booklet_code?: string; booklet_name?: string; booklet_vat?: boolean; own_vat?: boolean; accounts?: StoreAccount[] };
type Customer = { id: string; customer_code: string; legal_name: string; phone: string | null };
// Build 78: every product line carries its lot (oldest with stock filled in); reserved / available per item.
type Line = { key: number; item_id: string; item_code: string; name: string; unit: string; item_type: string; qty: number; price: string; list: number; floor: number; on_hand: number | null; no_cost: boolean;
  lot_id: string; lots: LotOption[]; reserved: number | null; available: number | null; order_only: boolean };
let lineKey = 0;
const toLine = (p: PriceLine, lot: string | null): Line => ({ key: ++lineKey, item_id: p.item_id, item_code: p.item_code, name: p.item_name, unit: p.unit, item_type: p.item_type, qty: 1, price: String(p.list_price),
  list: Number(p.list_price), floor: Number(p.floor_price), on_hand: p.on_hand == null ? null : Number(p.on_hand), no_cost: !!p.no_cost, lot_id: lot ?? '', lots: p.lots ?? [],
  reserved: p.reserved == null ? null : Number(p.reserved), available: p.available == null ? null : Number(p.available), order_only: p.stock_type === 'order_only' });
/** Build 79 (SF-31): a line follows its lot — price, minimum and store price come from that lot's purchase price. */
const lotPricing = (l: Line, lotId: string): Partial<Line> => {
  const o = l.lots.find((x) => x.lot_id === lotId);
  return o && o.list_price != null ? { lot_id: lotId, list: Number(o.list_price), floor: Number(o.floor_price ?? o.list_price), price: String(Number(o.list_price)), no_cost: !(Number(o.unit_cost ?? 0) > 0) && l.no_cost } : { lot_id: lotId };
};
const qtyText = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-lg border bg-white p-3"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div>{hint && <div className="text-xs text-slate-500">{hint}</div>}</div>;
}

/** Payments + documents (used when creating and when completing an approved sale). */
export function PaymentBlock({ total, pays, setPays, si, setSi, dr, setDr, vatBooklet = false, drFixed = false, vatNote }: { total: number; pays: Pay[]; setPays: (p: Pay[]) => void; si: string; setSi: (v: string) => void; dr: boolean; setDr: (v: boolean) => void; vatBooklet?: boolean; drFixed?: boolean; vatNote?: string }) {
  const paid = r2(pays.reduce((s, p) => s + (Number.isFinite(num(p.amount)) ? num(p.amount) : 0), 0));
  const balance = r2(total - paid);
  const set = (i: number, patch: Partial<Pay>) => setPays(pays.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const dueBefore = (i: number) => r2(total - pays.reduce((s, p, j) => s + (j !== i && Number.isFinite(num(p.amount)) ? num(p.amount) : 0), 0));
  const change = changeDue(pays);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {pays.map((p, i) => <PayRow key={i} p={p} set={(patch) => set(i, patch)} remove={() => setPays(pays.filter((_, j) => j !== i))} due={dueBefore(i)} />)}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button-secondary" onClick={() => setPays([...pays, { method: 'cash', amount: '', reference: '' }])}>+ Add payment</button>
          <button type="button" className="button-secondary" disabled={balance <= 0} onClick={() => setPays([...pays.filter((p) => num(p.amount) > 0), { method: 'cash', amount: String(r2(balance)), reference: '' }])}>Pay balance in cash</button>
        </div>
      </div>
      <div className="grid gap-2 rounded bg-slate-50 p-3 text-sm sm:grid-cols-3">
        <div>Total <b>{peso(total)}</b></div><div>Paid <b>{peso(paid)}</b>{change > 0 && <> · change <b className="text-emerald-700">{peso(change)}</b></>}</div>
        <div>{balance > 0 ? <>Charge to account (AR) <b className="text-amber-700">{peso(balance)}</b></> : balance < 0 ? <b className="text-red-700">Paid more than the total by {peso(-balance)}</b> : <b className="text-emerald-700">{total > 0 ? 'Fully paid' : '—'}</b>}</div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={dr} disabled={drFixed} onChange={(e) => setDr(e.target.checked)} /> Issue DR (numbered by the system)</label>
        <label className="flex items-center gap-2">SI number <input className="input w-40" value={si} onChange={(e) => setSi(e.target.value)} placeholder="From BIR booklet" /></label>
      </div>
      {vatNote && <p className="text-xs text-slate-600">{vatNote}</p>}
      {!vatNote && si.trim() && vatBooklet && total > 0 && <p className="text-xs text-slate-600">With an SI from a VAT-registered booklet this sale carries VAT: prices include VAT of {peso(r2(total * 12 / 112))} (VATable sales {peso(r2(total - r2(total * 12 / 112)))}).</p>}
    </div>
  );
}

function SaleForm({ ctx, customers: initialCustomers, onDone }: { ctx: Ctx; customers: Customer[]; onDone: (msg: string) => void }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(ctx.walk_in_customer_id);
  const [adding, setAdding] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', phone: '', address: '', tax_id: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [pays, setPays] = useState<Pay[]>([{ method: 'cash', amount: '', reference: '' }]);
  const [si, setSi] = useState('');
  const [dr, setDr] = useState(true);
  const [notes, setNotes] = useState('');
  const [saleDate, setSaleDate] = useState(manilaToday());
  const [lateReason, setLateReason] = useState('');
  const [hardcopy, setHardcopy] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const late = saleDate < manilaToday();

  const total = useMemo(() => r2(lines.reduce((s, l) => s + (Number.isFinite(num(l.price)) ? r2(l.qty * num(l.price)) : 0), 0)), [lines]);
  const belowPrice = lines.some((l) => num(l.price) < l.floor);
  const noCost = lines.some((l) => l.no_cost);
  // Build 78: quantity per item over all its lines, against what is free (on hand − reserved for sales orders)
  const itemQty = lines.reduce<Record<string, number>>((m, l) => ({ ...m, [l.item_id]: (m[l.item_id] ?? 0) + (l.qty > 0 ? l.qty : 0) }), {});
  const dipsReserved = (l: Line) => (l.reserved ?? 0) > 0 && (itemQty[l.item_id] ?? 0) > Math.max(l.available ?? 0, 0);
  const reservedHit = lines.some(dipsReserved);
  const below = belowPrice || noCost || late || reservedHit;   // any of these → an approver signs off first
  const short = lines.filter((l) => l.item_type !== 'service' && l.on_hand !== null && (itemQty[l.item_id] ?? 0) > l.on_hand);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function addItem(id: string) {
    setError('');
    start(async () => {
      try {
        const [p] = await priceLinesAction([id]);
        if (!p) return;
        const existing = lines.findIndex((l) => l.item_id === id && l.lot_id === (p.default_lot_id ?? ''));
        if (existing >= 0) set(existing, { qty: lines[existing].qty + 1 });
        else setLines([...lines, toLine(p, p.default_lot_id)]);
        setPickerKey((k) => k + 1);
      } catch (e) { setError(errorText(e)); }
    });
  }
  /** Build 78: the same item from another lot, on its own line (the next lot not used yet). */
  function addLotLine(i: number) {
    const l = lines[i];
    const used = new Set(lines.filter((x) => x.item_id === l.item_id).map((x) => x.lot_id));
    const next = l.lots.find((o) => !used.has(o.lot_id));
    if (!next) { setError(`${l.name}: every lot with stock is already on the sale.`); return; }
    const nl: Line = { ...l, key: ++lineKey, qty: 1 };
    setLines([...lines.slice(0, i + 1), { ...nl, ...lotPricing(nl, next.lot_id) }, ...lines.slice(i + 1)]);
  }
  function saveCustomer() {
    setError('');
    start(async () => {
      try {
        const id = await addCustomerAction(newCust);
        setCustomers([{ id, customer_code: 'new', legal_name: newCust.name, phone: newCust.phone || null }, ...customers]);
        setCustomerId(id); setAdding(false); setNewCust({ name: '', phone: '', address: '', tax_id: '' });
      } catch (e) { setError(errorText(e)); }
    });
  }
  function submit() {
    setError('');
    if (!lines.length) { setError('Add at least one item.'); return; }
    if (lines.some((l) => !(l.qty > 0) || !Number.isFinite(num(l.price)))) { setError('Every line needs a quantity and a price.'); return; }
    if (late && !lateReason.trim()) { setError('Say why this sale is entered late.'); return; }
    const dup = lines.find((l, i) => lines.findIndex((x) => x.item_id === l.item_id && x.lot_id === l.lot_id) !== i);
    if (dup) { setError(`${dup.name} is on the sale twice from the same lot: put the quantity on one line.`); return; }
    const noLot = lines.find((l) => l.item_type !== 'service' && l.lots.length > 0 && !l.lot_id);
    if (noLot) { setError(`Choose the lot for ${noLot.name}.`); return; }
    const ordOnly = lines.find((l) => l.order_only && (itemQty[l.item_id] ?? 0) > Math.max(l.on_hand ?? 0, 0));
    if (ordOnly) { setError(`${ordOnly.name} is an order-only item with ${qtyText(Math.max(ordOnly.on_hand ?? 0, 0))} on hand: make a quotation so it is ordered from the supplier.`); return; }
    start(async () => {
      try {
        const r = await submitSaleAction({
          customer_id: customerId, notes,
          lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.qty, unit_price: num(l.price), lot_id: l.lot_id || null })),
          payments: below ? [] : paysToInput(pays),
          si_number: si, issue_dr: dr, sale_date: saleDate, late_reason: late ? lateReason : undefined, hardcopy_dr_no: hardcopy.trim() || undefined,
        });
        onDone(r.status === 'pending_approval'
          ? `${r.sale_number} saved and sent for approval (${(r.reasons ?? []).map((x) => REASON_LABEL[x] ?? x).join(', ')}). Take payment when it is approved (Awaiting approval tab).`
          : `${r.sale_number} completed — ${peso(r.total)}.`);
      } catch (e) { setError(errorText(e)); }
    });
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h4 className="font-semibold">Customer</h4>
        <div className="flex flex-wrap items-center gap-2">
          <CustomerBox customers={customers} value={customerId} onChange={setCustomerId} walkInId={ctx.walk_in_customer_id} />
          <button type="button" className="button-secondary" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ New customer'}</button>
        </div>
        {adding && (
          <div className="grid gap-2 rounded border p-3 sm:grid-cols-4">
            <input className="input sm:col-span-2" placeholder="Customer / company name *" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
            <input className="input" placeholder="Phone" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
            <input className="input" placeholder="TIN" value={newCust.tax_id} onChange={(e) => setNewCust({ ...newCust, tax_id: e.target.value })} />
            <input className="input sm:col-span-3" placeholder="Address" value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} />
            <button type="button" className="button" disabled={pending || !newCust.name.trim()} onClick={saveCustomer}>Save customer</button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold">Items</h4>
        <CatalogItemPicker key={pickerKey} onSelect={(it) => it && addItem(it.id)} placeholder="Search item by name or code to add…" />
        {lines.length > 0 && (
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2">Lot</th><th className="p-2 w-24">Qty</th><th className="p-2 w-32">Price</th><th className="p-2 text-right">Amount</th><th className="p-2" /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const price = num(l.price);
                  return (
                    <tr key={l.key} className="border-b align-top last:border-0">
                      <td className="p-2"><div className="font-medium">{l.name}</div>
                        <div className="text-xs text-slate-500">{l.item_code} · store price {peso(l.list)} · min {peso(l.floor)}{l.on_hand !== null && ` · ${qtyText(l.on_hand)} ${l.unit} on hand`}
                          {(l.reserved ?? 0) > 0 && ` · ${qtyText(l.reserved ?? 0)} reserved · ${qtyText(Math.max(l.available ?? 0, 0))} available`}</div>
                        {price < l.floor && <div className="text-xs font-medium text-amber-700">Below the 7% floor — needs an approver</div>}
                        {l.no_cost && <div className="text-xs font-medium text-amber-700">No cost on record for this item — needs an approver</div>}
                        {dipsReserved(l) && <div className="text-xs font-medium text-amber-700">Takes stock reserved for sales orders — needs an approver</div>}
                        {l.order_only && (itemQty[l.item_id] ?? 0) > Math.max(l.on_hand ?? 0, 0) && <div className="text-xs font-medium text-red-700">Order-only item: only {qtyText(Math.max(l.on_hand ?? 0, 0))} on hand — make a quotation instead</div>}
                        {!l.order_only && l.on_hand !== null && (itemQty[l.item_id] ?? 0) > l.on_hand && <div className="text-xs text-red-700">More than on hand — stock will go negative</div>}
                      </td>
                      <td className="p-2">{l.item_type === 'service' ? <span className="text-xs text-slate-400">—</span> : l.lots.length === 0
                        ? <span className="text-xs text-slate-500">No lot with stock here</span>
                        : <div className="space-y-1"><select className="input min-w-[12rem]" value={l.lot_id} onChange={(e) => set(i, lotPricing(l, e.target.value))}>
                            <option value="">Choose the lot…</option>
                            {l.lots.map((o) => <option key={o.lot_id} value={o.lot_id}>{lotLabel(o)}{o.list_price != null ? ` → sells ${peso(o.list_price)}` : ''}</option>)}
                          </select>
                          {(() => { const o = l.lots.find((x) => x.lot_id === l.lot_id); return o && l.qty > Number(o.on_hand) ? <div className="text-xs text-red-700">More than this lot holds ({qtyText(Number(o.on_hand))})</div> : null; })()}
                          {l.lots.length > 1 && <button type="button" className="text-xs text-blue-700 underline" onClick={() => addLotLine(i)}>+ from another lot</button>}</div>}
                      </td>
                      <td className="p-2"><input className="input" type="number" min="0.001" step="any" value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></td>
                      <td className="p-2"><input className={`input ${price < l.floor ? 'border-amber-500' : ''}`} type="number" min="0" step="0.01" value={l.price} onChange={(e) => set(i, { price: e.target.value })} />
                        {price !== l.list && Number.isFinite(price) && <div className="text-xs text-slate-500">{price < l.list ? `${r2(100 - (price / l.list) * 100)}% off` : 'above store price'}</div>}</td>
                      <td className="p-2 text-right whitespace-nowrap">{Number.isFinite(price) ? peso(r2(l.qty * price)) : '—'}</td>
                      <td className="p-2"><button type="button" className="button-secondary" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {short.length > 0 && <p className="text-xs text-slate-500">Opening stock is not recorded yet for some items, so the system may show less than you have.</p>}
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold">Payment and documents</h4>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">Sale date <input className="input w-auto" type="date" max={manilaToday()} value={saleDate} onChange={(e) => setSaleDate(e.target.value || manilaToday())} /></label>
          {late && <input className="input max-w-md" placeholder="Why is this sale entered late? *" value={lateReason} onChange={(e) => setLateReason(e.target.value)} />}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">Hardcopy DR no. <input className="input w-48" value={hardcopy} maxLength={40} onChange={(e) => setHardcopy(e.target.value)} placeholder="Optional — handwritten DR on site" /></label>
        {below
          ? <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{[belowPrice && 'A price is below the 7% floor', noCost && 'an item has no cost on record', late && `the sale is dated ${saleDate} (entered late)`, reservedHit && 'it takes stock reserved for sales orders'].filter(Boolean).join('; ')}. The sale goes to an approver first; payment and documents are taken after approval ({peso(total)}).</div>
          : <PaymentBlock total={total} pays={pays} setPays={setPays} si={si} setSi={setSi} dr={dr} setDr={setDr} vatBooklet={!!ctx.booklet_vat} />}
        <input className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex justify-end">
        <button type="button" className="button" disabled={pending || !lines.length} onClick={submit}>{pending ? 'Saving…' : below ? `Send for approval (${peso(total)})` : `Complete sale (${peso(total)})`}</button>
      </div>
    </div>
  );
}

function CompleteForm({ sale, onDone, vatBooklet = false }: { sale: any; onDone: (msg: string) => void; vatBooklet?: boolean }) {
  const [pays, setPays] = useState<Pay[]>([{ method: 'cash', amount: '', reference: '' }]);
  const [si, setSi] = useState('');
  const [dr, setDr] = useState(true);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{sale.sale_number} · {sale.customer?.legal_name} · approved{sale.late_entry ? ` · sale date ${sale.sale_date} (entered late)` : ''}</p>
      <PaymentBlock total={Number(sale.total)} pays={pays} setPays={setPays} si={si} setSi={setSi} dr={dr} setDr={setDr} vatBooklet={vatBooklet} />
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex justify-end"><button type="button" className="button" disabled={pending} onClick={() => start(async () => {
        try { await completeSaleAction(sale.id, { payments: paysToInput(pays), si_number: si, issue_dr: dr }); onDone(`${sale.sale_number} completed.`); }
        catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Complete sale'}</button></div>
    </div>
  );
}

function CancelRequestForm({ sale, onDone }: { sale: any; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Cancelling {sale.sale_number} ({peso(sale.total)}) reverses the whole sale once another approver agrees: goods back to stock, the unpaid balance taken off, the rest refunded the way it was paid (checks in cash). The sale and its reversal both stay on record.</p>
      <input className="input" placeholder="Why is the sale cancelled? *" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="flex justify-end"><button type="button" className="button" disabled={pending || !reason.trim()} onClick={() => start(async () => {
        try { await requestCancelAction(sale.id, reason); onDone(`Cancellation of ${sale.sale_number} sent for approval.`); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Sending…' : 'Ask to cancel'}</button></div>
    </div>
  );
}

function DecideCancelForm({ sale, onDone }: { sale: any; onDone: (msg: string) => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const go = (approve: boolean) => start(async () => {
    try {
      const r = await decideCancelAction(sale.id, approve, note);
      onDone(approve ? `${sale.sale_number} cancelled${r.return_number ? ` — reversed by ${r.return_number}${Number(r.refund) > 0 ? `, refund ${peso(r.refund)}` : ''}${Number(r.credit_to_ar) > 0 ? `, ${peso(r.credit_to_ar)} off the unpaid balance` : ''}` : ''}.` : `Cancellation of ${sale.sale_number} refused.`);
    } catch (e) { setError(errorText(e)); }
  });
  return (
    <div className="space-y-3 text-sm">
      <p>{sale.sale_number} · {sale.customer?.legal_name} · {peso(sale.total)} · paid {peso(sale.amount_paid)}</p>
      <p className="text-slate-600">Reason: {sale.cancel_reason}</p>
      <input className="input" placeholder="Note (required when refusing)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" disabled={pending} onClick={() => go(false)}>Refuse</button>
        <button type="button" className="button" disabled={pending} onClick={() => go(true)}>Approve cancellation</button>
      </div>
    </div>
  );
}

function SaleDetail({ sale, items, payments, returnItems = [], canRequestCancel = false, onMessage }: { sale: any; items: any[]; payments: any[]; returnItems?: any[]; canRequestCancel?: boolean; onMessage?: (m: string) => void }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <div><span className="text-slate-500">Customer</span><div className="font-medium">{sale.customer?.legal_name}</div></div>
        <div><span className="text-slate-500">DR / SI</span><div className="font-medium">{sale.dr_number ?? '—'} / {sale.si_number ?? '—'}</div>{sale.hardcopy_dr_no && <div className="text-xs text-slate-500">Hardcopy DR no. {sale.hardcopy_dr_no}</div>}</div>
        <div><span className="text-slate-500">Status</span><div className="font-medium capitalize">{String(sale.status).replace('_', ' ')}{sale.cancel_status === 'approved' ? ' · cancelled (reversed)' : sale.cancel_status === 'requested' ? ' · cancellation requested' : ''}</div></div>
      </div>
      {sale.late_entry && <div className="rounded bg-amber-50 p-2 text-amber-800">Entered late — sale date {sale.sale_date}. Reason: {sale.late_reason}</div>}
      {sale.sales_order_id && <div className="rounded bg-slate-50 p-2">From sales order {sale.order?.order_number ?? ''} · {sale.release_status === 'released' ? 'released by the Warehouse' : 'waiting for the Warehouse to release the items'}</div>}
      <table className="w-full"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Store price</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">Amount</th></tr></thead>
        <tbody>{items.map((i) => {
          const ret = returnItems.filter((r) => r.sale_item_id === i.id);
          return <tr key={i.id} className="border-b align-top"><td className="p-2">{i.description}{i.below_floor && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-800">approved price</span>}
            {i.lot_code && <div className="text-xs text-slate-500">Lot {i.lot_code}</div>}
            {ret.length > 0 && <div className="text-xs text-slate-500">Returned: {ret.map((r) => `${Number(r.quantity)} ${CONDITION_LABEL[r.condition] ?? r.condition}`).join(', ')}</div>}</td>
            <td className="p-2 text-right">{Number(i.quantity)} {i.unit}</td><td className="p-2 text-right">{peso(i.list_price)}</td><td className="p-2 text-right">{peso(i.unit_price)}</td><td className="p-2 text-right">{peso(i.line_total)}</td></tr>;
        })}</tbody></table>
      <div className="grid gap-2 sm:grid-cols-4"><div>Total <b>{peso(sale.total)}</b></div><div>Discount <b>{peso(sale.discount_total)}</b></div><div>Paid <b>{peso(sale.amount_paid)}</b></div><div>To AR <b>{peso(sale.balance)}</b></div></div>
      {sale.vat_applied ? <div className="rounded bg-slate-50 p-2">VAT-inclusive: VATable sales <b>{peso(Number(sale.total) - Number(sale.vat_amount))}</b> · VAT 12% <b>{peso(sale.vat_amount)}</b></div>
        : sale.status === 'completed' && <div className="text-xs text-slate-500">No VAT on this sale{sale.si_number ? ' (SI from a non-VAT booklet)' : ' (DR only)'}.</div>}
      {payments.length > 0 && <div><div className="mb-1 font-medium">Payments</div>{payments.map((p) => <div key={p.id} className="flex justify-between border-b py-1"><span>{p.payment_number} · {p.kind === 'refund' ? 'Refund · ' : ''}{methodLabel(p.method)}{p.reference_number ? ` · ${p.reference_number}` : ''}{p.tendered != null ? ` · tendered ${peso(p.tendered)}, change ${peso(p.change_given)}` : ''}</span><span className="flex items-center gap-2">{p.kind !== 'refund' && <a className="text-xs underline" href={`/sales/storefront/payments/${p.id}/receipt`} target="_blank" rel="noreferrer">Receipt</a>}<span className={p.kind === 'refund' ? 'text-red-700' : ''}>{p.kind === 'refund' ? `−${peso(p.amount)}` : peso(p.amount)}</span></span></div>)}</div>}
      <div className="flex flex-wrap gap-2">
        {sale.dr_number && <a className="button-secondary inline-block" href={`/sales/storefront/${sale.id}/dr`} target="_blank" rel="noreferrer">Print DR</a>}
        {canRequestCancel && sale.status === 'completed' && !['requested', 'approved'].includes(sale.cancel_status) && (
          <PopupAction label="Cancel this sale…" title={`Cancel ${sale.sale_number}`} variant="secondary" wide>{(close) => <CancelRequestForm sale={sale} onDone={(m) => { onMessage?.(m); close(); }} />}</PopupAction>
        )}
      </div>
    </div>
  );
}

const TABS = ['register', 'approval', 'orders', 'returns', 'checks', 'closing'] as const;

export function StorefrontManagement({ ctx, date, today, sales, open, items, payments, dayPayments, returns, closings, customers, locations, initialTab = 'register', dayCash = [], me = '',
  cancelRequests = [], returnItems = [], checks = [], orders = [], search = '' }: {
  ctx: Ctx; date: string; today: string; sales: any[]; open: any[]; items: any[]; payments: any[]; dayPayments: any[]; returns: any[]; closings: any[]; dayCash?: any[]; me?: string;
  customers: Customer[]; locations: any[]; initialTab?: string; cancelRequests?: any[]; returnItems?: any[]; checks?: any[]; orders?: StoreOrder[]; search?: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>((TABS as readonly string[]).includes(initialTab) ? (initialTab as (typeof TABS)[number]) : 'register');
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const [locId, setLocId] = useState(ctx.location_id ?? '');
  const act = (fn: () => Promise<unknown>, ok: string) => start(async () => { try { await fn(); setMessage(ok); } catch (e) { setMessage(errorText(e)); } });
  const ro = !!ctx.read_only;

  const done = sales.filter((s) => s.status === 'completed');
  // money in minus refunds out, for every counter payment received on this day (sales, old AR, refunds)
  const signed = (p: any) => (p.kind === 'refund' ? -1 : 1) * Number(p.amount);
  const byMethod = METHODS.map((m) => ({ ...m, amount: r2(dayPayments.filter((p) => p.method === m.v).reduce((s, p) => s + signed(p), 0)) })).filter((m) => m.amount !== 0);
  const arCollected = r2(dayPayments.filter((p) => p.kind === 'ar_collection').reduce((s, p) => s + Number(p.amount), 0));
  const refunded = r2(dayPayments.filter((p) => p.kind === 'refund').reduce((s, p) => s + Number(p.amount), 0));
  const pendingClosings = closings.filter((c) => c.status === 'submitted').length;
  const collected = r2(byMethod.reduce((s, m) => s + m.amount, 0));
  const itemsOf = (id: string) => items.filter((i) => i.sale_id === id);
  const paysOf = (id: string) => payments.filter((p) => p.sale_id === id);
  const toApprove = open.length + cancelRequests.length;
  const checksDue = checks.filter((k) => k.status === 'on_hand' && k.check_date <= today).length;
  const ordersOpen = orders.filter((o) => o.status !== 'fulfilled').length;

  return (
    <StoreAccountsContext.Provider value={ctx.accounts ?? []}>
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Storefront{ro ? ' — view only' : ''}</h2>
        <p className="mt-1 text-sm text-slate-500">Counter sales for this store · selling from <b>{ctx.location_name ?? 'no location set'}</b>{ro ? ' · Finance view: figures and documents only' : ''}</p>
      </div>
      {!ro && !ctx.location_id && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{ctx.can_setup ? 'Choose the stock location this store sells from (Store settings) before the first sale.' : 'A Business Admin must choose the store’s stock location (Store settings) before sales can be recorded.'}</div>}
      {message && <div className="rounded border bg-white p-3 text-sm">{message}</div>}

      {!ro && (
      <ActionBar>
        <PopupAction label="+ New sale" title="New counter sale" wide disabled={!ctx.location_id} openParam="sale">
          {(close) => <SaleForm ctx={ctx} customers={customers} onDone={(m) => { setMessage(m); close(); }} />}
        </PopupAction>
        <PopupAction label="Receive AR payment" title="Receive payment on an existing invoice" variant="secondary" wide openParam="arpay">
          {(close) => <ArCollectionForm customers={customers} walkInId={ctx.walk_in_customer_id} onDone={(m) => { setMessage(m); close(); }} />}
        </PopupAction>
        <PopupAction label="Return / refund" title="Return / refund" variant="secondary" wide disabled={!ctx.location_id}>
          {(close) => <ReturnForm onDone={(m) => { setMessage(m); close(); }} />}
        </PopupAction>
        <PopupAction label="Cash drawer" title="Cash drawer — opening float / cash taken out" variant="secondary" wide>
          {(close) => <CashDrawerForm entries={dayCash} onDone={(m) => { setMessage(m); close(); }} />}
        </PopupAction>
        <PopupAction label="Close the day" title="Daily closing" variant="secondary" wide>
          {(close) => <ClosingForm date={date} today={today} onDone={(m) => { setMessage(m); setTab('closing'); close(); }} />}
        </PopupAction>
        {ctx.can_setup && (
          <PopupAction label="Store settings" title="Store settings" variant="secondary" wide notice={message}>
            {(close) => (
              <div className="space-y-3 text-sm">
                <label className="block">Stock location this store sells from
                  <select className="input mt-1" value={locId} onChange={(e) => setLocId(e.target.value)}>
                    <option value="">Select location</option>
                    {locations.map((l: any) => <option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}
                  </select>
                </label>
                <p className="text-xs text-slate-500">Counter sales issue stock from this location. Locations are managed in Logistics → Inventory → Locations.</p>
                <button className="button" disabled={pending || !locId} onClick={() => start(async () => { try { await setStoreLocationAction(locId); setMessage('Store location saved.'); close(); } catch (e) { setMessage(errorText(e)); } })}>Save location</button>
                <StoreSettingsExtra ctx={ctx} onMessage={setMessage} />
              </div>
            )}
          </PopupAction>
        )}
      </ActionBar>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={`Sales · ${date}`} value={peso(done.reduce((s, x) => s + Number(x.total), 0))} hint={`${done.length} completed sale(s)`} />
        <Tile label="Collected (net)" value={peso(collected)} hint={[byMethod.map((m) => `${m.l} ${peso(m.amount)}`).join(' · ') || 'No payments yet', arCollected > 0 ? `incl. old AR ${peso(arCollected)}` : '', refunded > 0 ? `after refunds ${peso(refunded)}` : ''].filter(Boolean).join(' · ')} />
        <Tile label="Charged to AR" value={peso(done.reduce((s, x) => s + Number(x.balance), 0))} hint="Unpaid balances of charge / partly paid sales" />
        <Tile label="Awaiting approval" value={String(toApprove)} hint={`Prices, no-cost items, late entries, cancellations${pendingClosings ? ` · ${pendingClosings} closing(s) to approve` : ''}`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={tab === 'register' ? 'button' : 'button-secondary'} onClick={() => setTab('register')}>Sales register</button>
        <button className={tab === 'approval' ? 'button' : 'button-secondary'} onClick={() => setTab('approval')}>Awaiting approval ({toApprove})</button>
        <button className={tab === 'orders' ? 'button' : 'button-secondary'} onClick={() => setTab('orders')}>Orders{ordersOpen ? ` (${ordersOpen} open)` : ''}</button>
        <button className={tab === 'returns' ? 'button' : 'button-secondary'} onClick={() => setTab('returns')}>Returns ({returns.length})</button>
        <button className={tab === 'checks' ? 'button' : 'button-secondary'} onClick={() => setTab('checks')}>Checks{checksDue ? ` (${checksDue} to deposit)` : ''}</button>
        <button className={tab === 'closing' ? 'button' : 'button-secondary'} onClick={() => setTab('closing')}>Daily closings{pendingClosings ? ` (${pendingClosings} to approve)` : ''}</button>
      </div>

      {tab === 'register' && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <Form method="get" className="flex flex-wrap items-center gap-2 text-sm">
            <label>Date <input className="input w-auto" type="date" name="date" defaultValue={date} /></label>
            <input className="input w-64" name="q" defaultValue={search} placeholder="Or search all dates: sale / DR / SI / hardcopy DR no., customer" />
            <button className="button-secondary">Show</button>
            {search && <a className="text-slate-500 underline" href="/sales/storefront">Clear search</a>}
          </Form>
          {search && <p className="text-xs text-slate-500">Sales matching “{search}” on any date (latest 100).</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Sale</th><th className="p-2">Customer</th><th className="p-2">DR / SI</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">To AR</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
              <tbody>
                {sales.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">{search ? 'No sale matches.' : 'No sales on this date.'}</td></tr>}
                {sales.map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="p-2 font-medium">{s.sale_number}<div className="text-xs font-normal text-slate-500">{search ? s.sale_date : new Date(s.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}{s.late_entry ? ' · entered late' : ''}{s.sales_order_id ? ' · order DR' : ''}</div></td>
                    <td className="p-2">{s.customer?.legal_name}</td>
                    <td className="p-2 text-xs">{s.dr_number ?? '—'}<br />{s.si_number ? `SI ${s.si_number}` : '—'}{s.hardcopy_dr_no && <><br />Hardcopy {s.hardcopy_dr_no}</>}</td>
                    <td className="p-2 text-right">{peso(s.total)}</td><td className="p-2 text-right">{peso(s.amount_paid)}</td>
                    <td className="p-2 text-right">{Number(s.balance) > 0 ? <span className="text-amber-700">{peso(s.balance)}</span> : '—'}</td>
                    <td className="p-2 capitalize">{String(s.status).replace('_', ' ')}{s.cancel_status === 'approved' ? <div className="text-xs text-red-700">cancelled (reversed)</div> : s.cancel_status === 'requested' ? <div className="text-xs text-amber-700">cancel requested</div> : null}</td>
                    <td className="p-2 whitespace-nowrap"><div className="flex gap-2"><PopupAction label="View" title={`Sale ${s.sale_number}`} variant="secondary" wide>{(close) => <SaleDetail sale={s} items={itemsOf(s.id)} payments={paysOf(s.id)} returnItems={returnItems} canRequestCancel={!ro} onMessage={(m) => { setMessage(m); close(); }} />}</PopupAction>
                      {!ro && s.status === 'completed' && s.cancel_status !== 'approved' && <PopupAction label="Return" title={`Return / refund · ${s.sale_number}`} variant="secondary" wide>{(close) => <ReturnForm saleNumber={s.sale_number} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'orders' && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <OrdersTab orders={orders} readOnly={ro || !ctx.location_id} canRelease={ctx.can_setup} canCancel={!ro && ctx.can_approve} vatBooklet={!!ctx.booklet_vat} onMessage={setMessage} />
        </section>
      )}

      {tab === 'returns' && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <Form method="get" className="flex flex-wrap items-center gap-2 text-sm"><input type="hidden" name="tab" value="returns" /><label>Date <input className="input w-auto" type="date" name="date" defaultValue={date} /></label><button className="button-secondary">Show</button></Form>
          <ReturnsTab returns={returns} payments={dayPayments} />
        </section>
      )}

      {tab === 'checks' && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <ChecksTab checks={checks} today={today} canHandle={!!ctx.can_handle_checks || ctx.can_approve} customers={customers} walkInId={ctx.walk_in_customer_id} onMessage={setMessage} />
        </section>
      )}

      {tab === 'closing' && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">Each day is closed by the cashier with the cash count and approved by a Sales approver or Business Admin. A returned closing unlocks the day for a recount.</p>
          <ClosingsTab closings={closings} canApprove={ctx.can_approve && !ro} me={me} onMessage={setMessage} />
        </section>
      )}

      {tab === 'approval' && (
        <section className="space-y-3 rounded-xl border bg-white p-4">
          {toApprove === 0 && <p className="text-sm text-slate-500">Nothing is waiting for approval.</p>}
          {open.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div className="text-sm"><div className="font-medium">{s.sale_number} · {s.customer?.legal_name} · {peso(s.total)}{s.late_entry ? ` · dated ${s.sale_date}` : ''}</div>
                <div className="text-xs text-slate-500">{s.status === 'approved' ? 'Approved — take payment to complete' : `Waiting for an approver: ${(s.approval_reasons ?? []).map((x: string) => REASON_LABEL[x] ?? x).join(', ') || 'price below the floor'}`}
                  {itemsOf(s.id).some((i) => i.below_floor) && ` · ${itemsOf(s.id).filter((i) => i.below_floor).map((i) => `${i.description} at ${peso(i.unit_price)}${Number(i.floor_price) > 0 ? ` (min ${peso(i.floor_price)})` : ' (no cost on record)'}`).join('; ')}`}
                  {s.late_reason && ` · late: ${s.late_reason}`}</div></div>
              {!ro && <div className="flex flex-wrap gap-2">
                {s.status === 'pending_approval' && ctx.can_approve && s.created_by === me && <span className="text-xs text-slate-500">You made this sale — another approver signs off</span>}
                {s.status === 'pending_approval' && ctx.can_approve && s.created_by !== me && <button className="button" disabled={pending} onClick={() => act(() => approveSaleAction(s.id), `${s.sale_number} approved.`)}>Approve</button>}
                {s.status === 'approved' && <PopupAction label="Take payment" title={`Complete ${s.sale_number}`} wide>{(close) => <CompleteForm sale={s} vatBooklet={!!ctx.booklet_vat} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>}
                <PopupAction label="View" title={`Sale ${s.sale_number}`} variant="secondary" wide><SaleDetail sale={s} items={itemsOf(s.id)} payments={[]} /></PopupAction>
                <button className="button-secondary" disabled={pending} onClick={() => act(() => cancelSaleAction(s.id), `${s.sale_number} cancelled.`)}>Cancel</button>
              </div>}
            </div>
          ))}
          {cancelRequests.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div className="text-sm"><div className="font-medium">Cancel {s.sale_number} · {s.customer?.legal_name} · {peso(s.total)} · {s.sale_date}</div>
                <div className="text-xs text-slate-500">Completed sale — cancellation requested: {s.cancel_reason}</div></div>
              {!ro && <div className="flex flex-wrap gap-2">
                {ctx.can_approve && s.cancel_requested_by === me && <span className="text-xs text-slate-500">You asked for it — another approver decides</span>}
                {ctx.can_approve && s.cancel_requested_by !== me && <PopupAction label="Decide" title={`Cancel ${s.sale_number}?`} wide>{(close) => <DecideCancelForm sale={s} onDone={(m) => { setMessage(m); close(); }} />}</PopupAction>}
              </div>}
            </div>
          ))}
        </section>
      )}
    </div>
    </StoreAccountsContext.Provider>
  );
}
