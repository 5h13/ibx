'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

// U023 — Business Document & Compliance. Mirrors employee document/type
// actions.ts exactly in shape (same status enum, same storage-bucket
// pattern, same audit_log usage), but scoped to a business rather than an
// employee. business_document_types is a GLOBAL master (same
// locked-architecture rule already applied to employee_document_types,
// hr_departments/positions/work_locations, finance_suppliers); business_documents
// is business-scoped with the same RESTRICTIVE business-isolation RLS every
// business-scoped table has carried since A001.
const BUCKET = 'business-documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

type DocStatus = 'pending' | 'verified' | 'rejected' | 'expired' | 'archived';

function required(fd: FormData, key: string) { const v = String(fd.get(key) ?? '').trim(); if (!v) throw appError(`${key.replaceAll('_', ' ')} is required.`); return v; }
function optional(fd: FormData, key: string) { const v = String(fd.get(key) ?? '').trim(); return v || null; }

async function requireAdmin() {
  const p = await getSessionProfile();
  if (!p || !p.user.is_active) throw appError('Authentication required.');
  const ok = isAdminTier(p) || p.user.section_code === 'admin' || p.access.some(a => a.section_code === 'admin');
  if (!ok) throw appError('Admin access required.');
  return p;
}

/** Resolve which business a write targets. A Business Super Admin (or any
 * non-super-admin) can only ever target their own business; a Global Super
 * Admin must explicitly pick one (validated against the businesses table),
 * mirroring src/modules/admin/users/actions.ts's exact pattern. */
async function resolveBusinessId(actor: NonNullable<Awaited<ReturnType<typeof getSessionProfile>>>, fd: FormData) {
  if (actor.user.role !== 'super_admin') {
    if (!actor.user.business_id) throw appError('Your account is not linked to a business.');
    return actor.user.business_id;
  }
  const businessId = required(fd, 'business_id');
  const db = createClient();
  const { data: business, error } = await db.from('businesses').select('id,is_active').eq('id', businessId).maybeSingle();
  if (error) throw appError(error.message);
  if (!business || !business.is_active) throw appError('Select a valid, active business.');
  return business.id as string;
}

async function audit(actorId: string, id: string, action: string, detail: Record<string, unknown>) {
  const db = createClient();
  const { error } = await db.from('audit_log').insert({ actor_id: actorId, entity_table: 'business_documents', entity_id: id, action, detail });
  if (error) throw appError(error.message);
}

export async function createBusinessDocumentTypeAction(fd: FormData) {
  const actor = await requireAdmin();
  if (actor.user.role !== 'super_admin') throw appError('Only the Global Super Admin manages business document types (a global master, like employee document types).');
  const db = createClient();
  const code = required(fd, 'code').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const name = required(fd, 'name');
  const validity = optional(fd, 'default_validity_days');
  const payload = {
    code, name, description: optional(fd, 'description'),
    required: fd.get('required') === 'on', requires_expiry: fd.get('requires_expiry') === 'on',
    default_validity_days: validity ? Number(validity) : null, active: true,
  };
  if (payload.default_validity_days !== null && (!Number.isInteger(payload.default_validity_days) || payload.default_validity_days <= 0)) throw appError('Default validity must be a positive whole number of days.');
  const { data, error } = await db.from('business_document_types').insert(payload).select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to create business document type.');
  await audit(actor.user.id, data.id, 'created', { type: payload });
  revalidatePath('/admin/business-documents');
  return { ok: true };
}

