// Build 75 — who may open a printed external document.
import { hasAnyFunction } from '@/core/auth/functions';
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';
import type { SectionCode } from '@/core/auth/types';

/** Build 90: fns = also require one of these functions. */
export async function requireAnySection(sections: SectionCode[], fns?: string[]) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!sections.some((s) => hasSectionAccess(profile, s))) redirect('/dashboard');
  if (fns && !hasAnyFunction(profile, fns)) redirect('/dashboard');
  return profile;
}
export const pesoDoc = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
