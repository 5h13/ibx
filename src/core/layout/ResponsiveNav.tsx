'use client';

// U035 — Mobile-First IBX.
//
// Before this fix, `<Sidebar>` was `w-56` (224px) and always rendered in a
// plain `flex` row next to `<main>` with no breakpoint handling at all — on
// a phone-width viewport the sidebar permanently ate roughly 60% of the
// screen, leaving no usable space for the page content and no way to hide
// it. This wraps Sidebar in a collapsible off-canvas drawer below the `md`
// breakpoint, and renders it exactly as before (static, always visible) at
// `md` and above — desktop behavior is unchanged.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { SessionProfile } from '@/core/auth/types';
import { Sidebar } from './Sidebar';

export function ResponsiveNav({ profile }: { profile: SessionProfile }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever navigation happens, so it never stays open
  // covering the page the user just tapped through to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        className="fixed left-3 top-3 z-50 rounded bg-slate-900 p-2 text-white shadow-md md:hidden"
      >
        <span aria-hidden="true" className="block text-lg leading-none">{open ? '✕' : '☰'}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        // Own scroll container: on mobile the drawer is viewport-high; on md+
        // it fills the shell's content row (AuthedShell). overscroll-contain
        // stops reaching the end of the menu from scrolling the page behind it.
        className={`fixed inset-y-0 left-0 z-40 overflow-y-auto overscroll-contain bg-slate-800 transform transition-transform duration-200 md:static md:z-auto md:h-full md:shrink-0 md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar profile={profile} />
      </div>
    </>
  );
}
