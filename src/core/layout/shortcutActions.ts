'use server';
// Build 82 — save the signed-in user's 5H13 Shortcuts (ordered list of keys).
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

export async function saveShortcutsAction(keys: string[]) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!Array.isArray(keys) || keys.length > 40 || keys.some((k) => typeof k !== 'string' || k.length > 200)) throw appError('Invalid shortcuts.');
  const clean = Array.from(new Set(keys));
  const { error } = await createClient().from('user_shortcuts').upsert({ user_id: p.user.id, items: clean, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw appError(error.message);
  revalidatePath('/', 'layout');
  return clean;
}
