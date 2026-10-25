'use client';
// Build 137 — Request for quotation: the visitor lists the parts and quantities and their details; the request is
// written out as one message and sent to the store by Messenger, Viber or text (copied for pasting where the app
// does not fill it in). Nothing is stored in the system.
// Build 139 (from 5h13Shops Build 10): "Send request to the store" saves it for the store's Inbox, with a request
// number and a status page; sending it yourself (Messenger / Viber / WhatsApp / text) stays underneath.
import { useEffect, useState } from 'react';
import { MessengerLink, copyNow } from './MessengerLink';
import { SendPanel } from './SendPanel';
import { waLink } from './contact';

type Line = { what: string; qty: string };

export function QuoteForm({ slug, whatsapp, storeName, messenger, viber, phone, firstItem }: { slug: string; whatsapp: string | null; storeName: string; messenger: string | null; viber: string | null; phone: string | null; firstItem?: string }) {
  const [lines, setLines] = useState<Line[]>([{ what: firstItem ?? '', qty: '1' }, { what: '', qty: '' }]);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [place, setPlace] = useState('');
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem('shop-rfq-contact') || '{}'); if (d.name) setName(d.name); if (d.mobile) setMobile(d.mobile); if (d.place) setPlace(d.place); } catch { /* */ } }, []);
  const filled = lines.filter((l) => l.what.trim());
  const ok = filled.length > 0 && name.trim() && mobile.trim();
  const text = [
    `REQUEST FOR QUOTATION — ${storeName}`,
    '',
    ...filled.map((l, k) => `${k + 1}. ${l.what.trim()}${l.qty.trim() ? ` — qty ${l.qty.trim()}` : ''}`),
    '',
    `Name: ${name.trim()}`,
    `Mobile: ${mobile.trim()}`,
    place.trim() ? `Location / delivery: ${place.trim()}` : '',
    notes.trim() ? `Notes: ${notes.trim()}` : '',
  ].filter((x, k, a) => x !== '' || (a[k - 1] ?? '') !== '').join('\n').trim();
  const remember = () => { try { localStorage.setItem('shop-rfq-contact', JSON.stringify({ name, mobile, place })); } catch { /* */ } };
  const prep = (e?: { preventDefault: () => void }) => {
    setTried(true);
    if (!ok) { e?.preventDefault(); return false; }
    remember(); if (copyNow(text)) { setCopied(true); setTimeout(() => setCopied(false), 10000); }
    return true;
  };
  const set = (k: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === k ? { ...l, ...patch } : l)));
  const tel = phone ? phone.replace(/[^\d+]/g, '') : null;
  const btn = 'flex min-h-[50px] items-center justify-center rounded-xl text-sm font-bold';
  return (
    <div className="space-y-4">
      <section className="space-y-2.5 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-bold text-slate-900">What do you need?</h2>
        {lines.map((l, k) => (
          <div key={k} className="flex gap-2">
            <label className="min-w-0 flex-1"><span className="sr-only">Part {k + 1}</span>
              <input value={l.what} onChange={(e) => set(k, { what: e.target.value })} placeholder={k === 0 ? 'e.g. Blower motor Toyota Vios 2014' : 'Another part (optional)'} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
            <label className="w-20 flex-none"><span className="sr-only">Quantity</span>
              <input value={l.qty} onChange={(e) => set(k, { qty: e.target.value })} inputMode="numeric" placeholder="Qty" className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, { what: '', qty: '' }])} className="text-sm font-semibold text-[rgb(var(--btn))] underline">+ Add another part</button>
        {tried && !filled.length && <p className="text-xs text-red-700">Add at least one part.</p>}
      </section>
      <section className="space-y-2.5 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-bold text-slate-900">Your details</h2>
        <label className="block text-sm"><span className="font-medium">Name *</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
        <label className="block text-sm"><span className="font-medium">Mobile number *</span><input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="0917 123 4567" className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
        <label className="block text-sm"><span className="font-medium">Location / delivery address</span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="City or address (for delivery)" className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
        <label className="block text-sm"><span className="font-medium">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Car model and year, unit brand, how soon you need it…" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        {tried && (!name.trim() || !mobile.trim()) && <p className="text-xs text-red-700">Enter your name and mobile number so we can send you the quotation.</p>}
      </section>
      <SendPanel slug={slug} kind="quote" title={filled[0]?.what.trim().slice(0, 120) || 'Request for quotation'} message={text} name={name} mobile={mobile}
        problem={!filled.length ? 'Add at least one part.' : !name.trim() || !mobile.trim() ? 'Enter your name and mobile number so we can send you the quotation.' : ''}
        onTry={() => { setTried(true); remember(); }} contacts={{ messenger, whatsapp }} />
      <section className="space-y-2.5">
        <h2 className="font-bold text-slate-900">Or send it yourself to {storeName}</h2>
        <div className="grid grid-cols-2 gap-2">
          {whatsapp && <a href={waLink(whatsapp, text)} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!prep(e)) return; }} className={`${btn} bg-[#25d366] text-white`}>WhatsApp</a>}
          {messenger && <MessengerLink url={messenger} guard={() => prep()} className={`${btn} bg-[#0866ff] text-white`}>Messenger</MessengerLink>}
          {viber && <a href={`viber://chat?number=${encodeURIComponent(viber)}&draft=${encodeURIComponent(text)}`} onClick={(e) => prep(e)} className={`${btn} bg-[#7360f2] text-white`}>Viber</a>}
          {tel && <a href={`sms:${tel}?&body=${encodeURIComponent(text)}`} onClick={(e) => prep(e)} className={`${btn} border bg-white`}>Text message</a>}
          <button type="button" onClick={() => prep()} className={`${btn} border bg-white`}>Copy request</button>
        </div>
        {copied && <div role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Your request is copied — in the chat, press and hold the message box and choose <b>Paste</b>, then send.</div>}
        {ok && <pre className="whitespace-pre-wrap rounded-xl border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-700">{text}</pre>}
        <p className="text-[11px] text-slate-500">We reply with prices and availability. Your details are used only to answer your request.</p>
      </section>
    </div>
  );
}
