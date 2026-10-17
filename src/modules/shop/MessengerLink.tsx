'use client';
// Build 136a — Messenger button for the public shop. Phones: the m.me link opens the page's chat in the Messenger
// app. Computers: Facebook sends m.me links to the Messenger home page, so the button opens messenger.com/t/<page>
// (the page's chat; checked by the owner 2026-10-17).
// Build 136d: Messenger and Viber no longer fill in a message from a link reliably, so the prepared message is
// copied when the button is tapped (the visitor pastes it in the chat); the link still carries it where supported.
import { useEffect, useState } from 'react';

const isPhone = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024));

/** Copies at once, inside the tap (works before the page hands over to the app). */
export function copyNow(text: string): boolean {
  let ok = false;
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; t.style.top = '0';
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
    document.body.removeChild(t);
  } catch { /* fall through */ }
  try { navigator.clipboard?.writeText(text).catch(() => {}); ok = true; } catch { /* not available */ }
  return ok;
}

export function messengerLinks(url: string, text?: string) {
  const m = /^https:\/\/m\.me\/([^/?#]+)/i.exec(url);
  const page = m ? `https://www.messenger.com/t/${m[1]}` : url;
  const phone = m ? `${url}${text ? `${url.includes('?') ? '&' : '?'}text=${encodeURIComponent(text)}` : ''}` : url;
  return { phone, page };
}

export function MessengerLink({ url, text, className, children, onCopied }: { url: string; text?: string; className?: string; children: React.ReactNode; onCopied?: () => void }) {
  const [phone, setPhone] = useState(true);
  useEffect(() => setPhone(isPhone()), []);
  const l = messengerLinks(url, text);
  return (
    <a href={phone ? l.phone : l.page} target="_blank" rel="noopener noreferrer" className={className}
      onClick={() => { if (text && copyNow(text)) onCopied?.(); }}>
      {children}
    </a>
  );
}
