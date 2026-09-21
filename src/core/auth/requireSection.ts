// src/core/auth/requireSection.ts
//
// Call at the top of a section page (server component) to enforce access.
// Redirects to /login if unauthenticated. Does NOT throw for users outside
// the section — the underlying Supabase queries are already scoped by RLS,
// so a user with no access to the section simply sees no rows. This keeps
// the "staff sees only totals" rule (build plan section 4) enforceable at
// the query level rather than duplicating it here.

import { redirect } from 'next/navigation';
import { getSessionProfile } from './getSessionProfile';
import type { SectionCode, SessionProfile } from './types';

export async function requireSection(_section: SectionCode): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) {
    redirect('/login');
  }
  return profile as SessionProfile;
}
