'use client';
// Build 136 — on an item page: ask the store about the item (Messenger / Viber / text / call) and share the link.
import { useEffect, useState } from 'react';
import { MessengerLink } from './MessengerLink';

export function ShopActions({ name, price, messenger, viber, phone }: { name: string; price: string | null; messenger: string | null; viber: string | null; phone: string | null }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(window.location.href), []);
  const ask = `Hi! I'd like to ask about: ${name}${price ? ` (${price})` : ''}. Is it available?${url ? `\n${url}` : ''}`;
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
        {messenger && <MessengerLink url={messenger} text={ask} className={`${btn} bg-[#0866ff] text-white`}>Messenger</MessengerLink>}
        {viber && <a href={`viber://chat?number=${encodeURIComponent(viber)}&draft=${encodeURIComponent(ask)}`} className={`${btn} bg-[#7360f2] text-white`}>Viber</a>}
        {tel && <a href={`sms:${tel}?&body=${encodeURIComponent(ask)}`} className={`${btn} border bg-white`}>Text</a>}
        {tel && <a href={`tel:${tel}`} className={`${btn} border bg-white`}>Call</a>}
      </div>
      <button type="button" onClick={share} className={`${btn} w-full border bg-white`}>{copied ? 'Link copied' : 'Share this item'}</button>
    </div>
  );
}