export async function createBusinessDocumentAction(fd: FormData) {
  const actor = await requireAdmin();
  const businessId = await resolveBusinessId(actor, fd);
  const dbc = createClient();
  const db = createAdminClient(); // storage bucket has no RLS policies configured; keep on service role
  const typeId = required(fd, 'document_type_id');
  const name = required(fd, 'document_name');
  const issued = optional(fd, 'issued_date');
  const expiry = optional(fd, 'expiry_date');
  if (issued && expiry && expiry < issued) throw appError('Expiry date cannot be before issued date.');
  const { data: type } = await dbc.from('business_document_types').select('id,active,requires_expiry,default_validity_days').eq('id', typeId).maybeSingle();
  if (!type || !type.active) throw appError('Document type is not available.');
  let effectiveExpiry = expiry;
  if (!effectiveExpiry && type.default_validity_days) {
    const base = issued ? new Date(`${issued}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    base.setUTCDate(base.getUTCDate() + Number(type.default_validity_days));
    effectiveExpiry = base.toISOString().slice(0, 10);
  }
  if (type.requires_expiry && !effectiveExpiry) throw appError('Expiry date is required for this document type.');

  const fileValue = fd.get('file');
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (file) {
    if (file.size > MAX_FILE_SIZE) throw appError('File exceeds the 10 MB limit.');
    if (!ALLOWED.has(file.type)) throw appError('Only PDF, JPG, PNG, and WEBP files are allowed.');
  }

  const id = crypto.randomUUID();
  let storagePath: string | null = null;
  if (file) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    storagePath = `${businessId}/${id}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw appError(`Unable to store document: ${uploadError.message}`);
  }

  const { data, error } = await dbc.from('business_documents').insert({
    id, business_id: businessId, document_type_id: typeId, document_name: name,
    document_number: optional(fd, 'document_number'), issued_date: issued, expiry_date: effectiveExpiry,
    status: 'pending', storage_path: storagePath, original_file_name: file?.name ?? null,
    mime_type: file?.type ?? null, file_size: file?.size ?? null, notes: optional(fd, 'notes'), uploaded_by: actor.user.id,
  }).select('id').single();
  if (error || !data) {
    if (storagePath) await db.storage.from(BUCKET).remove([storagePath]);
    throw appError(error?.message || 'Unable to create business document.');
  }
  await audit(actor.user.id, id, 'created', { business_id: businessId, document_type_id: typeId, has_file: Boolean(file), expiry_date: effectiveExpiry, expiry_auto_calculated: !expiry && Boolean(effectiveExpiry) });
  revalidatePath('/admin/business-documents');
  return { ok: true };
}

export async function updateBusinessDocumentStatusAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = required(fd, 'document_id');
  const status = required(fd, 'status') as DocStatus;
  if (!['pending', 'verified', 'rejected', 'expired', 'archived'].includes(status)) throw appError('Invalid document status.');
  const db = createClient();
  const patch: Record<string, unknown> = { status };
  if (status === 'verified') { patch.verified_by = actor.user.id; patch.verified_at = new Date().toISOString(); patch.rejection_reason = null; }
  if (status === 'rejected') patch.rejection_reason = optional(fd, 'rejection_reason') || 'Document rejected.';
  const { error } = await db.from('business_documents').update(patch).eq('id', id);
  if (error) throw appError(error.message);
  await audit(actor.user.id, id, 'status_changed', { status, rejection_reason: patch.rejection_reason ?? null });
  revalidatePath('/admin/business-documents');
  return { ok: true };
}

export async function deleteBusinessDocumentAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = required(fd, 'document_id');
  const db = createAdminClient(); // storage bucket has no RLS policies configured; keep on service role
  const dbc = createClient();
  const { data: doc } = await dbc.from('business_documents').select('id,storage_path,business_id,document_name').eq('id', id).maybeSingle();
  if (!doc) throw appError('Document not found.');
  if (doc.storage_path) await db.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await dbc.from('business_documents').delete().eq('id', id);
  if (error) throw appError(error.message);
  await audit(actor.user.id, id, 'deleted', { business_id: doc.business_id, document_name: doc.document_name });
  revalidatePath('/admin/business-documents');
  return { ok: true };
}

export async function getBusinessDocumentDownloadUrlAction(documentId: string) {
  const actor = await requireAdmin();
  const db = createAdminClient(); // storage bucket has no RLS policies configured; keep on service role
  const dbc = createClient();
  const { data: doc } = await dbc.from('business_documents').select('id,storage_path,original_file_name').eq('id', documentId).maybeSingle();
  if (!doc?.storage_path) throw appError('This document has no uploaded file.');
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300);
  if (error || !data?.signedUrl) throw appError(error?.message || 'Unable to create download link.');
  await audit(actor.user.id, documentId, 'downloaded', { file_name: doc.original_file_name });
  return { url: data.signedUrl, fileName: doc.original_file_name };
}
