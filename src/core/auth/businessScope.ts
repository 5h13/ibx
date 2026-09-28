import { appError } from '@/core/errors/appError';
// src/core/auth/businessScope.ts
//
// Build 52 — business-isolation read-path hardening.
//
// Rule: server pages/routes read through the session-scoped client
// (`createClient()` from supabaseServer), so RLS's restrictive
// <table>_business_isolation policies apply. The service-role client
// (`createAdminClient()`) bypasses RLS entirely and must NOT be used for a
// page's list/register reads.
//
// The only sanctioned exceptions are the two narrow patterns below, used where
// a page legitimately needs data its viewers have no RLS read grant for
// (e.g. Finance's PO export showing Logistics receiving status). Both make the
// business boundary explicit in code instead of silently dropping it.

import type { SessionProfile } from './types';

/**
 * The business a service-role read must be confined to.
 * - Global Super Admin → the business chosen in "Acting as" (Build 59:
 *   the same scope RLS now applies to them), or null = all businesses.
 * - Everyone else → their own business_id. Throws if missing, rather than
 *   falling back to an unscoped read.
 */
export function readScopeBusinessId(profile: SessionProfile): string | null {
  if (profile.user.role === 'super_admin') return profile.user.business_id ?? null;
  if (!profile.user.business_id) throw appError('Your account is not assigned to a business.');
  return profile.user.business_id;
}

/**
 * Pattern 1: apply the explicit business filter to a service-role query on a
 * business-scoped table (one carrying business_id).
 */
export function scopeToBusiness<Q>(query: Q, profile: SessionProfile): Q {
  const businessId = readScopeBusinessId(profile);
  // Unconstrained generic on purpose: supabase-js's builder types are too deep
  // for a structural `eq` constraint (TS2589). Every filter builder has .eq().
  return businessId ? (query as any).eq('business_id', businessId) : query;
}

/**
 * Pattern 2: resolve related rows by ids that were themselves obtained from an
 * RLS-scoped query. The ids can only ever belong to the caller's own business,
 * so the service-role lookup cannot widen what they see. Chunked to keep the
 * PostgREST `in.(...)` URL a sane length.
 */
export async function selectByScopedIds<T = any>(
  run: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ids: Iterable<string | null | undefined>,
  chunkSize = 150,
): Promise<T[]> {
  const unique = [...new Set([...ids].filter((x): x is string => Boolean(x)))];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const { data, error } = await run(unique.slice(i, i + chunkSize));
    if (error) throw appError(error.message);
    out.push(...(data ?? []));
  }
  return out;
}
