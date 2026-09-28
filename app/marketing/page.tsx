import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import MarketingManagement from '@/modules/marketing/MarketingManagement';

export default async function MarketingPage(){
 const profile=await requireSection('marketing'); const db=createClient();
 const [{data:campaigns},{data:channels},{data:leads},{data:activities},{data:users}]=await Promise.all([
  db.from('marketing_campaigns').select('*,channel:marketing_channels(channel_name),owner:users!marketing_campaigns_owner_id_fkey(full_name)').order('created_at',{ascending:false}),
  db.from('marketing_channels').select('*').order('channel_name'),
  db.from('marketing_leads').select('*,campaign:marketing_campaigns(campaign_name)').order('created_at',{ascending:false}),
  db.from('marketing_activities').select('*,lead:marketing_leads(contact_name)').order('activity_date',{ascending:false}).limit(100),
  db.from('users').select('id,full_name,email').eq('is_active',true).order('full_name')
 ]);
 return <AuthedShell profile={profile}><div className="flex items-center justify-between mb-4"><div><h2 className="text-lg font-semibold">Marketing</h2><p className="text-sm text-slate-500">Campaigns, lead pipeline, channels and activity tracking.</p></div></div><MarketingManagement campaigns={campaigns||[]} channels={channels||[]} leads={leads||[]} activities={activities||[]} users={users||[]}/></AuthedShell>
}
