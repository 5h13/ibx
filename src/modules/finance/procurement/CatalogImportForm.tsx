'use client';
// CAT-33 / SF-06 — catalog CSV import form: file + the businesses the file's
// prices (category add-ons / item markups) are applied to. Default = the
// current business; only the Super Admin sees other businesses (the database
// function catalog_import_pricing enforces the same rule).

import { useEffect, useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { getCatalogImportTargetsAction, importCatalogCsvAction } from './catalogItemActions';

type Target = { id: string; code: string; name: string };

export function CatalogImportForm({ pending, run, onDone }: { pending: boolean; run: (fn: () => Promise<any>) => void; onDone: () => void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [canChooseOthers, setCanChooseOthers] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let alive = true;
    getCatalogImportTargetsAction()
      .then((r) => { if (!alive) return; setTargets(r.businesses); setPicked(r.defaultIds); setCanChooseOthers(r.canChooseOthers); })
      .catch((e) => { if (alive) setLoadError(errorText(e) || 'Unable to load businesses.'); });
    return () => { alive = false; };
  }, []);

  const toggle = (id: string, on: boolean) => setPicked((xs) => (on ? [...new Set([...xs, id])] : xs.filter((x) => x !== id)));
  const all = targets ?? [];

  return (
    <form action={(fd) => run(async () => { const r = await importCatalogCsvAction(fd); onDone(); return r.message; })} className="space-y-3">
      <input className="text-sm" type="file" name="catalog_file" accept=".csv,text/csv" required />
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
      <button disabled={pending || !targets} className="button-secondary">Import CSV</button>
    </form>
  );
}
