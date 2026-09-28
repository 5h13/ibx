import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthedShell } from '@/core/layout/AuthedShell';
import RequestsManagement from '@/modules/admin/requests/RequestsManagement';
import { isAdminTier } from '@/core/auth/types';
export default async function RequestsPage(){const profile=await getSessionProfile();if(!profile)redirect('/login');const can=isAdminTier(profile)||profile.user.section_code==='admin'||profile.access.some(a=>a.section_code==='admin');if(!can)redirect('/dashboard');const db=createClient();const [{data:cats,error:ce},{data:reqs,error:re},{data:employees,error:ee},{data:supplies,error:se}]=await Promise.all([db.from('internal_request_categories').select('*').eq('active',true).order('name'),db.from('internal_requests').select('*,category:internal_request_categories(name),requester_employee:employees(employee_no,first_name,last_name,preferred_name),items:internal_request_items(id,supply_id,item_description,quantity,unit,notes)').order('created_at',{ascending:false}).limit(200),db.from('employees').select('id,employee_no,first_name,last_name,preferred_name,employment_status').neq('employment_status','separated').order('last_name'),db.from('supplies').select('id,item_code,name,unit,stock_on_hand,active').eq('active',true).order('name')]);if(ce||re||ee||se)throw new Error(ce?.message||re?.message||ee?.message||se?.message||'Unable to load requests.');return <AuthedShell profile={profile}><RequestsManagement profile={profile} categories={(cats??[]) as any} requests={(reqs??[]) as any} employees={(employees??[]) as any} supplies={(supplies??[]) as any}/></AuthedShell>}
