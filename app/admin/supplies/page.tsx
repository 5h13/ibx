import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthedShell } from '@/core/layout/AuthedShell';
import SuppliesManagement from '@/modules/admin/supplies/SuppliesManagement';
import { isAdminTier } from '@/core/auth/types';
export default async function SuppliesPage(){const profile=await getSessionProfile();if(!profile)redirect('/login');const can=isAdminTier(profile)||profile.user.section_code==='admin'||profile.access.some(a=>a.section_code==='admin');if(!can)redirect('/dashboard');
  // Phase 7 business-isolation fix: same CC-01-class bug as assets/fleet —
  // this page previously read through createAdminClient() (service-role,
  // bypasses RLS) despite supplies already carrying correct RESTRICTIVE
  // business-isolation RLS since A001.
  const db=createClient();
  const [{data:categories,error:ce},{data:supplies,error:se},{data:tx,error:te},{data:suppliers,error:pe}]=await Promise.all([db.from('supply_categories').select('*').eq('active',true).order('name'),db.from('supplies').select('*,category:supply_categories(name),supplier_ref:finance_suppliers(supplier_code,legal_name,trade_name)').order('name'),db.from('supply_transactions').select('id,supply_id,transaction_type,quantity,balance_after,notes,created_at').order('created_at',{ascending:false}).limit(200),db.from('finance_suppliers').select('id,supplier_code,legal_name,trade_name').eq('active',true).order('legal_name')]);if(ce||se||te||pe)throw new Error(ce?.message||se?.message||te?.message||pe?.message||'Unable to load supplies.');return <AuthedShell profile={profile}><SuppliesManagement categories={(categories??[]) as any} supplies={(supplies??[]) as any} transactions={(tx??[]) as any} suppliers={(suppliers??[]) as any}/></AuthedShell>}
