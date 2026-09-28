'use server';
import { appError } from '@/core/errors/appError';

// Build 67 — Storefront / Counter Sales (DOC-15) server actions. Every write
// goes through a SECURITY DEFINER database function (migration 20261118) that
// checks the caller's role and business and recomputes prices; these actions
// only pass the request on and refresh the page.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { notifyWorkflowRole } from '@/shared/notifications/service';

async function signedIn() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  return p;
}
async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args ?? {});
  if (error) throw appError(error.message);
  return data as T;
}
const refresh = () => revalidatePath('/sales/storefront');

export type SaleLineInput = { item_id: string; quantity: number; unit_price?: number | null };
export type PaymentInput = { method: 'cash' | 'gcash' | 'maya' | 'card' | 'bank_transfer'; amount: number; reference?: string; account?: string };

export async function priceLinesAction(itemIds: string[]) {
  await signedIn();
  if (!itemIds.length) return [];
  return rpc<any[]>('storefront_price_lines', { p_items: itemIds });
}

export async function addCustomerAction(input: { name: string; phone?: string; address?: string; tax_id?: string }) {
  await signedIn();
  const id = await rpc<string>('storefront_add_customer', { p_name: input.name, p_phone: input.phone ?? null, p_address: input.address ?? null, p_tax_id: input.tax_id ?? null });
  refresh();
  return id;
}

export async function setStoreLocationAction(locationId: string) {
  await signedIn();
  await rpc('storefront_set_location', { p_location: locationId });
  refresh();
}

export async function submitSaleAction(input: { customer_id?: string | null; lines: SaleLineInput[]; payments: PaymentInput[]; si_number?: string; issue_dr: boolean; notes?: string }) {
  const p = await signedIn();
  const r = await rpc<{ id: string; sale_number: string; status: string; total: number }>('storefront_submit_sale', { p: input });
  if (r.status === 'pending_approval') {
    await notifyWorkflowRole(p.user.business_id, 'sales', 'approver', {
      entity_table: 'storefront_sales', entity_id: r.id,
      title: `Price approval needed: ${r.sale_number}`,
      message: 'A counter sale has a price below the 7% markup floor and needs your sign-off.',
      action_url: '/sales/storefront?tab=approval',
    }).catch(() => undefined);
  }
  refresh();
  return r;
}

export async function approveSaleAction(saleId: string) {
  await signedIn();
  await rpc('storefront_approve_sale', { p_sale: saleId });
  refresh();
}

export async function completeSaleAction(saleId: string, input: { payments: PaymentInput[]; si_number?: string; issue_dr: boolean }) {
  await signedIn();
  await rpc('storefront_complete_sale', { p_sale: saleId, p_payments: input.payments, p_si: input.si_number ?? null, p_issue_dr: input.issue_dr });
  refresh();
}

export async function cancelSaleAction(saleId: string) {
  await signedIn();
  await rpc('storefront_cancel_sale', { p_sale: saleId });
  refresh();
}

// ---------------------------------------------------------------------------
// Build 68 — DOC-15 part 2: old AR at the counter, returns / refunds and the
// daily closing (migration 20261119). Same rule: the database functions check
// role, business and amounts.

export async function openInvoicesAction(customerId: string) {
  await signedIn();
  return rpc<{ invoice_id: string; invoice_number: string; invoice_date: string; due_date: string | null; total_amount: number; amount_received: number; balance_due: number }[]>(
    'storefront_open_invoices', { p_customer: customerId });
}

export async function collectArAction(invoiceId: string, payments: PaymentInput[]) {
  await signedIn();
  const r = await rpc<{ invoice_number: string; amount: number; balance: number }>('storefront_collect_ar', { p_invoice: invoiceId, p_payments: payments });
  refresh();
  return r;
}

export async function saleForReturnAction(saleNumber: string) {
  await signedIn();
  return rpc<{ id: string; sale_number: string; sale_date: string; customer: string; total: number; ar_balance: number;
    lines: { sale_item_id: string; description: string; unit: string | null; item_type: string; sold: number; unit_price: number; returned: number }[] }>(
    'storefront_sale_for_return', { p_sale_number: saleNumber });
}

