'use client';
// Build 82 — 5H13 Shortcuts at the top of the sidebar. Each user ticks the
// pages / actions they use most (only what their access allows) and orders them.
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionProfile } from '@/core/auth/types';
import { errorText } from '@/core/errors/appError';
import { availableShortcuts } from './shortcuts';
import { saveShortcutsAction } from './shortcutActions';

export function ShortcutsPanel({ profile, saved }: { profile: SessionProfile; saved: string[] }) {
  const pathname = usePathname();
  const all = useMemo(() => availableShortcuts(profile), [profile]);
  const byKey = useMemo(() => new Map(all.map((s) => [s.key, s])), [all]);
  const [keys, setKeys] = useState<string[]>(saved);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(saved);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const shown = keys.map((k) => byKey.get(k)).filter(Boolean) as ReturnType<typeof availableShortcuts>;
  const groups = Array.from(new Set(all.map((s) => s.group)));

  const toggle = (k: string) => setDraft((d) => (d.includes(k) ? d.filter((x) => x !== k) : [...d, k]));
  const move = (i: number, by: number) => setDraft((d) => { const j = i + by; if (j < 0 || j >= d.length) return d; const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = () => start(async () => {
    setError('');
    try { const r = await saveShortcutsAction(draft.filter((k) => byKey.has(k))); setKeys(r); setEditing(false); } catch (e) { setError(errorText(e) || 'Unable to save.'); }
  });

  return (
    <div className="mb-3 rounded-lg border border-slate-600 bg-slate-700/40 p-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">5H13 Shortcuts</span>
        <button type="button" className="text-[11px] text-slate-300 underline hover:text-white" onClick={() => { setDraft(keys.filter((k) => byKey.has(k))); setError(''); setEditing(true); }}>Edit</button>
      </div>
      {shown.length === 0 ? (
        <button type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700" onClick={() => { setDraft([]); setEditing(true); }}>+ Add shortcuts</button>
      ) : shown.map((s) => {
        const base = s.href.split('?')[0];
        const active = !s.action && (pathname === base || pathname.startsWith(`${base}/`));
        return (
          <Link key={s.key} href={s.href} className={`block rounded px-2 py-1.5 text-sm hover:bg-slate-700 ${active ? 'bg-slate-700 font-medium text-white' : ''}`}>
            {s.action ? <span className="mr-1 font-bold">+</span> : null}{s.label}
          </Link>
        );
      })}

      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white text-slate-800 shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div><h3 className="font-semibold">5H13 Shortcuts</h3><p className="text-sm text-slate-500">Tick what you use most. Only pages and actions you have access to are listed. &quot;+&quot; items open the page with the form ready.</p></div>
              <button type="button" className="button-secondary" onClick={() => setEditing(false)}>Close</button>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1fr_16rem]">
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g}>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {all.filter((s) => s.group === g).map((s) => (
                        <label key={s.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                          <input type="checkbox" checked={draft.includes(s.key)} onChange={() => toggle(s.key)} />
                          <span>{s.action ? <b>+ </b> : null}{s.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Order ({draft.length})</div>
                {draft.length === 0 && <p className="text-sm text-slate-400">Nothing ticked yet.</p>}
                <ol className="space-y-1">
                  {draft.map((k, i) => (
                    <li key={k} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
                      <span className="flex-1 truncate">{byKey.get(k)?.label ?? k}</span>
                      <button type="button" className="px-1 text-slate-500 hover:text-slate-900" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                      <button type="button" className="px-1 text-slate-500 hover:text-slate-900" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                      <button type="button" className="px-1 text-red-600" onClick={() => toggle(k)} aria-label="Remove">×</button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              {error && <span className="mr-auto text-sm text-red-600">{error}</span>}
              <button type="button" className="button-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="button" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save shortcuts'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
