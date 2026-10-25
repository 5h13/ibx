// Build 139 (from 5h13Shops Build 10): links that open a chat with a number (client-safe). WhatsApp fills in the message; Viber opens the chat.
export const CONTACT_OPTIONS = [
  { key: 'viber', label: 'Viber' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'text', label: 'Text' },
  { key: 'call', label: 'Call' }, { key: 'messenger', label: 'Messenger' },
] as const;
export type ContactKey = (typeof CONTACT_OPTIONS)[number]['key'];

/** 0917 123 4567 → 639171234567 (no +), for wa.me and Viber. Other countries: digits as written. */
export function intlDigits(n: string) {
  const d = n.replace(/[^\d]/g, '');
  if (/^0\d{10}$/.test(d)) return `63${d.slice(1)}`;
  if (/^9\d{9}$/.test(d)) return `63${d}`;
  return d;
}
export const waLink = (n: string, text?: string) => `https://wa.me/${intlDigits(n)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const viberLink = (n: string, text?: string) => `viber://chat?number=%2B${intlDigits(n)}${text ? `&draft=${encodeURIComponent(text)}` : ''}`;
export const smsLink = (n: string, text?: string) => `sms:${n.replace(/[^\d+]/g, '')}${text ? `?&body=${encodeURIComponent(text)}` : ''}`;
export const telLink = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;
