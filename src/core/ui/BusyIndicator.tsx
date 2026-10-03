'use client';
// Build 83b — loading indicator (owner: "after clicking a button it seems
// nothing is happening"). Every page change and every save goes through
// fetch (server actions, page data, Supabase), so fetch is wrapped once and
// the 5H13 logo is shown, spinning, whenever a request has been running for
// more than a moment. No change is needed on individual pages.
import { useEffect, useState } from 'react';

const SHOW_AFTER_MS = 250;

export function BusyIndicator() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const w = window as Window & { __ibxBusy?: boolean };
    if (w.__ibxBusy) return;
    w.__ibxBusy = true;
    let active = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (active > 0 && !timer) timer = setTimeout(() => { timer = null; if (active > 0) setBusy(true); }, SHOW_AFTER_MS);
      if (active === 0) { if (timer) { clearTimeout(timer); timer = null; } setBusy(false); }
    };
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      active += 1; update();
      try { return await original(...args); } finally { active = Math.max(0, active - 1); update(); }
    };
  }, []);

  if (!busy) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-full bg-white/95 px-4 py-2 shadow-lg ring-1 ring-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/5h13-logo.jpg" alt="" className="ibx-busy-logo h-8 w-8 rounded-lg object-cover" />
        <span className="text-sm font-medium text-slate-700">Working…</span>
      </div>
    </div>
  );
}
