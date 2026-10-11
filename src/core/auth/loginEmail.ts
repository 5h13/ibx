// Build 104 — accounts without an email. The sign-in system needs an email behind every account, so a user added
// without one gets a hidden address on a reserved domain (".invalid" can never receive mail). It is never shown and
// never emailed; a real email added later replaces it. Override the domain with NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN.
export const LOGIN_EMAIL_DOMAIN = (process.env.NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN || 'nomail.5h13.invalid').toLowerCase();
export const isLoginOnlyEmail = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
/** the email to show for a user: blank for the hidden login-only address */
export const shownEmail = (email: string | null | undefined) => (email && !isLoginOnlyEmail(email) ? email : '');
export const newLoginOnlyEmail = () => `${crypto.randomUUID()}@${LOGIN_EMAIL_DOMAIN}`;
/** the name to show on screens: nickname, else full name, else username */
export const displayName = (u: { nickname?: string | null; full_name?: string | null; username?: string | null; email?: string | null }) =>
  u.nickname || u.full_name || u.username || shownEmail(u.email) || 'User';
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
