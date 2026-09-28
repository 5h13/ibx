import { requireSignedIn } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
// Build 58: Policies & Announcements is for every employee (acknowledging a
// policy needs only a login), so this page stays open to any signed-in user
// now that requireSection() enforces the section.
import { AuthedShell } from '@/core/layout/AuthedShell';
import { PoliciesManagement } from '@/modules/admin/policies/PoliciesManagement';
export default async function PoliciesPage(){const profile=await requireSignedIn();const db=createClient();const [{data:categories,error:ce},{data:policies,error:pe},{data:announcements,error:ae},{data:acks,error:acke}]=await Promise.all([db.from('admin_policy_categories').select('*').eq('active',true).order('name'),db.from('admin_policies').select('*,category:admin_policy_categories(name)').order('created_at',{ascending:false}),db.from('admin_announcements').select('*').order('created_at',{ascending:false}),db.from('admin_policy_acknowledgements').select('policy_id').eq('user_id',profile.user.id)]);if(ce||pe||ae||acke)throw new Error(ce?.message||pe?.message||ae?.message||acke?.message||'Unable to load policies.');return <AuthedShell profile={profile}><PoliciesManagement profile={profile} categories={categories??[]} policies={policies??[]} announcements={announcements??[]} acknowledged={new Set((acks??[]).map((a:any)=>a.policy_id))}/></AuthedShell>}
