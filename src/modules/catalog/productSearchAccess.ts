// Build 62 — who may use Product Search (view-only catalog lookup). Mirrors
// the database's can_read_shared_catalog(), which catalog_product_search()
// enforces: Finance (incl. Procurement), Sales, Logistics and admins.
import { isAdminTier, type SessionProfile } from '@/core/auth/types';

const SECTIONS = ['finance', 'sales', 'logistics'];

export function canViewProductSearch(p: SessionProfile | null): boolean {
  if (!p?.user.is_active) return false;
  if (isAdminTier(p)) return true;
  return SECTIONS.includes(p.user.section_code ?? '') || SECTIONS.includes(p.user.role) || p.access.some((a) => SECTIONS.includes(a.section_code ?? ''));
}
