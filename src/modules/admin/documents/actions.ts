'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
const BUCKET = 'employee-documents';
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Set(['application/pdf','image/jpeg','image/png','image/webp']);

type DocStatus = 'pending'|'verified'|'rejected'|'expired'|'archived';

function required(fd: FormData, key: string) { const v = String(fd.get(key) ?? '').trim(); if (!v) throw appError(`${key.replaceAll('_',' ')} is required.`); return v; }
function optional(fd: FormData, key: string) { const v = String(fd.get(key) ?? '').trim(); return v || null; }
function bool(fd: FormData, key: string) { return fd.get(key) === 'on'; }

async function requireAdmin() {
  const p = await getSessionProfile();
  if (!p || !p.user.is_active) throw appError('Authentication required.');
  const ok = isAdminTier(p) || p.user.section_code === 'admin' || p.access.some(a => a.section_code === 'admin');
  if (!ok) throw appError('Admin access required.');
  return p;
}

// U024 — Confidential Employee Documents. Mirrors confidentialActions.ts's
// requireAdminApprover() exactly: government_id/medical_clearance/
// police_clearance document TYPES are flagged employee_document_types.confidential,
// and only a Super Admin or an Admin-section approver may create, verify,
// reject, delete, or download a document of a confidential type. This is an
// app-layer gate (same documented limitation as employees.notes and
// fleet_drivers.license_no — RLS can't express a column/type-conditional
// restriction here cheaply), layered on top of requireAdmin()'s existing
// section-membership check, not a replacement for it.
function isApproverProfile(p: Awaited<ReturnType<typeof getSessionProfile>>) {
  if (!p) return false;
  return p.user.role === 'super_admin' || p.access.some((a) => a.section_code === 'admin' && a.workflow_role === 'approver');
}

async function requireApproverForConfidentialDocument(documentId: string, actor: NonNullable<Awaited<ReturnType<typeof getSessionProfile>>>) {
  const db = createClient();
  const { data: doc } = await db.from('employee_documents').select('document_type_id, type:employee_document_types(confidential)').eq('id', documentId).maybeSingle();
  const confidential = (doc as any)?.type?.confidential;
  if (confidential && !isApproverProfile(actor)) {
    throw appError('This document is confidential — only an Admin approver or Super Admin may manage it.');
  }
}

async function audit(actorId: string, id: string, action: string, detail: Record<string, unknown>) {
  const db = createClient();
  const { error } = await db.from('audit_log').insert({ actor_id: actorId, entity_table: 'employee_documents', entity_id: id, action, detail });
  if (error) throw appError(error.message);
}

export async function createDocumentTypeAction(fd: FormData) {
  const actor = await requireAdmin();
  const db = createClient();
  const code = required(fd,'code').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const name = required(fd,'name');
  const validity = optional(fd,'default_validity_days');
  const payload = { code, name, description: optional(fd,'description'), required_for_active_employee: bool(fd,'required_for_active_employee'), requires_expiry: bool(fd,'requires_expiry'), default_validity_days: validity ? Number(validity) : null, active: true };
  if (payload.default_validity_days !== null && (!Number.isInteger(payload.default_validity_days) || payload.default_validity_days <= 0)) throw appError('Default validity must be a positive whole number of days.');
  const { data, error } = await db.from('employee_document_types').insert(payload).select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to create document type.');
  await audit(actor.user.id, data.id, 'created', { type: payload });
  revalidatePath('/admin/documents');
  return { ok:true };
}

