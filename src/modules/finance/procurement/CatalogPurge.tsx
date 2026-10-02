'use client';
// Build 79 (CAT-37): the Super Admin deletes deactivated catalog items that
// nothing uses. A list comes first; items with history stay deactivated and
// show why.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { purgeUnusedItemsAction } from './actions';

type Row = Awaited<ReturnType<typeof purgeUnusedItemsAction>>[number];
export function CatalogPurge() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const run = (apply: boolean) => start(async () => { setError(''); try { setRows(await purgeUnusedItemsAction(apply)); setDone(apply); } catch (e) { setError(errorText(e)); } });
  const willGo = (rows ?? []).filter((r) => r.reason === 'Will be deleted').length;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Deactivated items that were never used (no sales, quotes, orders, PR / PO, supplier quotes, purchase history or stock records) are deleted for good, with their price settings. Items with any history stay deactivated.</p>
      {!rows && <button type="button" className="button" disabled={pending} onClick={() => run(false)}>{pending ? 'Checking…' : 'Check deactivated items'}</button>}
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      {rows && <>
        <p className="font-medium">{done ? `${rows.filter((r) => r.deleted).length} deleted, ${rows.filter((r) => !r.deleted).length} kept.` : rows.length === 0 ? 'No deactivated items.' : `${willGo} can be deleted, ${rows.length - willGo} must stay.`}</p>
        <div className="max-h-80 overflow-auto rounded border"><table className="w-full text-xs"><tbody>{rows.map((r) => (
          <tr key={r.item_id} className="border-b"><td className="p-1 whitespace-nowrap">{r.item_code}</td><td className="p-1">{r.item_name}</td><td className={`p-1 ${r.deleted || r.reason === 'Will be deleted' ? 'text-red-700' : 'text-slate-500'}`}>{r.reason}</td></tr>))}</tbody></table></div>
        {!done && willGo > 0 && <button type="button" className="button" disabled={pending} onClick={() => run(true)}>{pending ? 'Deleting…' : `Delete ${willGo} unused item(s) permanently`}</button>}
      </>}
    </div>
  );
}
