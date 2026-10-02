import { isAdminTier, type SessionProfile } from '@/core/auth/types';

/** RA-05: who may create, edit, publish and archive policies and announcements
 * (the same test the server actions and the admin_policies_write RLS apply).
 * Everyone else signed in only reads and acknowledges. */
export function canManagePolicies(profile: SessionProfile | null): boolean {
  if (!profile) return false;
  return isAdminTier(profile) || profile.user.section_code === 'admin' || profile.access.some((a) => a.section_code === 'admin');
}
