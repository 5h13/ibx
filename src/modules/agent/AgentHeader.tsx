'use client';
// Build 91 — agent portal header: page title and the store picker (the agent
// sells for every store; everything on the page is for the chosen store).
import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { setAgentStoreAction } from './agentActions';
import type { AgentStore } from './agentContext';

export const peso = (v: unknown) => (v == null || v === '' ? '—' : `₱${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const qty = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }));
export const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export function AgentHeader({ title, hint, stores, store }: { title: string; hint?: string; stores: AgentStore[]; store: AgentStore | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const pick = (id: string) => start(async () => {
    await setAgentStoreAction(id);
    const next = new URLSearchParams(params.toString());
    next.set('b', id); next.delete('c'); next.delete('order');
    router.push(`${pathname}?${next.toString()}`);
  });
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-slate-500">Store</span>
        <select className="input min-w-48" value={store?.business_id ?? ''} disabled={pending} onChange={(e) => pick(e.target.value)}>
          {stores.map((s) => <option key={s.business_id} value={s.business_id}>{s.name}</option>)}
        </select>
      </label>
    </div>
  );
}

export function AgentNotLinked({ message }: { message: string }) {
  return <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{message}</div>;
}

const TONE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700', sent: 'bg-blue-100 text-blue-800', completed: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-100 text-amber-800', confirmed: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-800',
  submitted: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', paid: 'bg-emerald-100 text-emerald-800',
};
export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[status] ?? 'bg-slate-100 text-slate-700'}`}>{label ?? status.replace('_', ' ')}</span>;
}
