'use client';
// Build 76 — product photos on the detail page: a large view and thumbnails.
import { useState } from 'react';

export function ProductGallery({ photos, name }: { photos: string[]; name: string }) {
  const [i, setI] = useState(0);
  if (!photos.length) return <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-slate-50 text-sm text-slate-400">No photo yet</div>;
  return (
    <div className="space-y-2">
      <a href={photos[i]} target="_blank" rel="noreferrer" title="Open full size" className="block overflow-hidden rounded-lg border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[i]} alt={`${name} — photo ${i + 1}`} className="aspect-square w-full object-contain" />
      </a>
      {photos.length > 1 && (
        <div className="flex gap-2">
          {photos.map((p, k) => (
            <button key={k} type="button" onClick={() => setI(k)} aria-label={`Photo ${k + 1}`}
              className={`h-16 w-16 overflow-hidden rounded border bg-white ${k === i ? 'ring-2 ring-slate-800' : 'opacity-80 hover:opacity-100'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
