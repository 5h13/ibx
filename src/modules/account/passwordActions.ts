'use server';
// Build 72 (U065) — a signed-in user sets their own password: after an
// invitation / reset link, when forced after an admin-set password, or any
// time from My Account. Clears users.must_change_password.
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';

export async function setOwnPasswordAction(input: { password: string; confirm: string }) {
  const db = createClient();
  const { data: { user }, error: ue } = await db.auth.getUser();
  if (ue || !user) throw appError('Your sign-in link has expired or is not valid. Ask your administrator for a new one.');
  const password = String(input.password ?? '');
  if (password.length < 8) throw appError('Use at least 8 characters.');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw appError('Use letters and at least one number.');
  if (password !== String(input.confirm ?? '')) throw appError('The two passwords do not match.');
  const { error } = await db.auth.updateUser({ password });
  if (error) throw appError(error.message.includes('different from the old') ? 'Choose a password different from the current one.' : error.message);
  // the user row may not be readable / writable by the user under RLS: clear the flag server-side, own row only
  const admin = createAdminClient();
  const { error: fe } = await admin.from('users').update({ must_change_password: false, updated_at: new Date().toISOString() }).eq('id', user.id);
  if (fe && !/updated_at/.test(fe.message)) throw appError(fe.message);
  if (fe) await admin.from('users').update({ must_change_password: false }).eq('id', user.id);
  await admin.from('audit_log').insert({ actor_id: user.id, entity_table: 'users', entity_id: user.id, action: 'password_changed_by_user', detail: {} });
  return { ok: true };
}
