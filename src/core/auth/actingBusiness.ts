// src/core/auth/actingBusiness.ts
//
// A001 completion: the Global Super Admin (role==='super_admin') has no
// business of their own — user.business_id is null in the database, by
// design, since they operate above every business. But once more than one
// business exists, any write action they take still has to land somewhere:
// "acting business" is a lightweight, cookie-based context that lets the
// Global Super Admin pick which business their own writes (new users, new
// records created while impersonating a business context, etc.) should be
// tagged with. Build 59: it now ALSO filters what they see — the choice is
// stored in users.acting_business_id and the restrictive isolation policies
// honour it (migration 20261112). "5H13 (all businesses)" = see everything.
//
// It is validated against the real businesses table on every read (not just
// trusted blindly from the cookie), since a stale/deleted business id must
// never silently resolve to something real.

import { cookies } from 'next/headers';
import { createClient } from './supabaseServer';

const COOKIE_NAME = 'ibx_acting_business';

/** Reads and validates the Global Super Admin's selected acting-business
 * cookie. Returns null if unset, invalid, or pointing at an inactive/
 * deleted business — callers should treat null exactly as "no business
 * selected yet" (the prior, pre-A001-completion behavior). */
export async function getActingBusinessId(): Promise<string | null> {
  // Build 59: the selection lives on the Super Admin's users row
  // (users.acting_business_id) so the database's isolation policies can
  // apply it; super_admin_view_business() also checks the business is active.
  const db = createClient();
  const { data, error } = await db.rpc('super_admin_view_business');
  if (!error) return (data as string | null) ?? null;
  // Migration 20261112 not applied yet: fall back to the old cookie.
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const { data: b } = await db.from('businesses').select('id').eq('id', raw).eq('is_active', true).maybeSingle();
  return b?.id ?? null;
}

export function actingBusinessCookieName(): string {
  return COOKIE_NAME;
}
