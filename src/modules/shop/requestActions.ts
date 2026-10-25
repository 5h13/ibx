'use server';
// Build 139 (from 5h13Shops Build 10): a buyer sends a question or a request for quotation to the store. It is saved
// for the store's Inbox (the store's sales people are notified in the app), and the buyer gets a request number and a
// private status page. Email to the store comes in Build 140.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { appError } from '@/core/errors/appError';

export type RequestKind = 'ask' | 'quote';
export type ContactVia = 'viber' | 'whatsapp' | 'text' | 'call' | 'messenger';
export type SendInput = { kind: RequestKind; title: string; name: string; mobile: string; message: string; total?: number | null; itemId?: string | null; contact: ContactVia };

export async function sendShopRequestAction(slug: string, p: SendInput): Promise<{ ok: true; number: number; token: string } | { ok: false; error: string }> {
  const name = String(p?.name ?? '').trim(), mobile = String(p?.mobile ?? '').replace(/[^\d+]/g, '');
  if (!name || name.length > 80) return { ok: false, error: 'Enter your name.' };
  if (!/^\+?\d{7,15}$/.test(mobile)) return { ok: false, error: 'Enter your mobile number, e.g. 0917 123 4567.' };
  if (p.kind !== 'ask' && p.kind !== 'quote') return { ok: false, error: 'This request could not be sent.' };
  const message = String(p?.message ?? '').trim();
  if (!message) return { ok: false, error: 'This request is empty.' };
  const total = typeof p.total === 'number' && Number.isFinite(p.total) && p.total >= 0 ? Math.round(p.total * 100) / 100 : null;
  const itemId = p.itemId && /^[0-9a-f-]{36}$/i.test(p.itemId) ? p.itemId : null;
  const { data, error } = await createClient().rpc('shop_send_request', {
    p_slug: slug, p_kind: p.kind, p_title: String(p.title ?? '').trim().slice(0, 200), p_name: name, p_mobile: mobile,
    p_message: message.slice(0, 8000), p_total: total, p_item: itemId,
    p_contact: ['viber', 'whatsapp', 'text', 'call', 'messenger'].includes(p.contact) ? p.contact : 'text',
  });
  if (error || !data) return { ok: false, error: (error?.message ?? '').replace(/^.*?ERROR:\s*/, '') || 'The request could not be sent. Please message the store.' };
  return { ok: true, number: Number((data as { number: number }).number), token: String((data as { token: string }).token) };
}

/** Staff: Confirmed / Not available / Done, with a note the buyer sees on their request page. */
export async function answerShopRequestAction(id: string, status: 'confirmed' | 'unavailable' | 'done', note: string) {
  const { error } = await createClient().rpc('shop_request_answer', { p_id: id, p_status: status, p_note: note.trim().slice(0, 500) || null });
  if (error) throw appError(error.message);
  // no revalidate: the card keeps showing with "Saved" until the Inbox is opened again (as in 5h13Shops)
  return { ok: true };
}

export async function refreshInboxAction() {
  revalidatePath('/manager/inbox'); revalidatePath('/sales/shop-inbox');
}
