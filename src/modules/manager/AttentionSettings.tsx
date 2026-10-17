'use client';
// Build 133 — the store's "Needs attention" thresholds.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { saveAttentionSettingsAction } from './actions';

const GROUPS: { title: string; fields: [string, string, string][] }[] = [
  { title: 'Urgent approvals', fields: [
    ['price_minutes', 'Counter price exception waiting longer than', 'minutes'],
    ['order_hours', 'Sales order (go-signal) waiting longer than', 'hours'],
    ['quote_hours', 'Quotation waiting longer than', 'hours'],
    ['closing_hour', 'Yesterday’s closing not approved by', 'o’clock'],
    ['overdue_days', 'Order for a client with balances overdue more than', 'days'],
  ] },
  { title: 'Team', fields: [
    ['behind_pct', 'Agent below this share of where he should be today', '%'],
    ['behind_from_day', 'Start checking the pace from day', 'of the month'],
    ['no_sale_days', 'Agent with no sale for', 'days'],
    ['missed_months', 'Agent missed the target this many months in a row', 'months'],
  ] },
  { title: 'Clients', fields: [
    ['top_clients', 'Watch the top clients (sales this year)', 'clients'],
    ['quiet_days', 'Top client with no purchase for', 'days'],
  ] },
  { title: 'Pipeline', fields: [
    ['quote_followup_days', 'Quotation sent with no answer for', 'days'],
    ['quote_expiry_days', 'Quotation expiring within', 'days'],
    ['undelivered_days', 'Approved order not delivered after', 'days'],
  ] },
  { title: 'Notifications', fields: [
    ['summary_hour', 'Morning summary at', 'o’clock (Manila)'],
  ] },
];

export function AttentionSettings({ settings }: { settings: Record<string, number> }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(settings).map(([k, x]) => [k, String(x)])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setMsg(null);
    try {
      await saveAttentionSettingsAction(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])));
      setMsg({ ok: true, text: 'Saved.' }); router.refresh();
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); }
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-extrabold">{g.title}</h2>
          {g.fields.map(([k, label, unit]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <label htmlFor={`s-${k}`} className="text-sm text-slate-700">{label}</label>
              <span className="flex flex-none items-center gap-1.5"><input id={`s-${k}`} className="input w-20 text-right" type="number" inputMode="numeric" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /><span className="w-16 text-xs text-slate-500">{unit}</span></span>
            </div>
          ))}
          {g.title === 'Notifications' && (
            <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
              Nudge agents in the agent app when they fall behind pace (at most once a week)
              <input type="checkbox" className="h-5 w-5 flex-none" checked={v.agent_nudge === '1'} onChange={(e) => setV({ ...v, agent_nudge: e.target.checked ? '1' : '0' })} />
            </label>
          )}
          {g.title === 'Notifications' && <p className="text-[11px] text-slate-500">Urgent items notify the Sales approvers and the Business Admin as soon as they appear (once per item).</p>}
        </section>
      ))}
      {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</div>}
      <button className="min-h-[48px] w-full rounded-xl bg-[rgb(var(--btn))] text-sm font-bold text-[rgb(var(--on-btn))]" disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}
