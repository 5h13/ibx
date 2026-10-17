// Build 134 — phone links: call, and text with a ready message (the phone's own messaging app opens;
// the message can be edited before sending). "sms:NUMBER?&body=" works on both Android and iPhone.
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
export const smsHref = (phone: string, body?: string) =>
  `sms:${phone.replace(/[^\d+]/g, '')}${body ? `?&body=${encodeURIComponent(body)}` : ''}`;
export const pesoText = (n: unknown) => `₱${Math.round(Number(n || 0)).toLocaleString('en-PH')}`;
