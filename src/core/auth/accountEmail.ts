// server-side only (imported by server actions)
// Build 104 — the one place an account's login email changes (My Profile, or an admin in Settings → Users).
// A real email replaces the hidden login-only address; "Forgot password" emails work from then on.
import { appError } from '@/core/errors/appError';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { EMAIL_RE, isLoginOnlyEmail } from './loginEmail';

export async function setAccountEmail(userId: string, raw: string, actorId: string) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || isLoginOnlyEmail(email)) throw appError('Enter a valid email address.');
  const admin = createAdminClient();
  const { data: taken } = await admin.from('users').select('id').eq('email', email).neq('id', userId).maybeSingle();
  if (taken) throw appError('That email is already used by another account.');
  const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
  if (error) throw appError(/already|registered|exists/i.test(error.message) ? 'That email is already used by another account.' : error.message);
  const { error: ue } = await admin.from('users').update({ email, email_is_login_only: false }).eq('id', userId);
  if (ue) throw appError(ue.message);
  await admin.from('audit_log').insert({ actor_id: actorId, entity_table: 'users', entity_id: userId, action: 'email_changed', detail: { email } });
  return email;
}
