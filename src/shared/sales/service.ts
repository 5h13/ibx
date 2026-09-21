// src/shared/sales/service.ts
//
// Sales-module-specific: agent sales entries (sales_data table), covering
// the Ikot Sales / commission workflow from the source data. Same
// Prepare -> Review -> Approve lifecycle as expenses, but its own table
// since the fields differ (agent, collections, commission).

import { createClient } from '@/core/auth/supabaseServer';

export interface SalesRow {
  id: string;
  section_id: string;
  month_id: string;
  agent_name: string | null;
  gross_sales: number;
  cash_collected: number;
  gcash_collected: number;
  expenses: number;
  net_sales: number;
  commission_rate: number | null;
  commission_amount: number | null;
  status: 'draft' | 'prepared' | 'reviewed' | 'approved';
  prepared_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  created_at: string;
}

async function getSalesSectionId(): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.from('sections').select('id').eq('code', 'sales').single();
  if (error || !data) throw new Error('Sales section not found');
  return data.id;
}

export async function listSalesEntries(monthId: string): Promise<SalesRow[]> {
  const supabase = createClient();
  const sectionId = await getSalesSectionId();
  const { data, error } = await supabase
    .from('sales_data')
    .select('*')
    .eq('section_id', sectionId)
    .eq('month_id', monthId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSalesDraft(
  monthId: string,
  agentName: string,
  grossSales: number,
  cashCollected: number,
  gcashCollected: number,
  expenses: number,
  commissionRate: number
) {
  const supabase = createClient();
  const sectionId = await getSalesSectionId();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const totalCollected = cashCollected + gcashCollected;
  const netSales = totalCollected - expenses;
  const commissionAmount = netSales * commissionRate;

  const { error } = await supabase.from('sales_data').insert({
    section_id: sectionId,
    month_id: monthId,
    agent_name: agentName,
    gross_sales: grossSales,
    cash_collected: cashCollected,
    gcash_collected: gcashCollected,
    expenses,
    net_sales: netSales,
    commission_rate: commissionRate,
    commission_amount: commissionAmount,
    status: 'draft',
    prepared_by: user.id,
  });
  if (error) throw error;
}
