'use client';
// Build 136 — search and Category / Item / Brand filters for the public shop (a GET form; a choice applies at once).
import { useRef } from 'react';

export function ShopFilters({ action, q, category, item, brand, options }: {
  action: string; q: string; category: string; item: string; brand: string; options: { categories: string[]; items: string[]; brands: string[] };
}) {
  const form = useRef<HTMLFormElement>(null);
  const go = () => form.current?.requestSubmit();
  const sel = (name: string, label: string, all: string, value: string, list: string[]) => (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value} onChange={go} className="w-full rounded-lg border bg-white px-2 py-2 text-sm">
        <option value="">{all}</option>
        {list.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </label>
  );
  return (
    <form ref={form} action={action} className="space-y-2">
      <div className="flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">Search</span>
          <input name="q" type="search" defaultValue={q} placeholder="Search parts, brands, models…" className="w-full rounded-lg border bg-white px-3 py-2.5 text-sm" /></label>
        <button className="rounded-lg bg-[rgb(var(--btn))] px-4 text-sm font-bold text-[rgb(var(--on-btn))]">Search</button>
      </div>
      <div className="flex gap-2">
        {sel('category', 'Category', 'All categories', category, options.categories)}
        {sel('item', 'Item', 'All items', item, options.items)}
        {sel('brand', 'Brand', 'All brands', brand, options.brands)}
      </div>
    </form>
  );
}
