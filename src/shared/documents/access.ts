// Build 75 — who may open a printed external document.
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { hasSectionAccess } from '@/core/auth/requireSection';
import type { SectionCode } from '@/core/auth/types';

export async function requireAnySection(sections: SectionCode[]) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!sections.some((s) => hasSectionAccess(profile, s))) redirect('/dashboard');
  return profile;
}
export const pesoDoc = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
