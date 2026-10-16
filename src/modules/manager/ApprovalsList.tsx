'use client';
// Build 127 — Sales Manager: everything waiting for the manager, filtered by kind.
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { approveItemAction, returnItemAction, type Kind } from './actions';
import { KIND_LABEL, peso } from './ui';

const TABS: [string, string][] = [['all', 'All'], ['quote', 'Quotes'], ['order', 'Orders'], ['price', 'Prices'], ['cancel', 'Refunds'], ['closing', 'Closings']];
const STEP: Record<string, string> = { prepared: 'waiting for review', reviewed: 'reviewed — waiting for approval', pending_approval: 'waiting for approval', requested: 'requested', submitted: 'submitted' };

export function ApprovalsList({ items, initial }: { items: any[]; initial?: string }) {
  const router = useRouter();
  const dialog = useDialog();
  const [tab, setTab] = useState(initial && TABS.some(([k]) => k === initial) ? initial : 'all');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [, start] = useTransition();
  const shown = items.filter((x) => tab === 'all' || x.kind === tab);
  const count = (k: string) => (k === 'all' ? items.length : items.filter((x) => x.kind === k).length);
  const act = (id: string, fn: () => Promise<any>, done: string) => {
    setBusy(id); setMsg(null);
    start(async () => {
      try { const r = await fn(); setMsg({ tone: 'ok', text: r?.note || done }); router.refresh(); }
      catch (e) { setMsg({ tone: 'err', text: errorText(e) }); }
      finally { setBusy(null); }
    });
  };
  return (
    <div className="space-y-3">
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1" role="group" aria-label="Show">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`min-h-[40px] flex-none rounded-full border px-3.5 text-sm font-semibold ${tab === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{label} {count(k)}</button>
        ))}
      </div>
      {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</div>}
      {shown.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Nothing waiting here.</div>}
      {shown.map((x) => (
        <article key={`${x.kind}-${x.id}`} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{KIND_LABEL[x.kind]} · {STEP[x.status] ?? x.status}</div>
              {x.kind === 'quote'
                ? <Link href={`/manager/quotes/${x.id}`} className="block truncate text-[15px] font-extrabold text-slate-900 underline decoration-slate-300">{x.number} · {x.client ?? '—'}</Link>
                : <div className="truncate text-[15px] font-extrabold">{x.number} · {x.client ?? '—'}</div>}
              <div className="text-xs text-slate-600">{x.by ? `by ${x.by} · ` : ''}{x.at ? new Date(x.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</div>
            </div>
            <div className="whitespace-nowrap text-base font-extrabold tabular-nums">{peso(x.amount)}</div>
          </div>
          {x.flag && <div className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-900">{x.flag}</div>}
          <div className={`grid gap-2 ${x.kind === 'quote' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {x.kind === 'quote' && <Link href={`/manager/quotes/${x.id}`} className="flex min-h-[44px] items-center justify-center rounded-xl border text-sm font-bold">Open</Link>}
            <button type="button" disabled={busy === x.id} className="min-h-[44px] rounded-xl border border-red-300 text-sm font-bold text-red-700"
              onClick={async () => { const r = await dialog.prompt(x.kind === 'price' ? 'Reject this counter sale? It is cancelled. Reason:' : 'Send it back — reason (the preparer sees it):', { required: true }); if (r) act(x.id, () => returnItemAction(x.kind as Kind, x.id, r), 'Sent back.'); }}>
              {x.kind === 'price' || x.kind === 'cancel' ? 'Reject' : 'Return'}
            </button>
            <button type="button" disabled={busy === x.id} className="min-h-[44px] rounded-xl bg-[rgb(var(--btn))] text-sm font-bold text-[rgb(var(--on-btn))] disabled:opacity-60"
              onClick={() => act(x.id, () => approveItemAction(x.kind as Kind, x.id), 'Approved.')}>{busy === x.id ? '…' : 'Approve'}</button>
          </div>
        </article>
      ))}
    </div>
  );
}
