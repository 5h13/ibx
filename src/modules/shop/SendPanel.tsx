'use client';
// Build 139 (from 5h13Shops Build 10): "Send request to the store". The request is saved for the store's Inbox, the
// buyer chooses how the store should contact them, and gets a request number and a private status page.
// When the buyer picks Messenger, they start the chat (a Facebook Page cannot write first).
import Link from 'next/link';
import { useState } from 'react';
import { CONTACT_OPTIONS, waLink, type ContactKey } from './contact';
import { MessengerLink, copyNow } from './MessengerLink';
import { sendShopRequestAction, type RequestKind } from './requestActions';

export function SendPanel({ slug, kind, title, itemId, total, message, name, mobile, problem, onTry, contacts, askContact = false, setName, setMobile, label = 'Send request to the store' }: {
  slug: string; kind: RequestKind; title: string; itemId?: string | null; total?: number | null; message: string;
  name: string; mobile: string; problem: string; onTry?: () => void;
  contacts: { messenger: string | null; whatsapp: string | null };
  /** show name + mobile fields here (the quick "Ask about this item") */
  askContact?: boolean; setName?: (v: string) => void; setMobile?: (v: string) => void; label?: string;
}) {
  const [via, setVia] = useState<ContactKey>('viber');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<{ number: number; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  async function send() {
    onTry?.(); setError('');
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      const r = await sendShopRequestAction(slug, { kind, title, name, mobile, message, total: total ?? null, itemId: itemId ?? null, contact: via });
      if (r.ok) setSent({ number: r.number, token: r.token }); else setError(r.error);
    } catch { setError('The request could not be sent. Check your connection, or message the store.'); }
    setBusy(false);
  }
  if (sent) {
    const short = `Hi! I sent request #${sent.number} (${title}) on your online shop. — ${name.trim()}`;
    const chosen = CONTACT_OPTIONS.find((c) => c.key === via)?.label ?? via;
    return (
      <section className="space-y-3 rounded-2xl bg-emerald-50 p-4 text-emerald-950" role="status" data-testid="request-sent">
        <h3 className="text-lg font-extrabold">Request #{sent.number} sent ✓</h3>
        <p className="text-sm">The store has your request and your number. {via === 'messenger' ? 'Start the chat on Messenger so they can reply:' : via === 'call' ? 'They will call you.' : `They will contact you by ${chosen}.`}</p>
        {via === 'messenger' && contacts.messenger && (
          <MessengerLink url={contacts.messenger} text={short} onCopied={() => setCopied(true)} className="flex min-h-[48px] items-center justify-center rounded-xl bg-[#0866ff] text-sm font-bold text-white">Chat with the store on Messenger</MessengerLink>
        )}
        {via === 'whatsapp' && contacts.whatsapp && (
          <a href={waLink(contacts.whatsapp, short)} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center rounded-xl bg-[#25d366] text-sm font-bold text-white">Tell the store on WhatsApp</a>
        )}
        {copied && <p className="text-xs">Message copied — paste it in the chat (press and hold, Paste; on a computer Ctrl+V).</p>}
        <Link href={`/shop/${slug}/r/${sent.token}`} className="block text-sm font-bold underline">Track request #{sent.number} — bookmark this page</Link>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-2xl border-2 border-[rgb(var(--btn))] bg-white p-4" aria-label="Send request to the store">
      {askContact && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">Your name *<input value={name} onChange={(e) => setName?.(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" autoComplete="name" /></label>
          <label className="block text-sm">Mobile *<input value={mobile} onChange={(e) => setMobile?.(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" /></label>
        </div>
      )}
      <fieldset className="min-w-0"><legend className="text-sm font-bold">How should the store contact you?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CONTACT_OPTIONS.filter((c) => c.key !== 'messenger' || contacts.messenger).map((c) => (
            <button key={c.key} type="button" aria-pressed={via === c.key} onClick={() => setVia(c.key)}
              className={`min-h-[40px] rounded-full border px-3.5 text-sm font-semibold ${via === c.key ? 'border-[rgb(var(--btn))] bg-[rgb(var(--btn))] text-[rgb(var(--on-btn))]' : 'bg-white'}`}>{c.label}</button>
          ))}
        </div>
      </fieldset>
      <button type="button" onClick={send} disabled={busy} className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[rgb(var(--btn))] text-[15px] font-extrabold text-[rgb(var(--on-btn))] disabled:opacity-60">
        {busy ? 'Sending…' : label}
      </button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p className="text-[11px] text-slate-500">Your name, mobile number and request go to this store, which keeps them to reply to you. No payment is taken here.</p>
      {contacts.whatsapp && (
        <a href={waLink(contacts.whatsapp, message)} target="_blank" rel="noopener noreferrer" onClick={(e) => { onTry?.(); if (problem) { e.preventDefault(); setError(problem); } else copyNow(message); }}
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#25d366] text-sm font-bold text-white">Or send it on WhatsApp</a>
      )}
    </section>
  );
}
