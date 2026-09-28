// src/core/auth/requireSection.ts
//
// Call at the top of a section page (server component) to enforce access.
// Redirects to /login if unauthenticated.
//
// Build 58: this now actually enforces the section. Before, it accepted the
// section argument and ignored it, so every Finance / Sales / Marketing /
// Logistics / Admin page using it opened for ANY signed-in user who typed
// the URL (the sidebar merely hid the link; RLS still limited the rows).
// Allowed: admin tier (Super Admin / Business Admin), or a user whose home
// section, app role or any workflow grant is that section — the same test the
// sidebar uses to show the section's menu group. Anyone else is sent to the
// dashboard.

import { redirect } from 'next/navigation';
import { getSessionProfile } from './getSessionProfile';
import { isAdminTier, type SectionCode, type SessionProfile } from './types';

export function hasSectionAccess(profile: SessionProfile | null, section: SectionCode): boolean {
  if (!profile) return false;
  if (isAdminTier(profile)) return true;
  return profile.user.section_code === section || profile.user.role === section || profile.access.some((a) => a.section_code === section);
}

export async function requireSection(section: SectionCode): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!hasSectionAccess(profile, section)) redirect('/dashboard');
  return profile as SessionProfile;
}

/** Any signed-in user (for pages meant for every employee, e.g. Policies). */
export async function requireSignedIn(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  return profile as SessionProfile;
}
