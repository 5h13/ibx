'use client';
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { decideOpeningCountAction } from './actions';

export function OpeningCountDecision({ countId, canDecide, preparedByMe }: { countId: string; canDecide: boolean; preparedByMe: boolean }) {
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  if (!canDecide) return <p className="text-xs text-slate-500">Waiting for a Business Admin to approve.</p>;
  if (preparedByMe) return <p className="text-xs text-slate-500">You prepared this count — another Business Admin approves it.</p>;
  const go = (approve: boolean) => start(async () => {
    try { const r = await decideOpeningCountAction(countId, approve, note); setMsg(approve ? `Approved: stock set for ${r.lines} item(s) (${r.raised} raised, ${r.lowered} lowered).` : 'Rejected.'); }
    catch (e) { setMsg(errorText(e)); }
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input max-w-xs" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="button-secondary" disabled={pending} onClick={() => go(false)}>Reject</button>
      <button className="button" disabled={pending} onClick={() => go(true)}>Approve and post</button>
      {msg && <span className="text-sm">{msg}</span>}
    </div>
  );
}
