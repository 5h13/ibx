// Build 139: the shop Inbox's data, shared by the Sales Manager app and the office app. Opening the Inbox marks new
// requests "seen" (after the page is sent, so the cards still show "New" this time).
import { after } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { siteOrigin } from './data';
import type { InboxRequest } from './InboxList';

export type InboxShow = 'open' | 'done' | 'all';

export async function loadInbox(businessId: string, showParam?: string) {
  const show: InboxShow = showParam === 'all' ? 'all' : showParam === 'done' ? 'done' : 'open';
  const db = createClient();   // made here: cookies() cannot be read inside after()
  let q = db.from('shop_requests')
    .select('id, number, kind, item_code, title, buyer_name, buyer_mobile, contact_via, message, total, status, reply_note, token, created_at')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(100);
  if (show === 'open') q = q.in('status', ['new', 'seen']);
  if (show === 'done') q = q.in('status', ['confirmed', 'unavailable', 'done']);
  const [{ data }, { data: shop }, { data: biz }] = await Promise.all([
    q,
    db.from('shop_settings').select('slug').eq('business_id', businessId).maybeSingle(),
    db.from('businesses').select('legal_name, trade_name').eq('id', businessId).maybeSingle(),
  ]);
  const list = (data ?? []) as InboxRequest[];
  if (list.some((r) => r.status === 'new')) after(async () => { await db.rpc('shop_inbox_seen'); });
  const origin = await siteOrigin();
  return {
    show, list,
    storeName: ((biz as any)?.trade_name || (biz as any)?.legal_name || 'our store') as string,
    shop: `${origin}/shop/${(shop as any)?.slug ?? ''}`,
  };
}
