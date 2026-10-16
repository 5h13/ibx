'use client';
// Build 127 — Sales Manager: decide a quotation from its review screen.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { approveItemAction, returnItemAction } from './actions';

export function QuoteActions({ id, belowFloor, waiting }: { id: string; belowFloor: number; waiting: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<any>, done: string, then?: string) => start(async () => {
    setMsg(null);
    try { const r = await fn(); setMsg({ tone: 'ok', text: r?.note || done }); if (then && !r?.note) router.push(then); else router.refresh(); }
    catch (e) { setMsg({ tone: 'err', text: errorText(e) }); }
  });
  if (!waiting) return <div className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">This quotation is not waiting for approval.</div>;
  return (
    <>
      <label className="block text-sm font-bold">Note to the preparer (needed to return)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input mt-1 w-full" placeholder="e.g. Keep the compressor at the store price" />
      </label>
      {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</div>}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 shadow-lg md:static md:shadow-sm">
        <button type="button" disabled={pending} className="min-h-[52px] rounded-xl border border-red-300 font-extrabold text-red-700"
          onClick={() => (note.trim() ? run(() => returnItemAction('quote', id, note), 'Returned to the preparer.', '/manager/approvals') : setMsg({ tone: 'err', text: 'Write a note to return it.' }))}>Return</button>
        <button type="button" disabled={pending} className="min-h-[52px] rounded-xl bg-[rgb(var(--btn))] font-extrabold text-[rgb(var(--on-btn))] disabled:opacity-60"
          onClick={() => run(() => approveItemAction('quote', id), 'Approved.', '/manager/approvals')}>{pending ? '…' : belowFloor > 0 ? 'Approve below floor' : 'Approve'}</button>
      </div>
    </>
  );
}
