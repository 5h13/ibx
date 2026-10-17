'use client';
// Build 136a — Messenger button for the public shop. On phones the m.me link opens a chat with the page in the
// Messenger app (with the message filled in). On computers Facebook now sends m.me links to the Messenger home
// page instead of the page's chat, so there the button opens the Facebook page (its Message button starts the
// chat) and copies the prepared message so the visitor can paste it.
import { useEffect, useState } from 'react';

const isPhone = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024));

export function messengerLinks(url: string, text?: string) {
  const m = /^https:\/\/m\.me\/([^/?#]+)/i.exec(url);
  const page = m ? `https://www.facebook.com/${m[1]}` : url;
  const phone = m ? `${url}${text ? `${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(text)}` : ''}` : url;
  return { phone, page };
}

export function MessengerLink({ url, text, className, children }: { url: string; text?: string; className?: string; children: React.ReactNode }) {
  const [phone, setPhone] = useState(true);
  const [note, setNote] = useState(false);
  useEffect(() => setPhone(isPhone()), []);
  const l = messengerLinks(url, text);
  return (
    <>
      <a href={phone ? l.phone : l.page} target="_blank" rel="noopener noreferrer" className={className}
        onClick={() => { if (!phone && text) { navigator.clipboard?.writeText(text).then(() => { setNote(true); setTimeout(() => setNote(false), 6000); }).catch(() => {}); } }}>
        {children}
      </a>
      {note && <span role="status" className="col-span-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Message copied — on the Facebook page, press <b>Message</b> and paste it.</span>}
    </>
  );
}
