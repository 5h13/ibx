// Build 120 — where sign-in (and opening the installed app) lands: My Profile until the person has
// clocked in today (staff with an employee record), otherwise the Dashboard as before.
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { landingFor } from '@/modules/profile/myTime';

export const dynamic = 'force-dynamic';

export default async function StartPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.user.must_change_password || profile.audit) redirect('/dashboard');
  let to: string = '/dashboard';
  try { to = await landingFor(profile.user.id); } catch { /* never block sign-in over this */ }
  redirect(to);
}
