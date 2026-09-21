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

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, email, full_name, role, section_id, is_active')
    .eq('id', authUser.id)
    .single();

  if (userErr || !userRow) return null;

  const { data: accessRows } = await supabase
    .from('user_access')
    .select('section_id, workflow_role')
    .eq('user_id', authUser.id);

  return {
    user: userRow,
    access: accessRows ?? [],
  };
}
