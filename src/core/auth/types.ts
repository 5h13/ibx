// src/core/auth/types.ts
//
// Mirrors the enums in supabase/schema.sql. Keep in sync with the DB.

export type AppRole = 'super_admin' | 'admin' | 'finance' | 'logistics' | 'marketing' | 'sales';

export type WorkflowRole = 'preparer' | 'reviewer' | 'approver';

export type EntryStatus = 'draft' | 'prepared' | 'reviewed' | 'approved';

export type SectionCode = 'admin' | 'finance' | 'logistics' | 'marketing' | 'sales';

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  section_id: string | null;
  is_active: boolean;
}

export interface UserAccessGrant {
  section_id: string;
  workflow_role: WorkflowRole;
}

/** Full session profile: the user row plus their workflow grants. */
export interface SessionProfile {
  user: AppUser;
  access: UserAccessGrant[];
}

export function isSuperAdmin(profile: SessionProfile | null): boolean {
  return profile?.user.role === 'super_admin';
}

export function hasWorkflowRole(
  profile: SessionProfile | null,
  sectionId: string,
  role: WorkflowRole
): boolean {
  if (!profile) return false;
  if (isSuperAdmin(profile)) return true;
  return profile.access.some((a) => a.section_id === sectionId && a.workflow_role === role);
}

/** Staff-minimum visibility (build plan section 4): true if this profile
 * should only see totals/own entries rather than section-wide detail. */
export function isStaffMinimalView(profile: SessionProfile | null, sectionId: string): boolean {
  if (!profile) return true;
  if (isSuperAdmin(profile)) return false;
  // A user sees full section detail once they hold ANY workflow role
  // (preparer/reviewer/approver) in that section. Extend this rule here
  // if a distinct "staff" (no workflow role) tier is introduced later.
  return !profile.access.some((a) => a.section_id === sectionId);
}
