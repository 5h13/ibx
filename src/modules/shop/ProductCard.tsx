// Build 137 — one product card (photo, Available / By order, name, brand, price), shared by every layout.
import Link from 'next/link';
import { pesoShop } from './format';

export type CardData = { item_id: string; item_name: string; brand: string | null; price: number | null; available?: boolean | null; photo_url?: string | null };

export function AvailBadge({ available, className = '' }: { available?: boolean | null; className?: string }) {
  if (available == null) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${available ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-900'} ${className}`}>{available ? 'Available' : 'By order'}</span>;
}

export function ProductCard({ slug, r, tone = 'white' }: { slug: string; r: CardData; tone?: 'white' | 'soft' }) {
  return (
    <Link href={`/shop/${slug}/item/${r.item_id}`} className={`flex h-full flex-col overflow-hidden rounded-2xl ${tone === 'white' ? 'bg-white shadow-sm' : 'bg-slate-100'}`}>
      <div className="relative aspect-square bg-slate-100">
        <AvailBadge available={r.available} className="absolute left-2 top-2 z-10" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {r.photo_url ? <img src={r.photo_url} alt={r.item_name} loading="lazy" className="h-full w-full object-contain" /> : null}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{r.item_name}</div>
        {r.brand && <div className="truncate text-[11px] text-slate-500">{r.brand}</div>}
        <div className="mt-auto pt-1 text-base font-extrabold text-slate-900">{pesoShop(r.price) ?? <span className="text-sm font-semibold text-slate-500">Ask for price</span>}</div>
      </div>
    </Link>
  );
}
