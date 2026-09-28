'use server';
import { appError } from '@/core/errors/appError';

// U013 — Standardized Employee Master Data.
//
// Admin CRUD for the three global HR master tables (hr_departments,
// hr_positions, work_locations) that Build 42 created the FK columns for
// but that had no management UI anywhere in the app — an admin could not
// actually populate them, so every employee's department_id/position_id/
// work_location_id stayed null regardless of the masters existing in the DB.
//
// Global, not business-scoped, per the "locked architecture" rule already
// applied to these three tables (20261019_hr_department_position_location_masters.sql).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

type Table = 'hr_departments' | 'hr_positions' | 'work_locations';
const TABLES: Table[] = ['hr_departments', 'hr_positions', 'work_locations'];

function validateTable(table: string): asserts table is Table {
  if (!TABLES.includes(table as Table)) throw appError('Invalid HR master table.');
}

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  const ok = isAdminTier(profile) || profile.user.section_code === 'admin' || profile.access.some((a) => a.section_code === 'admin');
  if (!ok) throw appError('Admin access required.');
  return profile;
}

async function audit(actorId: string, table: Table, id: string, action: string, detail: Record<string, unknown>) {
  const db = createClient();
  const { error } = await db.from('audit_log').insert({ actor_id: actorId, entity_table: table, entity_id: id, action, detail });
  if (error) throw appError(error.message);
}

export async function createHrMasterAction(formData: FormData) {
  const actor = await requireAdmin();
  const table = String(formData.get('table') ?? '');
  validateTable(table);
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw appError('Name is required.');

  const db = createClient();
  const { data, error } = await db.from(table).insert({ name }).select('id').single();
  if (error || !data) throw appError(error?.message ?? 'Unable to create record.');
  await audit(actor.user.id, table, data.id, 'created', { name });
  revalidatePath('/admin/hr-masters');
  return { ok: true };
}

export async function renameHrMasterAction(formData: FormData) {
  const actor = await requireAdmin();
  const table = String(formData.get('table') ?? '');
  validateTable(table);
  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  if (!id) throw appError('Record id is required.');
  if (!name) throw appError('Name is required.');

  const db = createClient();
  const { error } = await db.from(table).update({ name }).eq('id', id);
  if (error) throw appError(error.message);
  await audit(actor.user.id, table, id, 'edited', { name });
  revalidatePath('/admin/hr-masters');
  return { ok: true };
}

export async function setHrMasterActiveAction(formData: FormData) {
  const actor = await requireAdmin();
  const table = String(formData.get('table') ?? '');
  validateTable(table);
  const id = String(formData.get('id') ?? '').trim();
  const active = formData.get('active') === 'true';
  if (!id) throw appError('Record id is required.');

  const db = createClient();
  const { error } = await db.from(table).update({ active }).eq('id', id);
  if (error) throw appError(error.message);
  await audit(actor.user.id, table, id, active ? 'reactivated' : 'deactivated', { active });
  revalidatePath('/admin/hr-masters');
  return { ok: true };
}
