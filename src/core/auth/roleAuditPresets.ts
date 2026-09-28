// Build 57 — role presets for role audit mode (mapping confirmed by the user;
// see supabase/migrations/20261110_role_audit_mode.sql for what each grants).
export const ROLE_PRESETS = [
  { code: 'BUSINESS_ADMIN', label: 'Business Admin' },
  { code: 'ADMIN_STAFF', label: 'Admin Staff' },
  { code: 'ADMIN_APPROVER', label: 'Admin Approver' },
  { code: 'FINANCE_STAFF', label: 'Finance Staff' },
  { code: 'FINANCE_APPROVER', label: 'Finance Approver' },
  { code: 'LOGISTICS_STAFF', label: 'Logistics Staff' },
  { code: 'LOGISTICS_APPROVER', label: 'Logistics Approver' },
  { code: 'DRIVER', label: 'Driver' },
  { code: 'SALES_MARKETING_STAFF', label: 'Sales & Marketing Staff' },
  { code: 'SALES_MARKETING_APPROVER', label: 'Sales & Marketing Approver' },
] as const;

export function presetLabel(code: string) {
  return ROLE_PRESETS.find((p) => p.code === code)?.label ?? code;
}
