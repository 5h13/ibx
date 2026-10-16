'use client';
// Build 122 — one of the owner's marketing tools (public/marketing-tools), shown inside the app's frame.
// Build 123: the tool always gets a desktop-sized page (minWidth × minHeight) and is scaled to fit the space
// below the app header, so it keeps its side-by-side desktop layout instead of its stacked phone layout (Banner
// Studio stacked below 981 px), and the Specs Card has the height for the full card. Exports keep full size
// (they are drawn from the tool's own canvas, not the screen). "Open in a new tab" gives the tool the whole window.
import { useEffect, useRef, useState } from 'react';

export function MarketingToolFrame({ title, src, note, minWidth, minHeight }: { title: string; src: string; note?: string; minWidth: number; minHeight: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = size ? Math.min(1, size.w / minWidth, size.h / minHeight) : 1;
  return (
    <div className="flex flex-col gap-1.5" style={{ height: 'calc(100dvh - 6.25rem)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0"><span className="font-semibold">{title}</span>{note && <span className="ml-2 text-xs text-slate-500">{note}</span>}</div>
        <a href={src} target="_blank" rel="noopener" className="text-sm underline">Open in a new tab ↗</a>
      </div>
      <div ref={box} className="relative min-h-[20rem] flex-1 overflow-hidden rounded-lg border bg-white">
        {size && (
          <iframe title={title} src={src} className="absolute left-0 top-0 border-0"
            style={{ width: size.w / s, height: size.h / s, transform: `scale(${s})`, transformOrigin: '0 0' }} />
        )}
      </div>
    </div>
  );
}
