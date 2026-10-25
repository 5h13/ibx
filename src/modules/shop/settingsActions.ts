'use server';
// Build 136 — the store's online shop settings (contacts by the Business Admin; on / off by the Super Admin).
// Build 137 — layout, Facebook link, front-page sections, featured product, slideshow, announcements / promotions.
// Build 139 — banner photo (upload / remove) and WhatsApp.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
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
  // Build 141: a Studio picture is removed with its post
  const { data: post } = await createClient().from('shop_posts').select('image_path').eq('id', id).maybeSingle();
  await rpc('shop_post_delete', { p_id: id });
  if ((post as any)?.image_path) await createAdminClient().storage.from('business-logos').remove([String((post as any).image_path)]);
  refresh();
  return { ok: true };
}

// Build 139 — the banner photo behind the shop header (from 5h13Shops Build 3). Stored in the store's own folder of
// the public logo bucket; the database checks who may change it and that the file is in the store's folder.
const BANNER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export async function uploadShopBannerAction(businessId: string, fd: FormData) {
  await admin();
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) throw appError('Choose a banner photo.');
  const ext = BANNER_TYPES[file.type];
  if (!ext) throw appError('The banner must be a JPG, PNG or WebP photo.');
  if (file.size > 3_000_000) throw appError('The banner is too large (3 MB at most).');
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw appError('Store not found.');
  const path = `${businessId}/shop-banner-${crypto.randomUUID()}.${ext}`;
  const store = createAdminClient().storage.from('business-logos');
  const up = await store.upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw appError(`The banner could not be saved: ${up.error.message}`);
  const { data: old, error } = await createClient().rpc('shop_banner_set', { p_business: businessId, p_path: path });
  if (error) { await store.remove([path]); throw appError(error.message); }
  if (old) await store.remove([String(old)]);
  refresh();
  return { ok: true };
}

export async function removeShopBannerAction(businessId: string) {
  await admin();
  const { data: old, error } = await createClient().rpc('shop_banner_set', { p_business: businessId, p_path: null });
  if (error) throw appError(error.message);
  if (old) await createAdminClient().storage.from('business-logos').remove([String(old)]);
  refresh();
  return { ok: true };
}
