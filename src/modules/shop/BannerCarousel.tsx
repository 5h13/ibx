'use client';
// Build 137 — layout C: the promotion and the announcements share one banner that changes every few seconds.
// Build 141: an announcement made in the Studio fills its slide with the picture.
import Link from 'next/link';
import { useEffect, useState } from 'react';

export type Slide = { key: string; kind: 'promo' | 'announcement'; title: string; body: string | null; note: string | null; href: string | null; photo_url?: string | null; image_url?: string | null };

export function BannerCarousel({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  useEffect(() => {
    let reduced = false; try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }
    if (paused || reduced || n < 2) return;
    const t = setTimeout(() => setI((i + 1) % n), 5000);
    return () => clearTimeout(t);
  }, [i, paused, n]);
  if (!n) return null;
  const s = slides[i];
  const promo = s.kind === 'promo';
  return (
    <section aria-label="Promotion and announcements" aria-roledescription="carousel" className="space-y-2" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {s.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.image_url} alt={s.title} className="block h-auto w-full rounded-2xl shadow-sm" data-testid="announcement-image" />
      ) : (
      <div className={`relative flex min-h-[150px] gap-3 overflow-hidden rounded-2xl p-4 ${promo ? 'bg-[rgb(var(--btn))] text-[rgb(var(--on-btn))]' : 'bg-white text-slate-900 shadow-sm'}`}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-bold ${promo ? 'bg-amber-300 text-amber-950' : 'bg-slate-100 text-slate-700'}`}>{promo ? 'PROMO' : 'ANNOUNCEMENT'}{s.note ? ` · ${s.note}` : ''}</span>
          <div className="text-2xl font-extrabold leading-tight">{s.title}</div>
          {s.body && <div className="whitespace-pre-line text-sm opacity-90">{s.body}</div>}
          {s.href && <Link href={s.href} className="mt-auto self-start text-sm font-bold underline">See the promo items ›</Link>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.photo_url && <img src={s.photo_url} alt="" className="h-28 w-28 flex-none self-center rounded-xl bg-white object-contain" />}
      </div>
      )}
      {n > 1 && <div className="flex justify-center gap-1.5">{slides.map((x, k) => <button key={x.key} type="button" aria-label={`Slide ${k + 1} of ${n}`} aria-current={k === i} onClick={() => setI(k)} className="flex h-6 items-center"><span className={`block h-1.5 rounded-full ${k === i ? 'w-5 bg-[rgb(var(--btn))]' : 'w-1.5 bg-slate-300'}`} /></button>)}</div>}
    </section>
  );
}
