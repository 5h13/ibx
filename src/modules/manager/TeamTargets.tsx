'use client';
// Build 127 — Sales Manager: the team against its monthly targets; set the store's and each
// person's target for the month.
// Build 132: a person's target defaults to their average monthly sales + 20%; the manager may set another
// one with a note (sent to the person). Tap a person to open their page.
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { setTargetAction } from './actions';
import { Bar, peso } from './ui';

type Person = {
  kind: string; agent_id: string | null; user_id: string | null; name: string; phone: string | null; total: number; sales: number; clients: number; last: string | null;
  target: number | null; target_set: boolean; note: string | null; default: number | null; average: number | null;
};

export function personHref(p: { agent_id: string | null; user_id: string | null }, ym: string) {
  return `/manager/team/person?${p.agent_id ? `a=${p.agent_id}` : `u=${p.user_id}`}&m=${ym}`;
}

export function TargetEditor({ year, month, agent, user, current, suggested, who, onDone }: {
  year: number; month: number; agent: string | null; user: string | null; current: number | null; suggested: number | null; who: string | null; onDone: () => void;
}) {
  const router = useRouter();
  const [val, setVal] = useState(current ? String(current) : suggested ? String(suggested) : '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const person = Boolean(agent || user);
  const save = () => start(async () => {
    setErr('');
    try { await setTargetAction({ year, month, agent_id: agent, user_id: user, amount: Number(val), note }); onDone(); router.refresh(); }
    catch (e) { setErr(errorText(e)); }
  });
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-600" htmlFor={`t-${agent ?? user ?? 'store'}`}>Target ₱</label>
        <input id={`t-${agent ?? user ?? 'store'}`} className="input w-36" type="number" min="0" step="100" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
      </div>
      {person && (
        <div>
          <label className="text-xs text-slate-600" htmlFor={`n-${agent ?? user}`}>Note to {who ?? 'them'} (sent with the new target)</label>
          <textarea id={`n-${agent ?? user}`} className="input mt-1 w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Two big clients on leave this month" required />
        </div>
      )}
      {err && <div className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800">{err}</div>}
      <div className="flex gap-2">
        <button className="min-h-[40px] rounded-lg bg-[rgb(var(--btn))] px-3 text-sm font-bold text-[rgb(var(--on-btn))]" disabled={pending}>{pending ? 'Saving…' : person ? 'Save and notify' : 'Save'}</button>
        <button type="button" className="min-h-[40px] px-2 text-sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function targetLine(p: { target: number | null; target_set: boolean; default: number | null; average: number | null }) {
  if (p.target == null) return 'no target (no sales history yet)';
  return p.target_set ? `target ${peso(p.target)} · set by the manager` : `target ${peso(p.target)} · default: average ${peso(p.average)} + 20%`;
}

export function TeamTargets({ people, year, month, storeTarget, storeTotal, dayShare }: { people: Person[]; year: number; month: number; storeTarget: number | null; storeTotal: number; dayShare: number }) {
  const [edit, setEdit] = useState<string | null>(null);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2"><h2 className="text-base font-extrabold">Store</h2>
          {edit !== 'store' && <button type="button" className="text-xs font-bold text-[rgb(var(--btn))] underline" onClick={() => setEdit('store')}>{storeTarget ? 'Change target' : 'Set target'}</button>}</div>
        {edit === 'store' && <TargetEditor year={year} month={month} agent={null} user={null} current={storeTarget} suggested={null} who={null} onDone={() => setEdit(null)} />}
        <div className="flex justify-between text-sm"><b className="tabular-nums">{peso(storeTotal)}</b><span className="text-slate-600">{storeTarget ? `of ${peso(storeTarget)} · ${Math.round((storeTotal / storeTarget) * 100)}%` : 'no target yet'}</span></div>
        {storeTarget ? <Bar value={storeTotal} max={storeTarget} mark={dayShare} /> : null}
        <p className="text-[11px] text-slate-500">The dark mark is where the month should be today. With no store target, the people&apos;s targets are added up. A person&apos;s target is their average monthly sales + 20% unless you set another one.</p>
      </section>
      {people.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">No sales this month yet.</div>}
      {people.map((p) => {
        const key = p.agent_id ?? p.user_id ?? p.name;
        const share = p.target ? Math.round((Number(p.total) / Number(p.target)) * 100) : null;
        return (
          <article key={key} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Link href={personHref(p, ym)} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`Open ${p.name}'s performance`}>
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-200 text-sm font-extrabold text-slate-800">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <div className="min-w-0 flex-1"><div className="truncate font-extrabold underline decoration-slate-300 underline-offset-2">{p.name} ›</div><div className="text-xs text-slate-600">{p.kind}{p.last ? ` · last sale ${new Date(`${p.last}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short' })}` : ''}</div></div>
              </Link>
              {p.phone && <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} className="flex h-11 w-11 items-center justify-center rounded-xl border"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg></a>}
            </div>
            <div className="flex justify-between text-sm"><b className="tabular-nums">{peso(p.total)}</b><span className="text-slate-600">{p.target ? `of ${peso(p.target)} · ${share}%` : 'no target'}</span></div>
            {p.target ? <Bar value={Number(p.total)} max={Number(p.target)} mark={dayShare} /> : null}
            <div className="text-[11px] text-slate-500">{targetLine(p)}{p.target_set && p.note ? ` — “${p.note}”` : ''}</div>
            {edit === key
              ? <TargetEditor year={year} month={month} agent={p.agent_id} user={p.user_id} current={p.target_set ? p.target : null} suggested={p.default} who={p.name} onDone={() => setEdit(null)} />
              : <div className="flex items-center justify-between gap-2 text-xs text-slate-600"><span>{p.sales} sale{p.sales === 1 ? '' : 's'} · {p.clients} client{p.clients === 1 ? '' : 's'}</span>
                  <button type="button" className="text-xs font-bold text-[rgb(var(--btn))] underline" onClick={() => setEdit(key)}>Change target</button></div>}
          </article>
        );
      })}
    </div>
  );
}
