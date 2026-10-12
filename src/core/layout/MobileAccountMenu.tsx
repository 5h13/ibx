'use client';
// Build 108 — phone header: the user's initials as a button. It opens a panel with the name and role, the store
// switch / role audit (Super Admin, Business Admin), Agent app, My profile and Logout — everything the computer
// header shows in one row, which does not fit across a phone.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export function MobileAccountMenu({ name, role, children }: { name: string; role: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      // the role-audit drop-down renders inside the panel; selects open native pickers — keep the panel for both
      if (box.current && !box.current.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="My account"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/40 bg-white/10 text-sm font-bold text-white"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border bg-white p-4 text-left text-sm text-slate-800 shadow-xl">
          <div className="font-semibold">{name}</div>
          <div className="mb-3 text-xs text-slate-500">{role}</div>
          <div className="space-y-3">{children}</div>
        </div>
      )}
    </div>
  );
}
