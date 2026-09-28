'use server';
import { appError } from '@/core/errors/appError';

// Build 56 — supplier quote log (DOC-14) and "Set as current cost" (DOC-04).
// Session-scoped client throughout: RLS (can_view_supplier_quotes /
// can_manage_supplier_quotes) is the real boundary; the app-level checks
// below only give clearer error messages.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { canManageSupplierQuotes } from './supplierQuoteAccess';

const VALIDITY = ['while_supply_lasts', 'fixed_price'] as const;

async function manager() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!canManageSupplierQuotes(p)) throw appError('Only Procurement can manage the supplier quote log.');
  return p;
}
function req(fd: FormData, k: string) { const v = String(fd.get(k) ?? '').trim(); if (!v) throw appError(`${k.replaceAll('_', ' ')} is required.`); return v; }
function price(fd: FormData) { const n = Number(req(fd, 'unit_price')); if (!Number.isFinite(n) || n < 0) throw appError('Price must be zero or greater.'); return Math.round(n * 100) / 100; }
function validity(fd: FormData) { const v = String(fd.get('validity') || 'while_supply_lasts'); if (!(VALIDITY as readonly string[]).includes(v)) throw appError('Invalid validity.'); return v; }
function leadTime(fd: FormData) { return String(fd.get('lead_time') ?? '').trim() || 'Within the day'; }
function refresh() { revalidatePath('/finance/procurement/supplier-quotes'); revalidatePath('/finance/procurement'); }

async function audit(actor: string, id: string, action: string, detail: Record<string, unknown>) {
  const { error } = await createClient().from('audit_log').insert({ actor_id: actor, entity_table: 'finance_supplier_quote_log', entity_id: id, action, detail });
  if (error) throw appError(error.message);
}

export async function createSupplierQuoteAction(fd: FormData) {
  const p = await manager();
  const db = createClient();
  const row = { item_id: req(fd, 'item_id'), supplier_id: req(fd, 'supplier_id'), unit_price: price(fd), validity: validity(fd), lead_time: leadTime(fd) };
  const { data, error } = await db.from('finance_supplier_quote_log').insert(row).select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to record the supplier quote.');
  await audit(p.user.id, data.id, 'supplier_quote_recorded', row);
  if (String(fd.get('set_as_current') || '') === 'on') await setCurrentCostFromQuoteAction(data.id);
  refresh();
  return { ok: true };
}

export async function updateSupplierQuoteAction(fd: FormData) {
  const p = await manager();
  const id = req(fd, 'quote_id');
  const patch = { unit_price: price(fd), validity: validity(fd), lead_time: leadTime(fd) };
  const db = createClient();
  const { error } = await db.from('finance_supplier_quote_log').update(patch).eq('id', id);
  if (error) throw appError(error.message);
  await audit(p.user.id, id, 'supplier_quote_edited', patch);
  // If this quote is an item's current cost, the cost follows the corrected price.
  const { data: used } = await db.from('finance_procurement_items').select('id').eq('cost_source_quote_id', id).limit(1);
  if (used && used.length) await setCurrentCostFromQuoteAction(id);
  refresh();
  return { ok: true };
}

export async function deleteSupplierQuoteAction(id: string) {
  const p = await manager();
  const db = createClient();
  const { data: used } = await db.from('finance_procurement_items').select('id').eq('cost_source_quote_id', id).limit(1);
  if (used && used.length) throw appError('This quote is the source of an item\'s current cost. Set a different current cost first.');
  const { error } = await db.from('finance_supplier_quote_log').delete().eq('id', id);
  if (error) throw appError(error.message);
  await audit(p.user.id, id, 'supplier_quote_deleted', {});
  refresh();
  return { ok: true };
}

export async function setCurrentCostFromQuoteAction(id: string) {
  const p = await manager();
  const { error } = await createClient().rpc('set_item_cost_from_quote', { p_quote_id: id });
  if (error) throw appError(error.message);
  await audit(p.user.id, id, 'supplier_quote_set_as_current_cost', {});
  refresh();
  return { ok: true };
}

export async function getItemCostHistoryAction(itemId: string) {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  const db = createClient();
  const [{ data: item, error: ie }, { data: rows, error: re }] = await Promise.all([
    db.from('finance_procurement_items').select('id,item_type,standard_cost,service_cost_basis,cost_updated_at,cost_source_quote_id').eq('id', itemId).maybeSingle(),
    db.from('finance_item_cost_history').select('id,cost_field,previous_cost,new_cost,source,set_at,supplier:finance_suppliers(legal_name),business:businesses!finance_item_cost_history_set_for_business_id_fkey(code)').eq('item_id', itemId).order('set_at', { ascending: false }).limit(50),
  ]);
  if (ie) throw appError(ie.message);
  if (re) throw appError(re.message);
  return { item, rows: rows ?? [] };
}
