'use client';
// Build 139 (from 5h13Shops Build 10): on the buyer's request page — message the store about request #n (WhatsApp fills the text in).
import { MessengerLink } from './MessengerLink';
import { telLink, waLink } from './contact';

export function RequestContact({ number, name, messenger, viber, whatsapp, phone }: { number: number; name: string; messenger: string | null; viber: string | null; whatsapp: string | null; phone: string | null }) {
  const text = `Hi! About my request #${number}. — ${name}`;
  const btn = 'flex min-h-[46px] items-center justify-center rounded-xl text-sm font-bold';
  if (!messenger && !viber && !whatsapp && !phone) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold">Message the store about this request</h2>
      <div className="grid grid-cols-2 gap-2">
        {whatsapp && <a href={waLink(whatsapp, text)} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25d366] text-white`}>WhatsApp</a>}
        {messenger && <MessengerLink url={messenger} text={text} className={`${btn} bg-[#0866ff] text-white`}>Messenger</MessengerLink>}
        {viber && <a href={`viber://chat?number=${encodeURIComponent(viber)}&draft=${encodeURIComponent(text)}`} className={`${btn} bg-[#7360f2] text-white`}>Viber</a>}
        {phone && <a href={telLink(phone)} className={`${btn} border bg-white`}>Call</a>}
      </div>
    </section>
  );
}
