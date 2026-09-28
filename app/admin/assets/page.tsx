import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import AssetsManagement from '@/modules/admin/assets/AssetsManagement';

export default async function AssetsPage(){
  const profile=await getSessionProfile(); if(!profile) redirect('/login');
  const canManage=isAdminTier(profile)||profile.user.section_code==='admin'||profile.access.some(a=>a.section_code==='admin');
  if(!canManage) redirect('/dashboard');
  // Phase 7 business-isolation fix: this page previously read through
  // createAdminClient() (service-role, bypasses RLS entirely), the same
  // bug class as CC-01 — `assets`/`asset_categories`/`asset_assignments`
  // have carried correct RESTRICTIVE business-isolation RLS since A001,
  // but this page was never actually subject to it. Session-scoped
  // client relies on that policy to scope reads correctly.
  const db=createClient();
  const [{data:categories,error:ce},{data:assets,error:ae},{data:employees,error:ee},{data:suppliers,error:se},{data:maintenance,error:me}]=await Promise.all([
    db.from('asset_categories').select('*').eq('active',true).order('name'),
    db.from('assets').select('*, category:asset_categories(name), supplier_ref:finance_suppliers(supplier_code,legal_name,trade_name)').order('created_at',{ascending:false}),
    db.from('employees').select('id,employee_no,first_name,last_name,preferred_name,employment_status').neq('employment_status','separated').order('last_name').order('first_name'),
    db.from('finance_suppliers').select('id,supplier_code,legal_name,trade_name').eq('active',true).order('legal_name'),
    db.from('asset_maintenance').select('*').order('service_date',{ascending:false}).limit(500)
  ]);
  if(ce||ae||ee||se||me) throw new Error(ce?.message||ae?.message||ee?.message||se?.message||me?.message||'Unable to load assets.');
  const assetIds=(assets??[]).map((a:any)=>a.id);
  const [{data:assignments,error:asError},{data:allAssignments,error:aaError}]=assetIds.length ? await Promise.all([
    db.from('asset_assignments').select('id,asset_id,employee_id,assigned_at,expected_return_date,issued_condition,employee:employees(employee_no,first_name,last_name,preferred_name)').in('asset_id',assetIds).is('returned_at',null),
    db.from('asset_assignments').select('id,asset_id,employee_id,assigned_at,returned_at,issued_condition,returned_condition,employee:employees(employee_no,first_name,last_name,preferred_name)').in('asset_id',assetIds).order('assigned_at',{ascending:false})
  ]) : [{data:[],error:null},{data:[],error:null}];
  if(asError) throw new Error(asError.message);
  if(aaError) throw new Error(aaError.message);
  const byAsset=new Map((assignments??[]).map((a:any)=>[a.asset_id,a]));
  // U028 — full assignment history per asset, not just the active one.
  const historyByAsset=new Map<string,any[]>();
  for(const row of (allAssignments??[]) as any[]){const list=historyByAsset.get(row.asset_id)??[];list.push(row);historyByAsset.set(row.asset_id,list);}
  const enriched=(assets??[]).map((a:any)=>({...a,active_assignment:byAsset.get(a.id)??null,assignment_history:historyByAsset.get(a.id)??[]}));
  return <AuthedShell profile={profile}><AssetsManagement categories={(categories??[]) as any} assets={enriched as any} employees={(employees??[]) as any} suppliers={(suppliers??[]) as any} maintenance={(maintenance??[]) as any}/></AuthedShell>;
}