export async function returnAction(input: { sale_id: string; reason: string; lines: { sale_item_id: string; quantity: number }[]; refunds: PaymentInput[] }) {
  await signedIn();
  const r = await rpc<{ return_number: string; total: number; credit_to_ar: number; refund: number }>('storefront_return', { p: input });
  refresh();
  return r;
}

export async function closingPreviewAction(date: string) {
  await signedIn();
  return rpc<{ by_method: Record<string, number>; expected_cash: number; sales_count: number; sales_total: number; charged_to_ar: number; returns_total: number;
    ar_collected: number; already_closed: boolean; awaiting_approval: number; float_total: number; cash_out_total: number; vat_total: number;
    cash_movements: { number: string; date: string; kind: 'float' | 'cash_out'; category: string | null; amount: number; note: string | null }[] }>('storefront_closing_preview', { p_date: date });
}

export async function closeDayAction(input: { date: string; counted_cash: number; notes?: string }) {
  const p = await signedIn();
  const r = await rpc<{ id: string; closing_number: string; variance: number }>('storefront_close_day', { p_date: input.date, p_counted_cash: input.counted_cash, p_notes: input.notes ?? null });
  await notifyWorkflowRole(p.user.business_id, 'sales', 'approver', {
    entity_table: 'storefront_closings', entity_id: r.id,
    title: `Daily closing to approve: ${r.closing_number}`,
    message: `Storefront day ${input.date} closed with a cash variance of ${Number(r.variance).toFixed(2)}.`,
    action_url: '/sales/storefront?tab=closing',
  }).catch(() => undefined);
  refresh();
  return r;
}

export async function decideClosingAction(closingId: string, approve: boolean, note?: string) {
  await signedIn();
  await rpc('storefront_decide_closing', { p_closing: closingId, p_approve: approve, p_note: note ?? null });
  refresh();
}

// ---------------------------------------------------------------------------
// Build 70 — audit fixes (migration 20261121): refunds per payment method
// (SF-11) and the cash drawer's opening float / cash taken out (SF-16).

export async function refundableAction(saleId: string) {
  await signedIn();
  return rpc<{ method: PaymentInput['method']; paid: number; refunded: number; refundable: number }[]>('storefront_refundable', { p_sale: saleId });
}

export async function cashMovementAction(input: { kind: 'float' | 'cash_out'; amount: number; category?: 'bank_deposit' | 'petty_cash' | 'other' | null; note?: string; bank_account?: string | null }) {
  await signedIn();
  const r = await rpc<{ id: string; movement_number: string }>('storefront_cash_movement', {
    p_kind: input.kind, p_amount: input.amount, p_category: input.category ?? null, p_note: input.note ?? null, p_bank_account: input.bank_account ?? null,
  });
  refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Build 71 — Storefront → Finance and VAT (migration 20261122): receiving
// accounts (cash drawer, GCash / Maya numbers, card clearing, bank), the SI
// booklet the store uses, and the business's VAT registration.

export type ReceivingAccount = { id: string; payment_method: PaymentInput['method']; account_code: string; account_name: string; mobile_number: string | null; bank_name: string | null; account_number_masked: string | null; active: boolean };

export async function receivingAccountsAction() {
  await signedIn();
  return rpc<ReceivingAccount[]>('storefront_receiving_accounts');
}
export async function addReceivingAccountAction(input: { method: PaymentInput['method']; name: string; number?: string; bank?: string }) {
  await signedIn();
  const id = await rpc<string>('storefront_add_receiving_account', { p_method: input.method, p_name: input.name, p_number: input.number ?? null, p_bank: input.bank ?? null });
  refresh();
  return id;
}
export async function setReceivingAccountActiveAction(accountId: string, active: boolean) {
  await signedIn();
  await rpc('storefront_set_receiving_account_active', { p_account: accountId, p_active: active });
  refresh();
}
export async function bookletOptionsAction() {
  await signedIn();
  return rpc<{ id: string; code: string; name: string; vat_registered: boolean }[]>('storefront_booklet_options');
}
export async function setBookletAction(businessId: string) {
  await signedIn();
  await rpc('storefront_set_booklet', { p_booklet_business: businessId });
  refresh();
}
export async function setVatRegisteredAction(registered: boolean) {
  await signedIn();
  await rpc('storefront_set_vat_registered', { p_registered: registered });
  refresh();
}
