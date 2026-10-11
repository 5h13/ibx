'use server';
// Build 104 — sign in with a username or an email. The username is turned into the account's login email on the
// server (never sent to the browser), then the password is checked; the session cookies are set here.
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';

const WRONG = 'Wrong username / email or password.';

export async function signInAction(identifier: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = String(identifier ?? '').trim();
  if (!id || !password) return { ok: false, error: 'Enter your username (or email) and password.' };
  let email = id.toLowerCase();
  if (!id.includes('@')) {
    const { data, error } = await createAdminClient().rpc('login_email_for', { p_username: id });
    if (error || !data) return { ok: false, error: WRONG };
    email = String(data);
  }
  const { error } = await createClient().auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: /invalid login credentials/i.test(error.message) ? WRONG : error.message };
  return { ok: true };
}
