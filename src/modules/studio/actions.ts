'use server';
// Build 141 (from 5h13Shops Builds 11, 12.2): save the store's headline font; post a Studio picture on the store's
// online shop as the promotion or as an announcement. The picture goes to the store's folder in the public logo bucket
// (business-logos); the database checks who may post and that the picture is in the store's own folder.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { appError } from '@/core/errors/appError';

const BUCKET = 'business-logos';

async function store() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!p.user.business_id) throw appError('Choose a store in "Acting as" first.');
  return p.user.business_id;
}

export async function saveStudioFontAction(font: string) {
  await store();
  const { error } = await createClient().rpc('studio_font_save', { p_font: font });
  if (error) throw appError(error.message);
}

/** Posts a Studio picture as this store's promotion (the newest shows at the top of the shop) or as an announcement. */
export async function postStudioImageAction(fd: FormData) {
  const b = await store();
  const kind = String(fd.get('kind') ?? 'promo') === 'announcement' ? 'announcement' : 'promo';
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) throw appError('The picture is missing. Try again.');
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw appError('The picture must be PNG or JPG.');
  if (file.size > 5_000_000) throw appError('The picture is too large (5 MB at most).');
  const endsOn = String(fd.get('ends_on') ?? '').trim();
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw appError('Check the end date.');
  // who may post is checked first, so no file is stored for someone who may not
  const db = createClient();
  const { data: ok } = await db.rpc('studio_access', { p_business: b });
  if (!ok) throw appError('Only the store\'s sales and marketing people post Studio pictures.');
  const path = `${b}/studio-${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
  const bucket = createAdminClient().storage.from(BUCKET);
  const up = await bucket.upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw appError(`The picture could not be saved: ${up.error.message}`);
  const { error } = await db.rpc('studio_post', { p: {
    kind, title: String(fd.get('title') ?? '').trim().slice(0, 120), ends_on: endsOn || null, image_path: path,
    item_id: String(fd.get('product_id') ?? '').trim() || null,
  } });
  if (error) { await bucket.remove([path]); throw appError(error.message); }
  revalidatePath('/sales/online-shop'); revalidatePath('/shop', 'layout');
  return { ok: true as const };
}
