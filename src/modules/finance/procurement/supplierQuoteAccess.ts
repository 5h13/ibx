// Build 56 — who may view / manage the supplier quote log (mirrors the DB
// helpers can_view_supplier_quotes() / can_manage_supplier_quotes(), which
// are the real boundary). Procurement lives in the Finance section.
import { isAdminTier, type SessionProfile } from '@/core/auth/types';

function hasSection(p: SessionProfile, code: string) {
  return p.user.section_code === code || p.user.role === code || p.access.some((a) => a.section_code === code);
}

export function canManageSupplierQuotes(p: SessionProfile | null): boolean {
  if (!p?.user.is_active) return false;
  return isAdminTier(p) || hasSection(p, 'finance');
}

export function canViewSupplierQuotes(p: SessionProfile | null): boolean {
  if (!p?.user.is_active) return false;
  return canManageSupplierQuotes(p) || hasSection(p, 'sales');
}

/** Whole days since a cost was last updated; null when never recorded. */
export function daysSince(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** "Cost updated N days ago" label used across catalog, quote log and quotes. */
export function costAgeLabel(ts: string | null | undefined): string {
  const d = daysSince(ts);
  if (d === null) return 'Cost not yet updated';
  if (d === 0) return 'Cost updated today';
  return `Cost updated ${d} day${d === 1 ? '' : 's'} ago`;
}
