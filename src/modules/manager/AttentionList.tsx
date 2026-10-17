'use client';
// Build 133 — Sales Manager: "Needs attention". Urgent (red), to watch (amber), follow-ups (grey);
// each with its action (Open, Call) and Done / Snooze 3 days.
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { attentionSetAction } from './actions';
import { smsHref, telHref } from '@/shared/contact';

type Item = { key: string; level: 'red' | 'amber' | 'info'; group: string; title: string; detail: string | null; url: string | null; phone: string | null };
const TABS: [string, string][] = [['all', 'All'], ['approvals', 'Approvals'], ['team', 'Team'], ['clients', 'Clients'], ['pipeline', 'Pipeline']];
const TONE = { red: 'border-l-red-600 bg-red-50', amber: 'border-l-amber-500 bg-amber-50', info: 'border-l-slate-400 bg-slate-50' };
const DOT = { red: 'Urgent', amber: 'Watch', info: 'Follow up' };

// a short ready message for the Text button (edited on the phone before sending)
function textFor(i: Item, me: string, store: string): string {
  const kind = i.key.split(':')[0];
  const parts = (i.detail ?? '').split(' — ')[0].split(' · ');
  const hello = `Good day! This is ${me} of ${store}.`;
  const agent = (re: RegExp) => (re.exec(i.title)?.[1] ?? '').trim();
  switch (kind) {
    case 'behind': return `Hi ${agent(/^(.*) is behind pace/)}! Checking in on your target this month: ${i.detail}. Anything you need from me to catch up?`;
    case 'nosale': return `Hi ${agent(/^(.*): no sale/)}! I noticed no sales from you for a while (${(i.detail ?? '').toLowerCase()}). How are your clients doing? Anything I can help with?`;
    case 'missed': return `Hi ${agent(/^(.*) missed the target/)}! Let's talk about your target (${i.detail}). When are you free?`;
    case 'promise': return `${hello} A friendly reminder about your payment (${parts.slice(1).join(' · ')}). Thank you!`;
    case 'order': return `${hello} A friendly reminder about your account balance — kindly settle the overdue invoices so we can process your new order. Thank you!`;
    case 'quiet': return `${hello} It's been a while — anything you need for your next jobs? We're happy to send you a quotation.`;
    case 'followup': return `${hello} Following up on our quotation ${parts[0]}. Any questions or changes needed?`;
    case 'expiry': return `${hello} Our quotation ${parts[1] ?? ''} is about to expire. Shall we go ahead with your order?`;
    case 'undelivered': return `${hello} An update on your order ${parts[1] ?? ''}: we are preparing it and will confirm the delivery date shortly.`;
    default: return '';
  }
}

export function AttentionList({ items, snoozed, limit = 8, me = '', store = '' }: { items: Item[]; snoozed: number; limit?: number; me?: string; store?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState('all');
  const [all, setAll] = useState(false);
  const [gone, setGone] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const act = (key: string, status: 'done' | 'snoozed') => start(async () => {
    setErr('');
    try { setGone((g) => [...g, key]); await attentionSetAction(key, status, 3); router.refresh(); }
    catch (e) { setGone((g) => g.filter((k) => k !== key)); setErr(errorText(e)); }
  });
  const shown = items.filter((i) => !gone.includes(i.key) && (tab === 'all' || i.group === tab));
  const list = all ? shown : shown.slice(0, limit);
  const count = (g: string) => items.filter((i) => !gone.includes(i.key) && (g === 'all' || i.group === g)).length;
  return (
    <div className="space-y-2">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Show">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setAll(false); }}
            className={`min-h-[36px] flex-none rounded-full border px-3 text-xs font-bold ${tab === k ? 'border-transparent bg-[rgb(var(--btn))] text-[rgb(var(--on-btn))]' : 'bg-white text-slate-700'}`}>
            {label} {count(k) > 0 && <span className="tabular-nums">{count(k)}</span>}
          </button>
        ))}
      </div>
      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div>}
      {shown.length === 0 && <p className="py-2 text-sm text-slate-500">Nothing needs attention here. {snoozed > 0 ? `${snoozed} snoozed.` : ''}</p>}
      <ul className="space-y-2">
        {list.map((i) => (
          <li key={i.key} className={`rounded-xl border-l-4 p-3 ${TONE[i.level]}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{DOT[i.level]}</div>
                <div className="text-sm font-bold text-slate-900">{i.title}</div>
                {i.detail && <div className="text-xs text-slate-700">{i.detail}</div>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {i.url && <Link href={i.url} className="min-h-[36px] rounded-lg bg-[rgb(var(--btn))] px-3 py-2 text-xs font-bold text-[rgb(var(--on-btn))]">Open</Link>}
              {i.phone && <a href={telHref(i.phone)} className="min-h-[36px] rounded-lg border bg-white px-3 py-2 text-xs font-bold">Call</a>}
              {i.phone && <a href={smsHref(i.phone, textFor(i, me, store))} className="min-h-[36px] rounded-lg border bg-white px-3 py-2 text-xs font-bold">Text</a>}
              <button type="button" disabled={pending} onClick={() => act(i.key, 'done')} className="min-h-[36px] rounded-lg border bg-white px-3 py-2 text-xs font-bold">Done</button>
              <button type="button" disabled={pending} onClick={() => act(i.key, 'snoozed')} className="min-h-[36px] rounded-lg border bg-white px-3 py-2 text-xs">Snooze 3 days</button>
            </div>
          </li>
        ))}
      </ul>
      {!all && shown.length > limit && <button type="button" onClick={() => setAll(true)} className="w-full rounded-lg border bg-white py-2 text-sm font-bold">Show all {shown.length}</button>}
    </div>
  );
}
