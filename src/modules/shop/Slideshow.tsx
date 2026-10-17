'use client';
// Build 137 — the shop's product slideshow: cycles the products of the chosen Category / Item / Brand.
// 'single' (layout A): one big product with arrows and dots; 'progress' (layout C): one big product with a
// progress bar; 'strip' (layout B): a row of cards that slides on its own and can be swiped.
// Stops moving while touched / hovered, and for visitors who ask for less motion.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvailBadge, ProductCard, type CardData } from './ProductCard';

type Props = { slug: string; title: string; seeAllHref: string; items: CardData[]; variant: 'single' | 'progress' | 'strip'; interval?: number };
const priceText = (n: number | null) => (n == null ? null : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function Slideshow({ slug, title, seeAllHref, items, variant, interval = 4500 }: Props) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const n = items.length;
  useEffect(() => { try { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { /* */ } }, []);
  const go = useCallback((to: number) => setI(((to % n) + n) % n), [n]);
  useEffect(() => {
    if (paused || reduced || n < 2) return;
    const t = setTimeout(() => go(i + 1), interval);
    return () => clearTimeout(t);
  }, [i, paused, reduced, n, interval, go]);
  useEffect(() => {
    if (variant !== 'strip' || !strip.current) return;
    const el = strip.current.children[i] as HTMLElement | undefined;
    if (el) strip.current.scrollTo({ left: el.offsetLeft - 16, behavior: reduced ? 'auto' : 'smooth' });
  }, [i, variant, reduced]);
  if (!n) return null;
  const cur = items[i];
  const hold = { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false), onTouchStart: () => setPaused(true), onTouchEnd: () => setTimeout(() => setPaused(false), 4000) };

  if (variant === 'strip') {
    return (
      <section aria-label={title} className="space-y-2.5" {...hold}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-extrabold text-slate-900">{title}</h2>
          <Link href={seeAllHref} className="text-sm font-semibold text-[rgb(var(--btn))] underline">See all</Link>
        </div>
        <div ref={strip} className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1" onScroll={(e) => {
          const el = e.currentTarget; const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
          const at = Math.round(el.scrollLeft / (w + 10)); if (at !== i && paused) setI(Math.min(n - 1, Math.max(0, at)));
        }}>
          {items.map((r) => <div key={r.item_id} className="w-40 flex-none snap-start"><ProductCard slug={slug} r={r} tone="soft" /></div>)}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={title} aria-roledescription="carousel" className={`space-y-2.5 ${variant === 'progress' ? 'overflow-hidden rounded-2xl bg-white shadow-sm' : ''}`} {...hold}>
      {variant === 'progress' && <div className="h-1 bg-slate-200"><div className="h-1 bg-[rgb(var(--btn))] transition-all" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>}
      <div className={`flex items-baseline justify-between gap-2 ${variant === 'progress' ? 'px-3.5' : ''}`}>
        <h2 className="text-lg font-extrabold text-slate-900">{title}</h2>
        {variant === 'progress' ? <span className="text-xs text-slate-500">{i + 1} of {n}</span> : <Link href={seeAllHref} className="text-sm font-semibold text-[rgb(var(--btn))] underline">See all</Link>}
      </div>
      <div className={variant === 'progress' ? 'px-3.5 pb-3.5' : ''}>
        <div className={`overflow-hidden rounded-2xl ${variant === 'single' ? 'bg-white shadow-sm' : ''}`}>
          <div className="relative h-60 bg-slate-100">
            <AvailBadge available={cur.available} className="absolute left-3 top-3 z-10" />
            <Link href={`/shop/${slug}/item/${cur.item_id}`} className="block h-full" aria-label={cur.item_name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cur.photo_url ? <img src={cur.photo_url} alt="" className="h-full w-full object-contain" /> : null}
            </Link>
            {n > 1 && <>
              <button type="button" aria-label="Previous product" onClick={() => go(i - 1)} className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl shadow">‹</button>
              <button type="button" aria-label="Next product" onClick={() => go(i + 1)} className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl shadow">›</button>
            </>}
          </div>
          <Link href={`/shop/${slug}/item/${cur.item_id}`} className={`flex items-center gap-2.5 ${variant === 'single' ? 'px-3.5 py-3' : 'pt-2.5'}`}>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-900">{cur.item_name}</span>{cur.brand && <span className="block truncate text-xs text-slate-500">{cur.brand}</span>}</span>
            <span className="text-lg font-extrabold text-slate-900">{priceText(cur.price) ?? <span className="text-sm text-slate-500">Ask for price</span>}</span>
          </Link>
        </div>
      </div>
      {variant === 'single' && n > 1 && (
        n <= 12
          ? <div className="flex justify-center gap-1.5">{items.map((r, k) => <button key={r.item_id} type="button" aria-label={`Product ${k + 1} of ${n}`} aria-current={k === i} onClick={() => go(k)} className="flex h-6 items-center"><span className={`block h-1.5 rounded-full ${k === i ? 'w-5 bg-[rgb(var(--btn))]' : 'w-1.5 bg-slate-300'}`} /></button>)}</div>
          : <div className="text-center text-xs text-slate-500">{i + 1} of {n}</div>
      )}
    </section>
  );
}
