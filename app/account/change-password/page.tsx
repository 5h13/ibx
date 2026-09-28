// Build 72 (U065) — change your password. Forced after an admin sets or
// resets it (users.must_change_password), and available from My Account.
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthCard } from '@/modules/account/AuthCard';
import { ChangePasswordClient } from './ChangePasswordClient';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const forced = !!profile.user.must_change_password;
  return (
    <AuthCard title={forced ? 'Choose a new password' : 'Change password'} subtitle={profile.user.email}>
      <p className="text-sm text-slate-600">{forced
        ? 'Your password was set by an administrator. Choose your own password to continue.'
        : 'Enter a new password for your account.'}</p>
      <ChangePasswordClient forced={forced} />
    </AuthCard>
  );
}
