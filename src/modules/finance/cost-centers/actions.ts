'use server';
import { appError } from '@/core/errors/appError';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
function req(fd:FormData,k:string){const v=String(fd.get(k)||'').trim();if(!v)throw appError(`${k.replaceAll('_',' ')} is required.`);return v;}
function opt(fd:FormData,k:string){const v=String(fd.get(k)||'').trim();return v||null;}
async function finance(){const p=await getSessionProfile();if(!p||!p.user.is_active)throw appError('Authentication required.');if(!isAdminTier(p)&&p.user.role!=='finance'&&p.user.section_code!=='finance'&&!p.access.some(a=>a.section_code==='finance'))throw appError('Finance access required.');return p;}
export async function createCostCenterAction(fd:FormData){const p=await finance(),db=createClient();const {data,error}=await db.from('finance_cost_centers').insert({...biz(p),code:req(fd,'code').toUpperCase(),name:req(fd,'name'),description:opt(fd,'description'),created_by:p.user.id}).select('id').single();if(error||!data)throw appError(error?.message||'Unable to create cost center.');revalidatePath('/finance/cost-centers');return {ok:true};}
export async function updateCostCenterAction(fd:FormData){await finance();const db=createClient(),id=req(fd,'id');const {error}=await db.from('finance_cost_centers').update({name:req(fd,'name'),description:opt(fd,'description'),active:fd.get('active')==='on',updated_at:new Date().toISOString()}).eq('id',id);if(error)throw appError(error.message);revalidatePath('/finance/cost-centers');return {ok:true};}
