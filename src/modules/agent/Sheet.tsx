'use client';
// Build 95 — agent app pop-up: full screen on a phone, a centred panel on a
// computer. Title and the action buttons sit at the top; the content scrolls below.
import { useEffect, type ReactNode } from 'react';

export function Sheet({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 md:items-center md:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex h-full w-full flex-col bg-white text-slate-800 md:h-auto md:max-h-[90vh] md:max-w-2xl md:rounded-xl md:shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex-none space-y-3 border-b px-4 pb-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <div className="flex items-start gap-3">
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug">{title}</h2>
            <button type="button" className="-mr-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-100 text-lg leading-none" onClick={onClose} aria-label="Close">×</button>
          </div>
          {actions}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>{children}</div>
      </div>
    </div>
  );
}
