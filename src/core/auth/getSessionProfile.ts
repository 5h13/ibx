// src/core/auth/getSessionProfile.ts
//
// Loads public.users + public.user_access for the current session.
// Use in server components / route handlers to build a SessionProfile.

import { createClient } from './supabaseServer';
import type { SessionProfile } from './types';

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  // These two queries don't depend on each other, so fire them together
  // instead of waiting on one before starting the next.
  const [{ data: userRow, error: userErr }, { data: accessRows }] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, full_name, role, section_id, is_active')
      .eq('id', authUser.id)
      .single(),
    supabase
      .from('user_access')
      .select('section_id, workflow_role')
      .eq('user_id', authUser.id),
  ]);

  if (userErr || !userRow) return null;

  return {
    user: userRow,
    access: accessRows ?? [],
  };
}
