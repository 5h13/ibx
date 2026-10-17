'use server';
// Build 136 — the store's online shop settings (contacts by the Business Admin; on / off by the Super Admin).
// Build 137 — layout, Facebook link, front-page sections, featured product, slideshow, announcements / promotions.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

async function admin() {
  const p = await getSessionProfile();
  if (!p?.user.is_active || !isAdminTier(p)) throw appError('Only the Business Admin or the Super Admin changes the online shop settings.');
  return p;
}
async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw appError(error.message);
  return data as T;
}
function refresh() { revalidatePath('/sales/online-shop'); revalidatePath('/shop', 'layout'); }

export async function saveShopSettingsAction(businessId: string, settings: Record<string, string | boolean | null>) {
  await admin();
  await rpc('shop_settings_save', { p_business: businessId, p: settings });
  refresh();
  return { ok: true };
}

export async function searchShopItemsAction(q: string) {
  await admin();
  return rpc<{ item_id: string; item_name: string; category: string | null; brand: string | null }[]>('shop_admin_items', { p_q: q });
}

export async function shopFiltersAction(category: string, item: string, brand: string) {
  await admin();
  return rpc<{ categories: string[]; items: string[]; brands: string[]; count: number }>('shop_admin_filters', { p_category: category || null, p_item: item || null, p_brand: brand || null });
}

export async function saveShopPostAction(post: Record<string, string | boolean | null>) {
  await admin();
  const id = await rpc<string>('shop_post_save', { p: post });
  refresh();
  return { id };
}

export async function deleteShopPostAction(id: string) {
  await admin();
  await rpc('shop_post_delete', { p_id: id });
  refresh();
  return { ok: true };
}
