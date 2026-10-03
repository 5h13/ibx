'use client';
import { Form } from '@/core/ui/Form';
// CAT-07 (Build 77) — the file may be CSV or Excel (.xlsx). "Preview" reads
// and validates the whole file and shows what it would change (new items,
// updated items, Supplier Cost changes, price changes per business, opening
// stock lines, errors) without writing anything; the import runs only when
// the user confirms that preview.
// CAT-33 / SF-06 — catalog CSV import form: file + the businesses the file's
// prices (category add-ons / item markups) are applied to. Default = the
// current business; only the Super Admin sees other businesses (the database
// function catalog_import_pricing enforces the same rule).

import { useEffect, useRef, useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { getCatalogImportTargetsAction, importCatalogCsvAction, previewCatalogImportAction, type CatalogImportPreview } from './catalogItemActions';

type Target = { id: string; code: string; name: string };

export function CatalogImportForm({ pending, run, onDone }: { pending: boolean; run: (fn: () => Promise<any>) => void; onDone: () => void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [canChooseOthers, setCanChooseOthers] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [locations, setLocations] = useState<{ id: string; label: string }[]>([]);
  const [preview, setPreview] = useState<{ fd: FormData; result: CatalogImportPreview } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, startPreview] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const reset = () => { setPreview(null); setPreviewError(''); };

  useEffect(() => {
    let alive = true;
    getCatalogImportTargetsAction()
      .then((r) => { if (!alive) return; setTargets(r.businesses); setPicked(r.defaultIds); setCanChooseOthers(r.canChooseOthers); setLocations(r.locations ?? []); })
      .catch((e) => { if (alive) setLoadError(errorText(e) || 'Unable to load businesses.'); });
    return () => { alive = false; };
  }, []);

  const toggle = (id: string, on: boolean) => setPicked((xs) => (on ? [...new Set([...xs, id])] : xs.filter((x) => x !== id)));
  const all = targets ?? [];

  return (
    <Form ref={formRef} onChange={reset} action={(fd) => { setPreviewError(''); startPreview(async () => { try { setPreview({ fd, result: await previewCatalogImportAction(fd) }); } catch (e) { setPreview(null); setPreviewError(errorText(e) || 'Unable to read the file.'); } }); }} className="space-y-3">
      <input className="text-sm" type="file" name="catalog_file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      <p className="text-xs text-slate-500">CSV or Excel workbook (.xlsx — the first sheet is read).</p>
      <fieldset className="rounded border p-3">
        <legend className="px-1 text-xs font-medium text-slate-700">Apply the file&apos;s prices (Add on / STORE PRICE / %Mark up) to</legend>
        <input type="hidden" name="target_business_ids_sent" value="1" />
        {loadError && <div className="text-xs text-red-700">{loadError}</div>}
        {!targets && !loadError && <div className="text-xs text-slate-400">Loading businesses…</div>}
        {targets && all.length === 0 && <div className="text-xs text-amber-700">Select a business in &quot;Acting as&quot; to import prices — they are set per business. Items and Supplier Costs can still be imported.</div>}
        {all.length > 1 && (
          <div className="mb-1 flex gap-3 text-xs">
            <button type="button" className="text-blue-700 underline" onClick={() => setPicked(all.map((b) => b.id))}>All</button>
            <button type="button" className="text-blue-700 underline" onClick={() => setPicked([])}>None</button>
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {all.map((b) => (
            <label key={b.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="target_business_ids" value={b.id} checked={picked.includes(b.id)} onChange={(e) => toggle(b.id, e.target.checked)} />
              {b.name} <span className="text-xs text-slate-400">({b.code})</span>
            </label>
          ))}
        </div>
        {targets && !canChooseOthers && all.length > 0 && <p className="mt-1 text-xs text-slate-500">You can import prices for your own business only.</p>}
        {targets && all.length > 0 && picked.length === 0 && <p className="mt-1 text-xs text-amber-700">No business ticked: only items and Supplier Costs are imported (a file with STORE PRICE / %Mark up is refused).</p>}
      </fieldset>
      <fieldset className="rounded border p-3 text-sm">
        <legend className="px-1 text-xs font-medium text-slate-700">Full-catalog upload (Build 76)</legend>
        <p className="text-xs text-slate-500">Download the catalog first (Export CSV): it carries each item&apos;s <b>Item Code</b>. Rows with a code update that item, even if you renamed it; rows without a code become new items. The file overwrites names, category, item, brand, description, SPECIFICATION, supplier, Supplier Cost and prices. Photos are added per item in the app.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs">Opening stock location (for the OPENING STOCK column)
            <select className="input mt-1" name="opening_location_id" defaultValue={locations.length === 1 ? locations[0].id : ''}>
              <option value="">— none —</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select></label>
          <label className="block text-xs">Count date<input className="input mt-1" type="date" name="opening_date" /></label>
        </div>
        <p className="mt-1 text-xs text-slate-500">Add on is a percentage of the Supplier Cost per category (e.g. 5 for 5%). STOCK TYPE: Stock or Order only (blank keeps an existing item as it is; new items are Stock).</p>
        <p className="mt-1 text-xs text-slate-500">OPENING STOCK becomes an opening count for that location (unit cost from OPENING UNIT COST, else the Supplier Cost). It posts only after a Business Admin approves it in Finance → Opening Stock; the store&apos;s stock is then set to the counted quantities.</p>
        {canChooseOthers && <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" name="deactivate_missing" value="1" /> <span>Deactivate catalog items that are <b>not in this file</b> (they are kept with their history, just hidden). Use only with the full cleaned catalog.</span></label>}
      </fieldset>
      {previewError && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{previewError}</div>}
      {preview ? <ImportPreview p={preview.result} /> : null}
      <div className="flex flex-wrap gap-2">
        <button disabled={pending || previewing || !targets} className="button-secondary">{previewing ? 'Reading file…' : preview ? 'Preview again' : 'Preview import'}</button>
        {preview && (
          <button type="button" className="button" disabled={pending || previewing || preview.result.errors.length > 0}
            onClick={() => { const fd = preview.fd; run(async () => { const r = await importCatalogCsvAction(fd); setPreview(null); formRef.current?.reset(); onDone(); return r.message; }); }}>
            {pending ? 'Importing…' : 'Confirm import'}
          </button>
        )}
      </div>
      {pending && preview && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Importing — a full catalog can take a few minutes. Keep this window open; a message shows here and at the top of the page when it is done or if it fails.</div>}
      {preview && !pending && <p className="text-xs text-slate-500">Nothing has been saved yet. The file is checked again when you confirm; if anything changed meanwhile and a row fails, nothing is imported.</p>}
    </Form>
  );
}

function ImportPreview({ p }: { p: CatalogImportPreview }) {
  const tile = (label: string, value: string | number, tone = '') => (
    <div className={`rounded border bg-white p-2 ${tone}`}><div className="text-[11px] uppercase text-slate-500">{label}</div><div className="text-lg font-semibold">{typeof value === 'number' ? value.toLocaleString() : value}</div></div>
  );
  return (
    <div className="space-y-2 rounded border bg-slate-50 p-3 text-sm" aria-live="polite">
      <div className="font-medium">Preview of {p.file} — {p.rows.toLocaleString()} item row(s){p.identicalDuplicates ? `, ${p.identicalDuplicates} repeated row(s) counted once` : ''}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile('New items', p.newItems)}
        {tile('Updated items', p.updatedItems)}
        {tile('Cost changes', p.costChanges)}
        {tile('Price changes', p.priceChanges)}
        {tile('Opening stock lines', p.openingLines)}
        {tile('Errors', p.errors.length, p.errors.length ? 'border-red-300 text-red-700' : '')}
      </div>
      {p.costSamples.length > 0 && <div className="text-xs text-slate-600"><b>Supplier Cost changes:</b> {p.costSamples.join('; ')}{p.costChanges > p.costSamples.length ? ' …' : ''}</div>}
      {p.businesses.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-slate-600">
          {p.businesses.map((b) => (
            <li key={b.code}><b>{b.name}</b>: {b.priceChanges} existing item price(s) change, {b.newItemPrices} new item(s) priced{b.newAddons.length ? `; new category add-ons ${b.newAddons.join(', ')}` : ''}{b.addonExceptions ? `; ${b.addonExceptions} item(s) with an Add on different from their category` : ''}.</li>
          ))}
        </ul>
      )}
      {p.openingLines > 0 && <div className="text-xs text-slate-600">Opening stock: {p.openingLines} item(s), {p.openingQty.toLocaleString()} unit(s) — recorded as an opening count waiting for a Business Admin&apos;s approval.</div>}
      {p.deactivate != null && <div className="text-xs text-amber-700">{p.deactivate.toLocaleString()} active item(s) not in the file will be deactivated.</div>}
      {p.errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <div className="font-medium">Fix these and preview again — nothing can be imported while the file has errors:</div>
          <ul className="list-disc pl-5">{p.errors.slice(0, 25).map((e, i) => <li key={i}>{e}</li>)}</ul>
          {p.errors.length > 25 && <div>… and {p.errors.length - 25} more.</div>}
        </div>
      )}
    </div>
  );
}
