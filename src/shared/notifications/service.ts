'use server';
import { appError } from '@/core/errors/appError';
// U006: shared workflow-notification mechanism. Any module's workflow
// transition calls one of these instead of inventing its own notification
// path -- this is what PR-13 (Phase 1) and U007 (Phase 5) both build on.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

type NotifyPayload = {
  business_id?: string | null;
  section_code?: string;
  entity_table?: string;
  entity_id?: string;
  title: string;
  message?: string;
  action_url?: string;
};

async function insertNotifications(recipientIds: string[], businessId: string | null, actorId: string | null, payload: NotifyPayload) {
  const ids = [...new Set(recipientIds)].filter(Boolean);
  if (!ids.length || !businessId) return;
  const db = createClient();
  const { error } = await db.from('app_notifications').insert(ids.map(recipient_user_id => ({
    business_id: businessId,
    recipient_user_id,
    section_code: payload.section_code || null,
    entity_table: payload.entity_table || null,
    entity_id: payload.entity_id || null,
    title: payload.title,
    message: payload.message || null,
    action_url: payload.action_url || null,
    created_by: actorId,
  })));
  if (error) throw appError(error.message);
}

/** Notify every active user in `businessId` holding `role` for `sectionCode` -- the "next role holder" case (draft->prepared notifies reviewers, prepared->reviewed notifies approvers, etc). */
export async function notifyWorkflowRole(businessId: string | null, sectionCode: string, role: 'preparer' | 'reviewer' | 'approver', payload: NotifyPayload) {
  if (!businessId) return;
  const db = createClient();
  const { data: section } = await db.from('sections').select('id').eq('code', sectionCode).single();
  if (!section) return;
  const { data: rows, error } = await db
    .from('user_access')
    .select('user_id, user:users!inner(id,is_active,business_id)')
    .eq('section_id', section.id)
    .eq('workflow_role', role);
  if (error) return; // notifications are best-effort; never fail the workflow transition over this
  const recipients = (rows || [])
    .filter((r: any) => r.user?.is_active && r.user?.business_id === businessId)
    .map((r: any) => r.user_id as string);
  const p = await getSessionProfile();
  await insertNotifications(recipients, businessId, p?.user.id || null, { ...payload, section_code: sectionCode });
}

/** Notify a specific user (or set of users) directly -- the "notify the originator on return/rejection" case. */
export async function notifyUsers(userIds: string[], businessId: string | null, payload: NotifyPayload) {
  const p = await getSessionProfile();
  await insertNotifications(userIds, businessId, p?.user.id || null, payload);
}

export async function listMyNotificationsAction() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const { data, error } = await db.from('app_notifications').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw appError(error.message);
  return data || [];
}

export async function markNotificationReadAction(id: string) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const { error } = await db.from('app_notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw appError(error.message);
  revalidatePath('/');
}

export async function markAllNotificationsReadAction() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const { error } = await db.from('app_notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).eq('recipient_user_id', p.user.id);
  if (error) throw appError(error.message);
  revalidatePath('/');
}
