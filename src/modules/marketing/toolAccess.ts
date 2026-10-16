// Build 124 — who may use the marketing tools' catalog service: signed in, with Marketing access
// (Marketing staff, Business Admin, Super Admin) — the same as the Marketing menu.
import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';

export async function marketingToolUser() {
  const profile = await getSessionProfile();
  if (!profile) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) };
  if (!hasSectionAccess(profile, 'marketing')) return { error: NextResponse.json({ error: 'Marketing access is required.' }, { status: 403 }) };
  return { profile };
}
export const PHOTO_COLUMNS = ['photo_path', 'photo_path_2', 'photo_path_3'] as const;
