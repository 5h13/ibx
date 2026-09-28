import { NextResponse } from 'next/server';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.

const SOURCES:Record<string,string[]>={
  admin:['expenses','internal_requests','fleet_expenses'],
  finance:['purchase_requisitions','purchase_orders','finance_supplier_invoices','finance_supplier_payments','finance_customer_invoices','finance_customer_receipts','finance_cash_transactions','finance_budgets','finance_journal_entries','payroll_runs'],
  logistics:['logistics_receipts','logistics_stock_transfers','logistics_delivery_orders'],
  sales:['sales_orders','sales_revenue_recognitions','sales_commissions','sales_commission_payouts'],
  marketing:['marketing_campaigns'],
};

export async function GET(){
  const profile=await getSessionProfile();
  if(!profile) return NextResponse.json({error:'Authentication required.'},{status:401});
  const allowed=isAdminTier(profile)?Object.keys(SOURCES):[...new Set(profile.access.map(a=>a.section_code).filter((s): s is string => Boolean(s)).concat(profile.user.section_code||''))].filter((s): s is string => Boolean(s) && Boolean(SOURCES[s]));
  const db=createClient();
  const results:any[]=[];
  for(const section of allowed){
    for(const table of SOURCES[section]){
      const {data,error}=await db.from(table).select('id,status,updated_at').in('status',['prepared','reviewed','approved']).order('updated_at',{ascending:false}).limit(250);
      if(!error) results.push(...(data||[]).map((row:any)=>({...row,source_table:table,section_code:section})));
    }
  }
  return NextResponse.json({data:results});
}
