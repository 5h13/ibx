'use client';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';

// U060 — typeahead picker over the shared catalog (server-side search, see
// catalogSearch.ts). Drop-in for the old <select> pickers:
//   - `name` renders a hidden input so plain <Form action> submissions still
//     post the chosen id;
//   - `onSelect` hands back the full item (or null for "custom item"), so
//     line editors can fill description/unit/cost as before.
// SF-05: CATEGORY / ITEM / BRAND filters (the catalog page's filter values,
// Build 61) sit at the top of the drop-down and narrow the results before an
// item is picked. Props and onSelect are unchanged; `showFilters={false}`
// hides them.

import { useEffect, useRef, useState } from 'react';
import { searchCatalogItemsAction, getCatalogItemsByIdAction, getCatalogFilterOptionsAction, type CatalogSearchItem } from './catalogSearch';

const labelCache = new Map<string, CatalogSearchItem>();
type FilterOptions = { categories: string[]; items: string[]; brands: string[] };
let filterOptionsPromise: Promise<FilterOptions> | null = null;
/** Loaded once per page and shared by every picker on it. */
function loadFilterOptions() {
  if (!filterOptionsPromise) filterOptionsPromise = getCatalogFilterOptionsAction().catch((e) => { filterOptionsPromise = null; throw e; });
  return filterOptionsPromise;
}
const NO_FILTERS = { category: '', item: '', brand: '' };

export function CatalogItemPicker({
  value,
  onSelect,
  name,
  required,
  allowCustom,
  customLabel = 'Custom item',
  placeholder = 'Search catalog by code, name or category…',
  className = '',
  showFilters = true,
}: {
  value?: string | null;
  onSelect?: (item: CatalogSearchItem | null) => void;
  name?: string;
  required?: boolean;
  allowCustom?: boolean;
  customLabel?: string;
  placeholder?: string;
  className?: string;
  /** SF-05: show the CATEGORY / ITEM / BRAND filters in the drop-down (default true). */
  showFilters?: boolean;
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
  const [filters, setFilters] = useState(NO_FILTERS);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const filtered = Boolean(filters.category || filters.item || filters.brand);

  useEffect(() => {
    if (!open || !showFilters || options) return;
    let alive = true;
    loadFilterOptions().then((o) => { if (alive) setOptions(o); }).catch(() => { if (alive) setOptions({ categories: [], items: [], brands: [] }); });
    return () => { alive = false; };
  }, [open, showFilters, options]);

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
      searchCatalogItemsAction(query, filters)
        .then((rows) => { if (mine !== seq.current) return; rows.forEach((r) => labelCache.set(r.id, r)); setResults(rows); setError(''); })
        .catch((e) => { if (mine === seq.current) setError(errorText(e) || 'Search failed'); })
        .finally(() => { if (mine === seq.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [query, open, filters]);

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
        <div className="absolute z-40 mt-1 max-h-80 w-full min-w-[18rem] overflow-y-auto rounded-lg border bg-white shadow-lg">
          {showFilters && (
            <div className="sticky top-0 z-10 border-b bg-slate-50 px-2 py-1.5">
              <div className="grid grid-cols-3 gap-1">
                <FilterSelect label="Category" value={filters.category} values={options?.categories} onChange={(v) => setFilters((f) => ({ ...f, category: v }))} />
                <FilterSelect label="Item" value={filters.item} values={options?.items} onChange={(v) => setFilters((f) => ({ ...f, item: v }))} />
                <FilterSelect label="Brand" value={filters.brand} values={options?.brands} onChange={(v) => setFilters((f) => ({ ...f, brand: v }))} />
              </div>
              {filtered && <button type="button" className="mt-1 text-xs text-blue-700 underline" onMouseDown={(e) => e.preventDefault()} onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
            </div>
          )}
          {allowCustom && <button type="button" className="block w-full px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>{customLabel}</button>}
          {loading && <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>}
          {error && <div className="px-3 py-2 text-sm text-red-600">{error}</div>}
          {!loading && !error && results.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No matching catalog items.</div>}
          {results.map((r) => (
            <button key={r.id} type="button" className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${r.id === selectedId ? 'bg-slate-100' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
              <span className="font-medium">{r.item_code}</span> — {r.item_name}
              <span className="block text-xs text-slate-500">{[r.category, r.generic_item, r.brand, r.unit, r.item_type === 'service' ? 'Service' : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {results.length >= 25 && <div className="px-3 py-2 text-xs text-slate-400">Showing the first 25 matches — keep typing{showFilters ? ' or use the filters' : ''} to narrow.</div>}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, values, onChange }: { label: string; value: string; values?: string[]; onChange: (v: string) => void }) {
  const list = values ?? [];
  return (
    <select
      aria-label={`Filter by ${label.toLowerCase()}`}
      className={`w-full min-w-0 truncate rounded border bg-white px-1 py-0.5 text-xs ${value ? 'border-blue-400 text-slate-900' : 'text-slate-500'}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={!values}
    >
      <option value="">{values ? `All ${label === 'Category' ? 'categories' : `${label.toLowerCase()}s`}` : 'Loading…'}</option>
      {value && !list.includes(value) && <option value={value}>{value}</option>}
      {list.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}
