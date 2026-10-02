'use server';
// Build 77 — DOC-03: Procurement answers Sales' supplier price requests on
// quotation lines. The database (procurement_answer_price_request, migration
// 20261205) checks the role and business, logs the supplier quote, optionally
// sets the current cost, re-prices the quote line and notifies Sales.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';

async function procurement() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!isAdminTier(p) && p.user.role !== 'finance' && !p.access.some((a) => a.section_code === 'finance')) throw appError('Procurement (Finance) access required.');
  return p;
}

export async function answerPriceRequestAction(fd: FormData) {
  await procurement();
  const v = (k: string) => String(fd.get(k) ?? '').trim();
  if (!v('supplier_id')) throw appError('Choose the supplier.');
  if (v('unit_price') === '' || Number(v('unit_price')) < 0) throw appError("Enter the supplier's unit price.");
  const { data, error } = await createClient().rpc('procurement_answer_price_request', {
    p: {
      quotation_item_id: v('quotation_item_id'), supplier_id: v('supplier_id'), unit_price: Number(v('unit_price')),
      validity: v('validity') || 'while_supply_lasts', lead_time: v('lead_time') || null, terms: v('terms') || null,
      log_quote: fd.get('log_quote') === '1', set_current_cost: fd.get('set_current_cost') === '1',
    },
  });
  if (error) throw appError(error.message);
  revalidatePath('/finance/price-requests'); revalidatePath('/sales/revenue'); revalidatePath('/finance/procurement');
  return data as { quotation_number: string; line_price: number; logged: boolean; current_cost_set: boolean };
}
