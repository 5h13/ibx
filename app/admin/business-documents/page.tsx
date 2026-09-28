import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import BusinessDocuments from '@/modules/admin/business-documents/BusinessDocuments';

export default async function BusinessDocumentsPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const canManage = isAdminTier(profile) || profile.user.section_code === 'admin' || profile.access.some((a) => a.section_code === 'admin');
  if (!canManage) redirect('/dashboard');
  const isSuperAdmin = profile.user.role === 'super_admin';

  const db = createClient();
  const [{ data: businesses, error: e1 }, { data: types, error: e2 }, { data: documents, error: e3 }] = await Promise.all([
    db.from('businesses').select('id,code,legal_name,trade_name,is_active').order('legal_name'),
    db.from('business_document_types').select('*').eq('active', true).order('name'),
    db
      .from('business_documents')
      .select('*, business:businesses(code,legal_name,trade_name), type:business_document_types(name)')
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ]);
  if (e1 || e2 || e3) throw new Error(e1?.message || e2?.message || e3?.message || 'Unable to load business documents.');

  // Non-super-admin (business_admin and other admin-tier section users) only
  // ever operate within their own business, so scope the lists they see here
  // the same way the rest of Admin does for equivalent per-business data —
  // the DB's own RESTRICTIVE business-isolation RLS is the actual security
  // boundary (verified independently); this is just view-scoping.
  const visibleBusinesses = isSuperAdmin ? (businesses ?? []) : (businesses ?? []).filter((b: any) => b.id === profile.user.business_id);
  const visibleDocuments = isSuperAdmin ? (documents ?? []) : (documents ?? []).filter((d: any) => d.business_id === profile.user.business_id);

  return (
    <AuthedShell profile={profile}>
      <BusinessDocuments businesses={visibleBusinesses as any} types={(types ?? []) as any} documents={visibleDocuments as any} isSuperAdmin={isSuperAdmin} canDelete={isAdminTier(profile)} />
    </AuthedShell>
  );
}
