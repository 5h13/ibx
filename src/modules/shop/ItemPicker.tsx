'use client';
// Build 137 — pick a catalog item that has a photo (featured product, promo product).
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { searchShopItemsAction } from './settingsActions';

export type Picked = { item_id: string; item_name: string } | null;

export function ItemPicker({ value, onPick, label }: { value: Picked; onPick: (v: Picked) => void; label: string }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<{ item_id: string; item_name: string; category: string | null; brand: string | null }[]>([]);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const search = () => start(async () => {
    setErr('');
    try { setRows(await searchShopItemsAction(q)); } catch (e) { setErr(errorText(e)); }
  });
  return (
    <div className="space-y-2">
      <div className="text-sm"><span className="font-medium">{label}: </span>{value ? <b>{value.item_name}</b> : <span className="text-slate-500">none</span>}
        {value && <button type="button" className="ml-2 text-xs underline" onClick={() => onPick(null)}>Remove</button>}</div>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} placeholder="Search items with photos…" aria-label={`Search for the ${label.toLowerCase()}`} />
        <button type="button" onClick={search} disabled={pending} className="rounded border px-3 text-sm">{pending ? '…' : 'Search'}</button>
      </div>
      {err && <p className="text-xs text-red-700">{err}</p>}
      {rows.length > 0 && (
        <ul className="max-h-56 divide-y overflow-auto rounded border bg-white">
          {rows.map((r) => (
            <li key={r.item_id}><button type="button" onClick={() => { onPick({ item_id: r.item_id, item_name: r.item_name }); setRows([]); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span className="font-medium">{r.item_name}</span> <span className="text-xs text-slate-500">{[r.category, r.brand].filter(Boolean).join(' · ')}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
