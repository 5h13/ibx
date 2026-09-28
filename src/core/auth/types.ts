// src/core/auth/types.ts
//
// Mirrors the enums in supabase/schema.sql. Keep in sync with the DB.

export type AppRole = 'super_admin' | 'business_admin' | 'admin' | 'finance' | 'logistics' | 'marketing' | 'sales';

export type WorkflowRole = 'preparer' | 'reviewer' | 'approver';

export type EntryStatus = 'draft' | 'prepared' | 'reviewed' | 'approved' | 'posted' | 'paid';

export type SectionCode = 'admin' | 'finance' | 'logistics' | 'marketing' | 'sales';

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  section_id: string | null;
  section_code?: string | null;
  is_active: boolean;
  /** A001 foundation: null only for role==='super_admin' (5H13 Global Super
   * Admin, who bypasses business-scoping RLS entirely). Every other role is
   * scoped to exactly one business. */
  business_id: string | null;
}

export interface UserAccessGrant {
  section_id: string;
  section_code?: string | null;
  workflow_role: WorkflowRole;
}

/** Full session profile: the user row plus their workflow grants. */
export interface SessionProfile {
  user: AppUser;
  access: UserAccessGrant[];
  /** Build 57 — set while a Super Admin / Business Admin is auditing a role:
   * the account genuinely holds that role (user/access above ARE the audited
   * role); this records what to show in the banner and what is restored. */
  audit?: RoleAudit | null;
}

export interface RoleAudit {
  roles: string[];
  businessId: string;
  expiresAt: string;
  originalRole: AppRole;
}

/** Real role behind any role audit (for deciding who may start one). */
export function realRole(profile: SessionProfile | null): AppRole | null {
  return profile?.audit?.originalRole ?? profile?.user.role ?? null;
}

export function isSuperAdmin(profile: SessionProfile | null): boolean {
  return profile?.user.role === 'super_admin';
}

/** A001 completion: true for the Global Super Admin OR a Business Super
 * Admin. Use this wherever "full administrative bypass" is the intent —
 * skipping section/workflow-grant requirements — since a business_admin's
 * own business_id scoping (enforced by RLS) already keeps their reach
 * confined to their own business regardless of this bypass. Do NOT use this
 * for genuinely Global-only actions (creating a business, creating another
 * super_admin/business_admin, managing shared/global master data) — those
 * still check isSuperAdmin directly. */
export function isAdminTier(profile: SessionProfile | null): boolean {
  return profile?.user.role === 'super_admin' || profile?.user.role === 'business_admin';
}

/** A001: the business a write from this session should be scoped to.
 * Null for the Global Super Admin (role==='super_admin'), who has no single
 * business — any action that writes business-scoped data on their behalf
 * must resolve a target business explicitly rather than relying on this. */
export function currentBusinessId(profile: SessionProfile | null): string | null {
  return profile?.user.business_id ?? null;
}

export function hasWorkflowRole(
  profile: SessionProfile | null,
  sectionId: string,
  role: WorkflowRole
): boolean {
  if (!profile) return false;
  if (isAdminTier(profile)) return true;
  return profile.access.some((a) => a.section_id === sectionId && grantSatisfies(a.workflow_role, role));
}

/** Build 58 (audit finding A, user-confirmed 2026-09-27): an approver may
 * also perform the review step. Same rule as the database's
 * has_workflow_role(). A preparer grant is never satisfied by approver. */
export function grantSatisfies(held: WorkflowRole, needed: WorkflowRole): boolean {
  return held === needed || (needed === 'reviewer' && held === 'approver');
}

/** Section-code variant of hasWorkflowRole. Considers EVERY grant the user
 * holds for that section (audit finding B), and never infers a workflow role
 * from the user's app role alone (audit finding C). Admin tier passes. */
export function hasSectionWorkflowRole(profile: SessionProfile | null, sectionCode: string, role: WorkflowRole): boolean {
  if (!profile) return false;
  if (isAdminTier(profile)) return true;
  return profile.access.some((a) => a.section_code === sectionCode && grantSatisfies(a.workflow_role, role));
}

/** Staff-minimum visibility (build plan section 4): true if this profile
 * should only see totals/own entries rather than section-wide detail. */
export function isStaffMinimalView(profile: SessionProfile | null, sectionId: string): boolean {
  if (!profile) return true;
  if (isAdminTier(profile)) return false;
  // A user sees full section detail once they hold ANY workflow role
  // (preparer/reviewer/approver) in that section. Extend this rule here
  // if a distinct "staff" (no workflow role) tier is introduced later.
  return !profile.access.some((a) => a.section_id === sectionId);
}
