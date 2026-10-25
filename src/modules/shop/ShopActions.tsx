'use client';
// Build 136 — on an item page: ask the store about the item (Messenger / Viber / text / call) and share the link.
// Build 139 (from 5h13Shops Builds 4.2 and 10): WhatsApp (fills the message in), the item code in every message,
// and "Send your question here" — saved for the store's Inbox, with the buyer's choice of how to be contacted.
import { useEffect, useState } from 'react';
import { MessengerLink, copyNow } from './MessengerLink';
import { SendPanel } from './SendPanel';
import { waLink } from './contact';

export function ShopActions({ slug, itemId, code, name, price, amount = null, messenger, viber, whatsapp, phone, available }: {
  slug: string; itemId: string; code: string | null; name: string; price: string | null; amount?: number | null;
  messenger: string | null; viber: string | null; whatsapp: string | null; phone: string | null; available?: boolean | null;
}) {
  const [buyer, setBuyer] = useState('');
  const [mobile, setMobile] = useState('');
  const [copied, setCopied] = useState(false);
  const [askCopied, setAskCopied] = useState(false);
  const noteCopied = () => { setAskCopied(true); setTimeout(() => setAskCopied(false), 8000); };
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(window.location.href), []);
  const ask = `Hi! I'd like to ask about: ${name}${code ? ` [${code}]` : ''}${price ? ` (${price})` : ''}.\n${available === false ? 'How long is the lead time if I order it?' : 'Is it available?'}${url ? `\n${url}` : ''}`;
  const tel = phone ? phone.replace(/[^\d+]/g, '') : null;
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: name, text: price ? `${name} — ${price}` : name, url: window.location.href }); return; }
      await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* closed by the user */ }
  };
  const btn = 'flex min-h-[48px] items-center justify-center rounded-xl text-sm font-bold';
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-slate-500">Ask about this item</div>
      <div className="grid grid-cols-2 gap-2">
        {whatsapp && <a href={waLink(whatsapp, ask)} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25d366] text-white`}>WhatsApp</a>}
        {messenger && <MessengerLink url={messenger} text={ask} onCopied={noteCopied} className={`${btn} bg-[#0866ff] text-white`}>Messenger</MessengerLink>}
        {viber && <a href={`viber://chat?number=${encodeURIComponent(viber)}&draft=${encodeURIComponent(ask)}`} onClick={() => { if (copyNow(ask)) noteCopied(); }} className={`${btn} bg-[#7360f2] text-white`}>Viber</a>}
        {tel && <a href={`sms:${tel}?&body=${encodeURIComponent(ask)}`} className={`${btn} border bg-white`}>Text</a>}
        {tel && <a href={`tel:${tel}`} className={`${btn} border bg-white`}>Call</a>}
      </div>
      {askCopied && <div role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Your message about this item is copied — in the chat, press and hold the message box and choose <b>Paste</b> (on a computer: <b>Ctrl+V</b>).</div>}
      {!askCopied && (messenger || viber) && <p className="text-[11px] text-slate-500">Messenger / Viber: we copy a message about this item for you to paste in the chat.</p>}
      <details className="rounded-2xl bg-white p-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-bold text-[rgb(var(--btn))]">Or send your question here — the store replies to your number</summary>
        <div className="mt-3">
          <SendPanel slug={slug} kind="ask" title={name} itemId={itemId} total={amount}
            message={`${ask}${buyer.trim() ? `\nName: ${buyer.trim()}` : ''}${mobile.trim() ? `\nMobile: ${mobile.trim()}` : ''}`}
            name={buyer} mobile={mobile} askContact setName={setBuyer} setMobile={setMobile}
            problem={!buyer.trim() || !mobile.trim() ? 'Enter your name and mobile number.' : ''}
            contacts={{ messenger, whatsapp }} label="Send my question" />
        </div>
      </details>
      <button type="button" onClick={share} className={`${btn} w-full border bg-white`}>{copied ? 'Link copied' : 'Share this item'}</button>
    </div>
  );
}
