// Build 127 — who may open the Sales Manager app: Sales approvers and the admin tier.
import { hasSectionWorkflowRole, isAdminTier, type SessionProfile } from '@/core/auth/types';

export function canUseManagerApp(profile: SessionProfile) {
  return isAdminTier(profile) || hasSectionWorkflowRole(profile, 'sales', 'approver');
}
