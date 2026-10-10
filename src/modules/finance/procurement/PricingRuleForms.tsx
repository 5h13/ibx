'use client';
// Build 90a — "Item markup" and "Customer discount" in Pricing rules: enter the
// percentage OR the price it should give; each rewrites the other, and the
// percentage keeps as many decimals as needed so the price lands exactly.
import { useEffect, useState } from 'react';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';
import { CatalogItemPicker } from '@/shared/catalog/CatalogItemPicker';
import { itemPricingInfoAction, upsertCatalogCustomerDiscountAction, upsertCatalogItemPricingAction } from './actions';

type Info = Awaited<ReturnType<typeof itemPricingInfoAction>>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const m8 = (n: number) => String(Math.round(n * 1e8) / 1e8);
const peso = (v: number) => `₱${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ItemMarkupForm({ run }: { run: (fn: () => Promise<unknown>) => void }) {
  const [itemId, setItemId] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [markup, setMarkup] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    setInfo(null); setErr('');
    if (!itemId) return;
    itemPricingInfoAction(itemId).then((i) => {
      setInfo(i);
      const m = i.markup_percent ?? (i.acquisition_cost > 0 ? (i.store_price / i.acquisition_cost - 1) * 100 : 0);
      setMarkup(m8(m)); setPrice(r2(i.acquisition_cost * (1 + m / 100)).toFixed(2));
    }).catch((e) => setErr(errorText(e)));
  }, [itemId]);
  const acq = info?.acquisition_cost ?? 0;
  const typeMarkup = (v: string) => { setMarkup(v); const n = Number(v); if (v.trim() !== '' && Number.isFinite(n) && acq > 0) setPrice(r2(acq * (1 + n / 100)).toFixed(2)); };
  const typePrice = (v: string) => { setPrice(v); const n = Number(v); if (v.trim() !== '' && Number.isFinite(n) && acq > 0) setMarkup(m8((n / acq - 1) * 100)); };
  return (
    <Form action={(fd) => run(async () => { fd.set('markup_percent', markup); await upsertCatalogItemPricingAction(fd); })} className="space-y-2">
      <CatalogItemPicker name="item_id" required onSelect={(it) => setItemId(it?.id ?? '')} />
      {info && <div className="text-xs text-slate-500">Acquisition cost {peso(acq)} · store price now {peso(info.store_price)}</div>}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-slate-600">Markup %<input className="input mt-0.5" type="number" min="0" max="1000" step="any" value={markup} onChange={(e) => typeMarkup(e.target.value)} placeholder="Markup %" required /></label>
        <label className="block text-xs text-slate-600">or store price<input className="input mt-0.5" type="number" min="0" step="0.01" value={price} onChange={(e) => typePrice(e.target.value)} disabled={!acq} placeholder="₱" /></label>
      </div>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button className="button">Save item markup</button>
    </Form>
  );
}

export function CustomerDiscountForm({ run, customers }: { run: (fn: () => Promise<unknown>) => void; customers: { id: string; customer_code: string; legal_name: string }[] }) {
  const [customerId, setCustomerId] = useState('');
  const [itemId, setItemId] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [disc, setDisc] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    setInfo(null); setErr('');
    if (!itemId) return;
    itemPricingInfoAction(itemId, customerId || null).then((i) => {
      setInfo(i);
      const d = i.discount_percent ?? 0;
      setDisc(m8(d)); setPrice(r2(i.store_price * (1 - d / 100)).toFixed(2));
    }).catch((e) => setErr(errorText(e)));
  }, [itemId, customerId]);
  const srp = info?.store_price ?? 0;
  const typeDisc = (v: string) => { setDisc(v); const n = Number(v); if (v.trim() !== '' && Number.isFinite(n) && srp > 0) setPrice(r2(srp * (1 - n / 100)).toFixed(2)); };
  const typePrice = (v: string) => { setPrice(v); const n = Number(v); if (v.trim() !== '' && Number.isFinite(n) && srp > 0) setDisc(m8((1 - n / srp) * 100)); };
  return (
    <Form action={(fd) => run(async () => { fd.set('discount_percent', disc); await upsertCatalogCustomerDiscountAction(fd); })} className="space-y-2">
      <select className="input" name="customer_id" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="" disabled>{customers.length ? 'Select customer' : 'No customers in this business yet'}</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.customer_code} — {c.legal_name}</option>)}
      </select>
      <CatalogItemPicker name="item_id" onSelect={(it) => setItemId(it?.id ?? '')} />
      {info && <div className="text-xs text-slate-500">Store price {peso(srp)}{info.discount_percent != null ? ` · this customer now ${m8(info.discount_percent)}%` : ''}</div>}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-slate-600">Discount %<input className="input mt-0.5" type="number" min="0" max="100" step="any" value={disc} onChange={(e) => typeDisc(e.target.value)} placeholder="Discount %" required /></label>
        <label className="block text-xs text-slate-600">or customer price<input className="input mt-0.5" type="number" min="0" step="0.01" value={price} onChange={(e) => typePrice(e.target.value)} disabled={!srp} placeholder="₱" /></label>
      </div>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button className="button">Save discount</button>
    </Form>
  );
}
