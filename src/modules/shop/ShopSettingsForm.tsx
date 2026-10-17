'use client';
// Build 136 — online shop settings form.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { saveShopSettingsAction } from './settingsActions';

type S = { business_id: string; slug: string; enabled: boolean; messenger_url: string | null; viber_number: string | null; tagline: string | null };

export function ShopSettingsForm({ s, superAdmin }: { s: S; superAdmin: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ messenger_url: s.messenger_url ?? '', viber_number: s.viber_number ?? '', tagline: s.tagline ?? '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (data: Record<string, string | boolean>, done: string) => start(async () => {
    setMsg(null);
    try { await saveShopSettingsAction(s.business_id, data); setMsg({ ok: true, text: done }); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); }
  });
  const field = (k: keyof typeof f, label: string, hint: string, placeholder: string) => (
    <label className="block text-sm"><span className="font-medium">{label}</span>
      <input className="input mt-1 w-full" value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <span className="text-xs text-slate-500">{hint}</span></label>
  );
  return (
    <div className="max-w-xl space-y-4">
      <section className="space-y-2 rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div><div className="font-semibold">Shop address</div><a href={`/shop/${s.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-700 underline">5h13.vercel.app/shop/{s.slug}</a></div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{s.enabled ? 'Open to the public' : 'Off'}</span>
        </div>
        {superAdmin
          ? <button type="button" disabled={pending} onClick={() => run({ enabled: !s.enabled }, s.enabled ? 'The shop is off.' : 'The shop is open to the public.')}
              className={`rounded px-4 py-2 text-sm font-semibold ${s.enabled ? 'border' : 'bg-slate-800 text-white'}`}>{s.enabled ? 'Turn the shop off' : 'Open the shop to the public'}</button>
          : <p className="text-xs text-slate-500">The Super Admin opens or closes the shop.</p>}
        <p className="text-xs text-slate-500">The shop shows active catalog items that have at least one photo, at this store&apos;s prices (&quot;Ask for price&quot; when an item has no price here). Stock, costs and suppliers are never shown.</p>
      </section>
      <form className="space-y-3 rounded-lg border bg-white p-4" onSubmit={(e) => { e.preventDefault(); run(f, 'Saved.'); }}>
        <div className="font-semibold">Contacts and tagline</div>
        {field('messenger_url', 'Messenger link', 'Your Facebook page’s Messenger link, e.g. https://m.me/yourpage', 'https://m.me/…')}
        {field('viber_number', 'Viber number', 'The mobile number customers message on Viber', '0917 123 4567')}
        {field('tagline', 'Tagline', 'One line under the store name (up to 120 characters)', 'Aircon & refrigeration parts — Laguna')}
        <p className="text-xs text-slate-500">The store&apos;s phone, email and address come from System → Businesses.</p>
        <button className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      </form>
      {msg && <div className={`rounded px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</div>}
    </div>
  );
}
