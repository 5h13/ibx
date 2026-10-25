'use client';
// Build 139 (from 5h13Shops Build 10): the store's shop Inbox — questions and requests for quotation that buyers
// sent from the online shop. Reply in one tap by the buyer's chosen way (WhatsApp / Text fill the reply in; Viber
// copies it; Call), then answer Confirmed / Not available / Done — the buyer sees it on their request page.
// Used by the Sales Manager app (/manager/inbox) and the office app (Sales → Shop Inbox).
import { useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { copyNow } from './MessengerLink';
import { smsLink, telLink, viberLink, waLink } from './contact';
import { pesoShop } from './format';
import { answerShopRequestAction } from './requestActions';

export type InboxRequest = {
  id: string; number: number; kind: 'ask' | 'quote'; item_code: string | null; title: string; buyer_name: string; buyer_mobile: string;
  contact_via: 'viber' | 'whatsapp' | 'text' | 'call' | 'messenger'; message: string; total: number | null;
  status: 'new' | 'seen' | 'confirmed' | 'unavailable' | 'done'; reply_note: string | null; token: string; created_at: string;
};
const KIND: Record<string, string> = { ask: 'Question', quote: 'Request for quotation' };
const VIA: Record<string, string> = { viber: 'Viber', whatsapp: 'WhatsApp', text: 'Text', call: 'Call', messenger: 'Messenger' };
const STATUS: Record<string, [string, string]> = {
  new: ['New', 'bg-red-600 text-white'], seen: ['To answer', 'bg-amber-100 text-amber-900'], confirmed: ['Confirmed', 'bg-emerald-600 text-white'],
  unavailable: ['Not available', 'bg-slate-200 text-slate-800'], done: ['Done', 'bg-slate-200 text-slate-800'],
};

function templates(r: InboxRequest, store: string, shop: string) {
  const first = r.buyer_name.split(/\s+/)[0];
  const what = `${r.kind === 'quote' ? 'request for quotation' : 'question'} #${r.number}${r.item_code ? ` (${r.item_code})` : ''}`;
  const page = `${shop}/r/${r.token}`;
  return [
    { key: 'confirm', label: 'Available / confirmed', text: `Hi ${first}! This is ${store} about your ${what}. Good news — it's available. We'll send the details and price here.` },
    { key: 'quote', label: 'Quotation sent', text: `Hi ${first}! This is ${store} about your ${what}. Here is our quotation: ____. It is valid for 7 days. Let us know if you'd like to proceed.` },
    { key: 'deposit', label: 'Ask for deposit', text: `Hi ${first}! This is ${store} about your ${what}. To reserve it, please send a deposit of ₱____ via GCash to ____ and send us the screenshot. Thank you!` },
    { key: 'ready', label: 'Ready for pickup', text: `Hi ${first}! Your order from ${store} (${what}) is ready for pickup. Thank you!` },
    { key: 'none', label: 'Not available', text: `Hi ${first}! This is ${store} about your ${what}. Sorry, it's not available right now. Would you like an alternative?` },
  ].map((t) => ({ ...t, text: `${t.text}\n(Your request: ${page})` }));
}

function Card({ r, storeName, shop }: { r: InboxRequest; storeName: string; shop: string }) {
  const tpl = templates(r, storeName, shop);
  const [pick, setPick] = useState(tpl[0].key);
  const [text, setText] = useState(tpl[0].text);
  const [note, setNote] = useState(r.reply_note ?? '');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(r.status === 'new' || r.status === 'seen');
  // the card stays where it is after an answer (with its new label) so it is clear it saved; it moves to
  // "Answered" the next time the Inbox opens
  const [status, setStatus] = useState(r.status);
  const [s0, s1] = STATUS[status];
  const choose = (k: string) => { setPick(k); setText(tpl.find((x) => x.key === k)!.text); };
  async function answer(st: 'confirmed' | 'unavailable' | 'done') {
    setBusy(st); setMsg('');
    try { await answerShopRequestAction(r.id, st, note); setStatus(st); setMsg('Saved — the buyer sees it on their request page.'); }
    catch (e) { setMsg(errorText(e)); } finally { setBusy(''); }
  }
  const btn = 'flex min-h-[44px] items-center justify-center rounded-xl px-3 text-sm font-bold';
  const order = (['whatsapp', 'text', 'viber', 'call'] as const).slice().sort((a, b) => (a === r.contact_via ? -1 : b === r.contact_via ? 1 : 0));
  return (
    <li className="space-y-3 rounded-xl border bg-white p-4 shadow-sm" data-testid={`request-${r.number}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500"><b className="text-slate-900">#{r.number}</b>{KIND[r.kind] ?? r.kind}<span>· {new Date(r.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</span></span>
          <b className="block truncate text-base">{r.title}</b>
          {r.item_code && <span className="block font-mono text-xs text-slate-500">{r.item_code}</span>}
          <span className="block text-sm text-slate-600">{r.buyer_name} · {r.buyer_mobile} · prefers <b>{VIA[r.contact_via]}</b>{r.total != null ? ` · ${pesoShop(r.total)}` : ''}</span>
        </span>
        <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${s1}`}>{s0}</span>
      </button>
      {open && (
        <div className="space-y-3">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{r.message}</pre>
          {r.contact_via === 'messenger' && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">The buyer chose Messenger — they will message your Facebook Page with “I sent request #{r.number}”. Reply there. You can also use their number below.</p>}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase text-slate-500">Reply</div>
            <div className="flex flex-wrap gap-1.5">{tpl.map((x) => <button key={x.key} type="button" onClick={() => choose(x.key)} aria-pressed={pick === x.key}
              className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${pick === x.key ? 'border-[rgb(var(--btn))] bg-[rgb(var(--btn))] text-[rgb(var(--on-btn))]' : 'bg-white'}`}>{x.label}</button>)}</div>
            <textarea className="input w-full text-sm" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Reply to request ${r.number}`} />
            <div className="grid grid-cols-2 gap-2">
              {order.map((k) => k === 'whatsapp' ? <a key={k} href={waLink(r.buyer_mobile, text)} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25d366] text-white`}>WhatsApp</a>
                : k === 'text' ? <a key={k} href={smsLink(r.buyer_mobile, text)} className={`${btn} border bg-white`}>Text</a>
                : k === 'viber' ? <a key={k} href={viberLink(r.buyer_mobile, text)} onClick={() => copyNow(text)} className={`${btn} bg-[#7360f2] text-white`}>Viber</a>
                : <a key={k} href={telLink(r.buyer_mobile)} className={`${btn} border bg-white`}>Call {r.buyer_mobile}</a>)}
            </div>
            <p className="text-xs text-slate-500">WhatsApp and Text fill in your reply; Viber copies it (paste in the chat). The buyer&apos;s choice is first.</p>
          </div>
          <div className="space-y-2 border-t pt-3">
            <label className="block text-sm"><span className="font-medium">Note on the buyer&apos;s request page (optional)</span>
              <input className="input mt-1 w-full" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ready by 4 PM · quotation sent on Viber" aria-label={`Note for request ${r.number}`} /></label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={!!busy} onClick={() => answer('confirmed')} className={`${btn} bg-emerald-600 text-white`}>{busy === 'confirmed' ? '…' : 'Confirmed'}</button>
              <button type="button" disabled={!!busy} onClick={() => answer('unavailable')} className={`${btn} border bg-white`}>{busy === 'unavailable' ? '…' : 'Not available'}</button>
              <button type="button" disabled={!!busy} onClick={() => answer('done')} className={`${btn} border bg-white`}>{busy === 'done' ? '…' : 'Done'}</button>
            </div>
            {msg && <p role="status" className="text-sm text-emerald-800">{msg}</p>}
          </div>
        </div>
      )}
    </li>
  );
}

export function InboxList({ list, storeName, shop }: { list: InboxRequest[]; storeName: string; shop: string }) {
  if (!list.length) return <p className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">No requests here. When a buyer taps “Send request to the store” on the online shop, it appears here and you get a notification.</p>;
  return <ul className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">{list.map((r) => <Card key={r.id} r={r} storeName={storeName} shop={shop} />)}</ul>;
}
