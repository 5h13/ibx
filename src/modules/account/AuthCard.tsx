// Build 72 — the 5H13 card used by the sign-in and password pages.
import type { ReactNode } from 'react';
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white shadow-md rounded-lg p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/5h13-logo.jpg" alt="5H13" className="h-12 w-12 rounded-xl object-cover" />
          <div><h1 className="text-lg font-bold text-slate-900">{title}</h1>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div>
        </div>
        {children}
      </div>
    </div>
  );
}
