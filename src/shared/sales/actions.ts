// src/shared/sales/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { createSalesDraft } from './service';

async function transition(id: string, status: 'prepared' | 'reviewed' | 'approved', stampField: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('sales_data')
    .update({ status, [stampField]: user?.id, [`${stampField.replace('_by', '_at')}`]: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function submitSalesForReviewAction(id: string) {
  await transition(id, 'prepared', 'prepared_by');
  revalidatePath('/', 'layout');
}

export async function markSalesReviewedAction(id: string) {
  await transition(id, 'reviewed', 'reviewed_by');
  revalidatePath('/', 'layout');
}

export async function markSalesApprovedAction(id: string) {
  await transition(id, 'approved', 'approved_by');
  revalidatePath('/', 'layout');
}

export async function createSalesDraftAction(monthId: string, formData: FormData) {
  await createSalesDraft(
    monthId,
    String(formData.get('agent_name') ?? ''),
    Number(formData.get('gross_sales') ?? 0),
    Number(formData.get('cash_collected') ?? 0),
    Number(formData.get('gcash_collected') ?? 0),
    Number(formData.get('expenses') ?? 0),
    Number(formData.get('commission_rate') ?? 0)
  );
  revalidatePath('/', 'layout');
}
