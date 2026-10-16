'use client';
// Build 127 — Sales Manager: the team against its monthly targets; set the store's and each
// person's target for the month.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { setTargetAction } from './actions';
import { Bar, peso } from './ui';

type Person = { kind: string; agent_id: string | null; user_id: string | null; name: string; phone: string | null; total: number; sales: number; clients: number; last: string | null; target: number | null };

export function TeamTargets({ people, year, month, storeTarget, storeTotal, dayShare }: { people: Person[]; year: number; month: number; storeTarget: number | null; storeTotal: number; dayShare: number }) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const save = (agent: string | null, user: string | null) => start(async () => {
    setErr('');
    try { await setTargetAction({ year, month, agent_id: agent, user_id: user, amount: Number(val) }); setEdit(null); router.refresh(); }
    catch (e) { setErr(errorText(e)); }
  });
  const editor = (key: string, agent: string | null, user: string | null, current: number | null) => edit === key ? (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(agent, user); }}>
      <label className="sr-only" htmlFor={`t-${key}`}>Target for the month</label>
      <input id={`t-${key}`} className="input w-36" type="number" min="0" step="1000" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
      <button className="min-h-[40px] rounded-lg bg-[rgb(var(--btn))] px-3 text-sm font-bold text-[rgb(var(--on-btn))]" disabled={pending}>Save</button>
      <button type="button" className="min-h-[40px] px-2 text-sm" onClick={() => setEdit(null)}>Cancel</button>
    </form>
  ) : (
    <button type="button" className="text-xs font-bold text-[rgb(var(--btn))] underline" onClick={() => { setEdit(key); setVal(current ? String(current) : ''); }}>{current ? 'Change target' : 'Set target'}</button>
  );
  return (
    <div className="space-y-3">
      {err && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2"><h2 className="text-base font-extrabold">Store</h2>{editor('store', null, null, storeTarget)}</div>
        <div className="flex justify-between text-sm"><b className="tabular-nums">{peso(storeTotal)}</b><span className="text-slate-600">{storeTarget ? `of ${peso(storeTarget)} · ${Math.round((storeTotal / storeTarget) * 100)}%` : 'no target yet'}</span></div>
        {storeTarget ? <Bar value={storeTotal} max={storeTarget} mark={dayShare} /> : null}
        <p className="text-[11px] text-slate-500">The dark mark is where the month should be today. With no store target, the people&apos;s targets are added up.</p>
      </section>
      {people.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">No sales this month yet.</div>}
      {people.map((p) => {
        const key = p.agent_id ?? p.user_id ?? p.name;
        const share = p.target ? Math.round((Number(p.total) / Number(p.target)) * 100) : null;
        return (
          <article key={key} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-200 text-sm font-extrabold text-slate-800">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <div className="min-w-0 flex-1"><div className="truncate font-extrabold">{p.name}</div><div className="text-xs text-slate-600">{p.kind}{p.last ? ` · last sale ${new Date(`${p.last}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short' })}` : ''}</div></div>
              {p.phone && <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} className="flex h-11 w-11 items-center justify-center rounded-xl border"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg></a>}
            </div>
            <div className="flex justify-between text-sm"><b className="tabular-nums">{peso(p.total)}</b><span className="text-slate-600">{p.target ? `of ${peso(p.target)} · ${share}%` : 'no target'}</span></div>
            {p.target ? <Bar value={Number(p.total)} max={Number(p.target)} mark={dayShare} /> : null}
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600"><span>{p.sales} sale{p.sales === 1 ? '' : 's'} · {p.clients} client{p.clients === 1 ? '' : 's'}</span>{editor(key, p.agent_id, p.user_id, p.target)}</div>
          </article>
        );
      })}
    </div>
  );
}
