'use server';
// Build 104 — My Profile: username, nickname, and adding / changing the email.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { setAccountEmail } from '@/core/auth/accountEmail';

export async function updateMyLoginAction(username: string, nickname: string) {
  const p = await getSessionProfile();
  if (!p) throw appError('Sign in first.');
  const { error } = await createClient().rpc('profile_update', { p_username: username, p_nickname: nickname });
  if (error) throw appError(error.message);
  revalidatePath('/', 'layout');
}

export async function updateMyEmailAction(email: string) {
  const p = await getSessionProfile();
  if (!p) throw appError('Sign in first.');
  await setAccountEmail(p.user.id, email, p.user.id);
  revalidatePath('/', 'layout');
}
