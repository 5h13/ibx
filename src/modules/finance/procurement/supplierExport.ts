// src/modules/finance/procurement/supplierExport.ts
//
// SUP-11 permission rules (server-side; imported by the export route and by
// the procurement page to decide which controls to show).
//   - Export at all: same gate as the catalog/PR/PO exports — an active user
//     with Finance section access, or admin tier.
//   - Sensitive supplier details (bank details, payment destination/account,
//     tax id): only admin tier (Global/Business Super Admin) or a Finance
//     approver, and only when explicitly requested — the default export
//     never contains them.

import { isAdminTier, type SessionProfile } from '@/core/auth/types';

export const SUPPLIER_SENSITIVE_FIELDS = ['tax_id', 'bank_details', 'payment_destination'] as const;

export function canExportSuppliers(profile: SessionProfile | null): boolean {
  if (!profile?.user.is_active) return false;
  return isAdminTier(profile) || profile.user.section_code === 'finance' || profile.access.some((a) => a.section_code === 'finance');
}

export function canExportSupplierSensitive(profile: SessionProfile | null): boolean {
  if (!canExportSuppliers(profile)) return false;
  return isAdminTier(profile) || profile!.access.some((a) => a.section_code === 'finance' && a.workflow_role === 'approver');
}
