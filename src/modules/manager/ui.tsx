// Build 127 — small building blocks shared by the Sales Manager screens.
import type { ReactNode } from 'react';

export const peso = (n: unknown, dp = 0) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const pct = (n: unknown) => (n == null ? '—' : `${Number(n).toLocaleString('en-PH', { maximumFractionDigits: 1 })}%`);
export const shortDate = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : '—');

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-2.5 rounded-2xl bg-white p-4 shadow-sm ${className}`}>
      {(title || action) && <div className="flex items-center justify-between gap-2">{title && <h2 className="text-base font-extrabold text-slate-900">{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

export function Tile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'up' | 'down' | 'warn' }) {
  const t = tone === 'up' ? 'text-emerald-700' : tone === 'down' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-500';
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-extrabold tabular-nums text-slate-900">{value}</div>
      {note && <div className={`text-[11px] ${t}`}>{note}</div>}
    </div>
  );
}

export function Bar({ value, max, mark }: { value: number; max: number; mark?: number }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="relative h-2 overflow-hidden rounded-full bg-slate-200">
      <div className="h-2 rounded-full bg-[rgb(var(--btn))]" style={{ width: `${w}%` }} />
      {mark != null && <div className="absolute inset-y-0 w-0.5 bg-slate-900/70" style={{ left: `${Math.max(0, Math.min(100, mark))}%` }} />}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">{children}</div>;
}

export const KIND_LABEL: Record<string, string> = { quote: 'Quotation', order: 'Sales order · go-signal', price: 'Counter price exception', cancel: 'Cancel / refund a sale', closing: 'Daily closing' };
