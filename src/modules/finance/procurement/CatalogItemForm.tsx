'use client';
import { errorText } from '@/core/errors/appError';

// Build 60 — add / edit a catalog item in the user's column layout. Add on,
// Acquisition Cost and STORE PRICE are calculated live from the category
// add-on % and the %Mark up of the user's business.

import { useMemo, useRef, useState, useTransition } from 'react';
import { createCatalogItemAction, updateCatalogItemAction } from './catalogItemActions';

const peso = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `₱${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const r2 = (n: number) => Math.round(n * 100) / 100;

function L({ l, children, hint }: { l: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{l}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function CatalogItemForm({
  item, categories, units, suppliers, categoryAddons, canSetPricing, onDone,
}: {
  item?: any;
  categories: { name: string }[];
  units: { name: string }[];
  suppliers: any[];
  categoryAddons: Record<string, number>;
  canSetPricing: boolean;
  onDone?: (msg: string) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [category, setCategory] = useState<string>(item?.category ?? '');
  const [itemType, setItemType] = useState<string>(item?.item_type ?? 'product');
  const [cost, setCost] = useState<string>(item ? String(item.supplier_cost ?? (item.item_type === 'service' ? item.service_cost_basis : item.standard_cost) ?? 0) : '0');
  const [markup, setMarkup] = useState<string>(item?.markup_percent == null ? '' : String(Number(item.markup_percent)));
  const [preview, setPreview] = useState<string | null>(item?.photo_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [storeEdit, setStoreEdit] = useState<string | null>(null);

  const calc = useMemo(() => {
    const c = Number(cost) || 0;
    const addonPct = categoryAddons[category.toLowerCase().trim()] ?? 0;
    const addon = r2(c * addonPct / 100);
    const acquisition = r2(c + addon);
    const m = markup === '' ? 0 : Number(markup) || 0;
    return { addonPct, addon, acquisition, store: r2(acquisition * (1 + m / 100)) };
  }, [cost, category, markup, categoryAddons]);

  const activeSuppliers = suppliers.filter((s) => s.active || s.id === item?.default_supplier_id);

  function submit(fd: FormData) {
    setError('');
    if (removePhoto) fd.set('remove_photo', 'true');
    start(async () => {
      try {
        if (item) {
          fd.set('item_id', item.id);
          await updateCatalogItemAction(fd);
          onDone?.(`Saved ${item.item_code}.`);
        } else {
          const r = await createCatalogItemAction(fd);
          form.current?.reset(); setCategory(''); setCost('0'); setMarkup(''); setPreview(null); setItemType('product');
          onDone?.(`Created catalog item ${r.item_code}.`);
        }
      } catch (e: any) {
        setError(errorText(e) || 'Unable to save the catalog item.');
      }
    });
  }

  return (
    <form ref={form} action={submit} className="space-y-4">
      {!item && <p className="text-sm text-slate-500">Item code is assigned by the system and cannot be edited.</p>}
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><L l="STANDARD ITEM NAME" hint="Full name, e.g. AC FILTER DRIER, GENESSO 1/2 FLARE TYPE 164FT"><input className="input" name="item_name" required defaultValue={item?.item_name ?? ''} /></L></div>
        <L l="CATEGORY">
          <select className="input" name="category" required value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </L>
        <L l="ITEM" hint="Generic item, e.g. AC FILTER DRIER"><input className="input" name="generic_item" defaultValue={item?.generic_item ?? ''} /></L>
        <L l="BRAND"><input className="input" name="brand" defaultValue={item?.brand ?? ''} /></L>
        <div className="md:col-span-3"><L l="DESCRIPTION"><input className="input" name="description" defaultValue={item?.description ?? ''} /></L></div>
        <div className="md:col-span-4 flex flex-wrap items-end gap-4">
          <L l="Product Photo" hint="JPG, PNG or WebP, up to 5 MB">
            <input className="text-sm" type="file" name="photo" accept="image/jpeg,image/png,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; setRemovePhoto(false); setPreview(f ? URL.createObjectURL(f) : item?.photo_url ?? null); }} />
          </L>
          {preview && !removePhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Product photo" className="h-20 w-20 rounded border object-cover" />
          )}
          {item?.photo_path && (
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={removePhoto} onChange={(e) => setRemovePhoto(e.target.checked)} /> Remove photo</label>
          )}
        </div>
        <div className="md:col-span-2">
          <L l="SUPPLIER">
            <select className="input" name="default_supplier_id" defaultValue={item?.default_supplier_id ?? ''}>
              <option value="">None</option>
              {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>)}
            </select>
          </L>
        </div>
        <L l="SUPPLIER ITEM CODE" hint="The supplier's own code for this item"><input className="input" name="supplier_item_code" defaultValue={item?.supplier_item_code ?? ''} /></L>
        <L l={itemType === 'service' ? 'Supplier Cost (service cost basis)' : 'Supplier Cost'}>
          <input className="input" name="supplier_cost" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
        </L>
      </div>

      <div className="grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
        <L l="Add on" hint={canSetPricing ? `Category add-on ${calc.addonPct}% (set under Pricing rules)` : 'Select a business in "Acting as" to see pricing'}><div className="py-2 font-medium">{canSetPricing ? peso(calc.addon) : '—'}</div></L>
        <L l="Acquisition Cost" hint="Supplier Cost + Add on"><div className="py-2 font-medium">{canSetPricing && itemType !== 'service' ? peso(calc.acquisition) : '—'}</div></L>
        <L l="STORE PRICE" hint="Type a price to set the markup from it, or enter %Mark up">
          {canSetPricing ? (
            <input className="input font-semibold" type="number" step="0.01" min="0" value={storeEdit ?? String(calc.store)}
              onChange={(e) => {
                setStoreEdit(e.target.value);
                const v = Number(e.target.value), base = itemType === 'service' ? (Number(cost) || 0) * (1 + calc.addonPct / 100) : calc.acquisition;
                if (Number.isFinite(v) && base > 0 && v >= base) setMarkup(String(Math.round((v / base - 1) * 100 * 1e8) / 1e8));
              }}
              onBlur={() => setStoreEdit(null)} />
          ) : <div className="py-2">—</div>}
        </L>
        <L l="%Mark up" hint={canSetPricing ? 'For this business' : 'Markups are set per business'}>
          <input className="input" name="markup_percent" type="number" step="0.01" min="0" max="1000" value={markup} disabled={!canSetPricing} onChange={(e) => { setStoreEdit(null); setMarkup(e.target.value); }} placeholder="e.g. 30" />
        </L>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <L l="Unit">
          <select className="input" name="unit" required defaultValue={item?.unit ?? (units.find((u) => u.name.toLowerCase() === 'unit')?.name ?? units[0]?.name ?? '')}>
            {units.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
          </select>
        </L>
        <L l="Type">
          <select className="input" name="item_type" value={itemType} onChange={(e) => setItemType(e.target.value)}>
            <option value="product">Product</option><option value="service">Service</option>
          </select>
        </L>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <button disabled={pending} className="button">{pending ? 'Saving…' : item ? 'Save changes' : 'Save catalog item'}</button>
    </form>
  );
}