export async function createEmployeeDocumentAction(fd: FormData) {
  const actor = await requireAdmin();
  const db = createAdminClient(); // storage bucket has no RLS policies configured; keep on service role
  const dbc = createClient();
  const employeeId = required(fd,'employee_id');
  const typeId = required(fd,'document_type_id');
  const name = required(fd,'document_name');
  const issued = optional(fd,'issued_date');
  const expiry = optional(fd,'expiry_date');
  if (issued && expiry && expiry < issued) throw appError('Expiry date cannot be before issued date.');
  const { data: employee } = await dbc.from('employees').select('id').eq('id',employeeId).maybeSingle();
  if (!employee) throw appError('Employee not found.');
  const { data: type } = await dbc.from('employee_document_types').select('id,active,requires_expiry,default_validity_days,confidential').eq('id',typeId).maybeSingle();
  if (!type || !type.active) throw appError('Document type is not available.');
  // U021 — actually consume default_validity_days: when the type carries a
  // default validity and no explicit expiry was supplied, auto-calculate
  // expiry_date = issued_date (or today, if issued_date is also blank) +
  // default_validity_days, rather than leaving this stored-but-unused column
  // to keep silently doing nothing, as the audit found.
  let effectiveExpiry = expiry;
  if (!effectiveExpiry && type.default_validity_days) {
    const base = issued ? new Date(`${issued}T00:00:00Z`) : new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
    base.setUTCDate(base.getUTCDate() + Number(type.default_validity_days));
    effectiveExpiry = base.toISOString().slice(0,10);
  }
  if (type.requires_expiry && !effectiveExpiry) throw appError('Expiry date is required for this document type.');
  if (type.confidential && !isApproverProfile(actor)) throw appError('This document type is confidential — only an Admin approver or Super Admin may add this document.');

  const fileValue = fd.get('file');
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (file) {
    if (file.size > MAX_FILE_SIZE) throw appError('File exceeds the 10 MB limit.');
    if (!ALLOWED.has(file.type)) throw appError('Only PDF, JPG, PNG, and WEBP files are allowed.');
  }

  const id = crypto.randomUUID();
  let storagePath: string | null = null;
  if (file) {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g,'');
    storagePath = `${employeeId}/${id}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, bytes, { contentType: file.type, upsert:false });
    if (uploadError) throw appError(`Unable to store document: ${uploadError.message}`);
  }

  const { data, error } = await dbc.from('employee_documents').insert({
    ...biz(actor),
    id, employee_id:employeeId, document_type_id:typeId, document_name:name,
    document_number:optional(fd,'document_number'), issued_date:issued, expiry_date:effectiveExpiry,
    status:'pending', storage_path:storagePath, original_file_name:file?.name ?? null,
    mime_type:file?.type ?? null, file_size:file?.size ?? null, notes:optional(fd,'notes'), uploaded_by:actor.user.id,
  }).select('id').single();
  if (error || !data) {
    if (storagePath) await db.storage.from(BUCKET).remove([storagePath]);
    throw appError(error?.message || 'Unable to create employee document.');
  }
  await audit(actor.user.id, id, 'created', { employee_id:employeeId, document_type_id:typeId, has_file:Boolean(file), expiry_date:effectiveExpiry, expiry_auto_calculated: !expiry && Boolean(effectiveExpiry) });
  revalidatePath('/admin/documents');
  return { ok:true };
}

export async function updateDocumentStatusAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = required(fd,'document_id');
  const status = required(fd,'status') as DocStatus;
  if (!['pending','verified','rejected','expired','archived'].includes(status)) throw appError('Invalid document status.');
  await requireApproverForConfidentialDocument(id, actor);
  const db = createClient();
  const patch: Record<string,unknown> = { status };
  if (status === 'verified') { patch.verified_by = actor.user.id; patch.verified_at = new Date().toISOString(); patch.rejection_reason = null; }
  if (status === 'rejected') patch.rejection_reason = optional(fd,'rejection_reason') || 'Document rejected.';
  const { error } = await db.from('employee_documents').update(patch).eq('id',id);
  if (error) throw appError(error.message);
  await audit(actor.user.id,id,'status_changed',{status,rejection_reason:patch.rejection_reason ?? null});
  revalidatePath('/admin/documents');
  return { ok:true };
}

export async function deleteEmployeeDocumentAction(fd: FormData) {
  const actor = await requireAdmin();
  const id = required(fd,'document_id');
  await requireApproverForConfidentialDocument(id, actor);
  const db = createAdminClient(); // storage bucket has no RLS policies configured; keep on service role
  const dbc = createClient();
  const { data: doc } = await dbc.from('employee_documents').select('id,storage_path,employee_id,document_name').eq('id',id).maybeSingle();
  if (!doc) throw appError('Document not found.');
  if (doc.storage_path) await db.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await dbc.from('employee_documents').delete().eq('id',id);
  if (error) throw appError(error.message);
  await audit(actor.user.id,id,'deleted',{employee_id:doc.employee_id,document_name:doc.document_name});
  revalidatePath('/admin/documents');
  return { ok:true };
}

export async function getDocumentDownloadUrlAction(documentId: string) {
  const actor = await requireAdmin();
  await requireApproverForConfidentialDocument(documentId, actor);
  const db = createAdminClient(); // storage bucket has no RLS policies configured; keep on service role
  const dbc = createClient();
  const { data: doc } = await dbc.from('employee_documents').select('id,storage_path,original_file_name').eq('id',documentId).maybeSingle();
  if (!doc?.storage_path) throw appError('This document has no uploaded file.');
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300);
  if (error || !data?.signedUrl) throw appError(error?.message || 'Unable to create download link.');
  await audit(actor.user.id, documentId, 'downloaded', { file_name:doc.original_file_name });
  return { url:data.signedUrl, fileName:doc.original_file_name };
}
