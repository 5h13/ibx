'use client';
// Build 127 — Sales Manager: the month's sales by category, client or channel (share and margin).
import Link from 'next/link';
import { useState } from 'react';
import { peso, pct, shortDate } from './ui';

type Row = { id?: string | null; name: string; total: number; margin: number | null; sales?: number; last?: string; agent?: string | null; prev?: number; overdue?: number | null };

export function Breakdown({ categories, clients, channels, total, margin }: { categories: Row[]; clients: Row[]; channels: Row[]; total: number; margin: number | null }) {
  const [by, setBy] = useState<'category' | 'client' | 'channel'>('category');
  const rows = by === 'category' ? categories : by === 'client' ? clients : channels;
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.total))));
  return (
    <section className="space-y-2.5 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-extrabold">Sales breakdown</h2>
        <div role="group" aria-label="Break down by" className="flex gap-0.5 rounded-xl bg-slate-100 p-1">
          {(['category', 'client', 'channel'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)}
              className={`min-h-[34px] rounded-lg px-2.5 text-xs font-bold capitalize ${by === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{k}</button>
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>{by === 'client' ? 'Top clients' : by}</span><span>Sales · share · margin</span></div>
      {rows.length === 0 && <p className="text-sm text-slate-500">No sales this month yet.</p>}
      {rows.map((r, i) => {
        const share = total ? Math.round((Number(r.total) / total) * 100) : 0;
        const change = by === 'client' && r.prev ? Math.round(((Number(r.total) - Number(r.prev)) / Number(r.prev)) * 100) : null;
        return (
          <div key={`${by}-${r.id ?? r.name}-${i}`} className="space-y-1">
            <div className="flex items-start justify-between gap-2 text-sm">
              {by === 'client' && r.id ? <Link href={`/manager/clients/${r.id}`} className="min-w-0 truncate font-bold underline decoration-slate-300">{r.name}</Link> : <span className="min-w-0 truncate">{r.name}</span>}
              <span className="whitespace-nowrap"><b className="tabular-nums">{peso(r.total)}</b> · {share}% · <span className={r.margin != null && Number(r.margin) < 7 ? 'font-bold text-amber-700' : 'font-bold text-emerald-700'}>{pct(r.margin)}</span></span>
            </div>
            {by === 'client' && (
              <div className="text-[11px] text-slate-600">{[r.agent ? `Agent ${r.agent}` : 'Counter', `${r.sales ?? 0} sale${r.sales === 1 ? '' : 's'}`, r.last ? `last ${shortDate(r.last)}` : null,
                change != null ? `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs last month` : null, Number(r.overdue) > 0 ? `${peso(r.overdue)} overdue` : null].filter(Boolean).join(' · ')}</div>
            )}
            <div className="h-1.5 rounded-full bg-slate-200"><div className={`h-1.5 rounded-full ${Number(r.total) < 0 ? 'bg-red-400' : 'bg-[rgb(var(--btn))]'}`} style={{ width: `${(Math.abs(Number(r.total)) / max) * 100}%` }} /></div>
          </div>
        );
      })}
      <div className="flex justify-between border-t pt-2 text-sm"><span className="text-slate-600">All sales · gross margin</span><b className="tabular-nums">{peso(total)} · {pct(margin)}</b></div>
    </section>
  );
}
