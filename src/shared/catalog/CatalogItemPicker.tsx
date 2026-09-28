'use client';
import { errorText } from '@/core/errors/appError';

// U060 — typeahead picker over the shared catalog (server-side search, see
// catalogSearch.ts). Drop-in for the old <select> pickers:
//   - `name` renders a hidden input so plain <form action> submissions still
//     post the chosen id;
//   - `onSelect` hands back the full item (or null for "custom item"), so
//     line editors can fill description/unit/cost as before.

import { useEffect, useRef, useState } from 'react';
import { searchCatalogItemsAction, getCatalogItemsByIdAction, type CatalogSearchItem } from './catalogSearch';

const labelCache = new Map<string, CatalogSearchItem>();

export function CatalogItemPicker({
  value,
  onSelect,
  name,
  required,
  allowCustom,
  customLabel = 'Custom item',
  placeholder = 'Search catalog by code, name or category…',
  className = '',
}: {
  value?: string | null;
  onSelect?: (item: CatalogSearchItem | null) => void;
  name?: string;
  required?: boolean;
  allowCustom?: boolean;
  customLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string>(value ?? '');
  const [selected, setSelected] = useState<CatalogSearchItem | null>(value ? labelCache.get(value) ?? null : null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CatalogSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Controlled usage: follow external value changes.
  useEffect(() => {
    const v = value ?? '';
    setSelectedId(v);
    if (!v) { setSelected(null); return; }
    const cached = labelCache.get(v);
    if (cached) { setSelected(cached); return; }
    getCatalogItemsByIdAction([v]).then((rows) => { rows.forEach((r) => labelCache.set(r.id, r)); setSelected(rows[0] ?? null); }).catch(() => {});
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      searchCatalogItemsAction(query)
        .then((rows) => { if (mine !== seq.current) return; rows.forEach((r) => labelCache.set(r.id, r)); setResults(rows); setError(''); })
        .catch((e) => { if (mine === seq.current) setError(errorText(e) || 'Search failed'); })
        .finally(() => { if (mine === seq.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (item: CatalogSearchItem | null) => {
    setSelectedId(item?.id ?? '');
    setSelected(item);
    setOpen(false);
    setQuery('');
    onSelect?.(item);
  };

  const label = selected ? `${selected.item_code} — ${selected.item_name}` : selectedId ? 'Loading…' : allowCustom ? customLabel : '';

  return (
    <div ref={box} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={selectedId} />}
      <input
        className="input w-full"
        value={open ? query : label}
        placeholder={open ? placeholder : allowCustom ? customLabel : placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => setQuery(e.target.value)}
        required={required && !selectedId}
        aria-label="Catalog item"
      />
      {open && (
        <div className="absolute z-40 mt-1 max-h-72 w-full min-w-[18rem] overflow-y-auto rounded-lg border bg-white shadow-lg">
          {allowCustom && <button type="button" className="block w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>{customLabel}</button>}
          {loading && <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>}
          {error && <div className="px-3 py-2 text-sm text-red-600">{error}</div>}
          {!loading && !error && results.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No matching catalog items.</div>}
          {results.map((r) => (
            <button key={r.id} type="button" className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${r.id === selectedId ? 'bg-slate-100' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
              <span className="font-medium">{r.item_code}</span> — {r.item_name}
              <span className="block text-xs text-slate-500">{[r.category, r.unit, r.item_type === 'service' ? 'Service' : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {results.length >= 25 && <div className="px-3 py-2 text-xs text-slate-400">Showing the first 25 matches — keep typing to narrow.</div>}
        </div>
      )}
    </div>
  );
}
