import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import EmployeeDocuments from '@/modules/admin/documents/EmployeeDocuments';

export default async function EmployeeDocumentsPage({ searchParams }: { searchParams?: { employee?: string } }){
 const profile=await getSessionProfile();
 if(!profile) redirect('/login');
 const canManage=isAdminTier(profile)||profile.user.section_code==='admin'||profile.access.some(a=>a.section_code==='admin');
 if(!canManage) redirect('/dashboard');
 // U024 — confidential document types (government_id, medical_clearance,
 // police_clearance) are hidden from this list entirely for a non-approver,
 // mirroring how confidentialActions.ts skips the government-ID call rather
 // than surfacing an error for a section the viewer isn't authorized to see.
 const canViewConfidential = profile.user.role==='super_admin' || profile.access.some(a=>a.section_code==='admin'&&a.workflow_role==='approver');
 const db=createClient();
 const [{data:employees,error:ee},{data:types,error:te},{data:documents,error:de}]=await Promise.all([
  db.from('employees').select('id,employee_no,first_name,last_name,preferred_name,employment_status').order('last_name').order('first_name'),
  db.from('employee_document_types').select('*').eq('active',true).order('name'),
  db.from('employee_documents').select('*, employee:employees(employee_no,first_name,last_name,preferred_name), type:employee_document_types(name,confidential)').order('expiry_date',{ascending:true,nullsFirst:false}).order('created_at',{ascending:false})
 ]);
 if(ee||te||de) throw new Error(ee?.message||te?.message||de?.message||'Unable to load documents.');
 const visibleTypes = canViewConfidential ? (types??[]) : (types??[]).filter((t:any)=>!t.confidential);
 const visibleDocuments = canViewConfidential ? (documents??[]) : (documents??[]).filter((d:any)=>!d.type?.confidential);
 return <AuthedShell profile={profile}><EmployeeDocuments employees={(employees??[]) as any} types={visibleTypes as any} documents={visibleDocuments as any} canDelete={isAdminTier(profile)} initialEmployeeId={searchParams?.employee}/></AuthedShell>;
}
