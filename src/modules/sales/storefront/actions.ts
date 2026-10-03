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
const REASON_TEXT: Record<string, string> = { below_floor: 'a price is below the 7% floor', no_cost: 'an item has no cost on record', late_entry: 'it is entered late (earlier sale date)',
  reserved_stock: 'it takes stock reserved for approved sales orders' };

export type SaleLineInput = { item_id: string; quantity: number; unit_price?: number | null; lot_id?: string | null };
/** Build 78: a lot with stock at the store, for the lot picker (no cost). */
export type LotOption = { lot_id: string; lot_code: string; received_date: string; on_hand: number; supplier_lot_no: string | null; expiry_date: string | null;
  supplier?: string | null; unit_cost?: number | null; list_price?: number | null; floor_price?: number | null };
export type PriceLine = { item_id: string; item_code: string; item_name: string; unit: string; item_type: string; list_price: number; floor_price: number; on_hand: number | null;
  no_cost: boolean; reserved: number | null; available: number | null; default_lot_id: string | null; lots: LotOption[]; stock_type?: 'stock' | 'order_only' };
export type PaymentInput = { method: 'cash' | 'gcash' | 'maya' | 'card' | 'bank_transfer' | 'check'; amount: number; reference?: string; account?: string;
  tendered?: number; check_bank?: string; check_date?: string; issuer?: string };

export async function priceLinesAction(itemIds: string[]) {
  await signedIn();
  if (!itemIds.length) return [];
  return rpc<PriceLine[]>('storefront_price_lines', { p_items: itemIds });
}

export async function addCustomerAction(input: { name: string; phone?: string; address?: string; tax_id?: string; agent_id?: string }) {
  await signedIn();
  // Build 86: every customer has an agent (default: the store's own agent)
  const id = await rpc<string>('storefront_add_customer', { p_name: input.name, p_phone: input.phone ?? null, p_address: input.address ?? null, p_tax_id: input.tax_id ?? null, p_agent: input.agent_id || null });
  refresh();
  return id;
}

export async function setStoreLocationAction(locationId: string) {
  await signedIn();
  await rpc('storefront_set_location', { p_location: locationId });
  refresh();
}

export async function submitSaleAction(input: { customer_id?: string | null; lines: SaleLineInput[]; payments: PaymentInput[]; si_number?: string; issue_dr: boolean; notes?: string; sale_date?: string; late_reason?: string; hardcopy_dr_no?: string }) {
  const p = await signedIn();
  const r = await rpc<{ id: string; sale_number: string; status: string; total: number; reasons: string[] }>('storefront_submit_sale', { p: input });
  if (r.status === 'pending_approval') {
    await notifyWorkflowRole(p.user.business_id, 'sales', 'approver', {
      entity_table: 'storefront_sales', entity_id: r.id,
      title: `Sale to approve: ${r.sale_number}`,
      message: `A counter sale needs your sign-off: ${(r.reasons ?? []).map((x) => REASON_TEXT[x] ?? x).join('; ')}.`,
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
  const r = await rpc<{ invoice_number: string; amount: number; balance: number; payment_id: string }>('storefront_collect_ar', { p_invoice: invoiceId, p_payments: payments });
  refresh();
  return r;
}

export type ReturnCondition = 'back_to_stock' | 'damaged' | 'wrong_item';
export async function saleForReturnAction(saleNumber: string) {
  await signedIn();
  return rpc<{ id: string; sale_number: string; dr_number: string | null; si_number: string | null; sale_date: string; customer: string; total: number; ar_balance: number; order_dr: boolean;
    hardcopy_dr_no?: string | null;
    lines: { sale_item_id: string; description: string; unit: string | null; item_type: string; sold: number; unit_price: number; returned: number; released: boolean; lot_code?: string | null }[] }>(
    'storefront_sale_for_return', { p_sale_number: saleNumber });
}

export async function returnAction(input: { sale_id: string; reason: string; lines: { sale_item_id: string; quantity: number; condition?: ReturnCondition }[]; refunds: PaymentInput[] }) {
  await signedIn();
  const r = await rpc<{ return_number: string; total: number; credit_to_ar: number; refund: number; damaged_cost: number }>('storefront_return', { p: input });
  refresh();
  return r;
}

export async function closingPreviewAction(date: string) {
  await signedIn();
  return rpc<{ by_method: Record<string, number>; expected_cash: number; sales_count: number; sales_total: number; charged_to_ar: number; returns_total: number;
    ar_collected: number; already_closed: boolean; awaiting_approval: number; float_total: number; cash_out_total: number; vat_total: number;
    checks: { number: string; bank: string; date: string; amount: number; pdc: boolean; payment: string }[];
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

// ---------------------------------------------------------------------------
// Build 74 (migration 20261126): cancellation of a completed sale (SF-17),
// customer checks (SF-27), DRs from sales orders and the Warehouse release (SF-01).

export async function requestCancelAction(saleId: string, reason: string) {
  const p = await signedIn();
  await rpc('storefront_request_cancel', { p_sale: saleId, p_reason: reason });
  await notifyWorkflowRole(p.user.business_id, 'sales', 'approver', {
    entity_table: 'storefront_sales', entity_id: saleId,
    title: 'Sale cancellation to approve',
    message: `A completed counter sale is to be cancelled: ${reason}`,
    action_url: '/sales/storefront?tab=approval',
  }).catch(() => undefined);
  refresh();
}
export async function decideCancelAction(saleId: string, approve: boolean, note?: string) {
  await signedIn();
  const r = await rpc<{ status: string; return_number?: string; refund?: number; credit_to_ar?: number }>('storefront_decide_cancel', { p_sale: saleId, p_approve: approve, p_note: note ?? null });
  refresh();
  return r;
}

export async function checkAction(checkId: string, action: 'deposit' | 'clear' | 'bounce', input: Record<string, string | null | undefined> = {}) {
  await signedIn();
  const r = await rpc<{ status: string; invoice_number: string | null }>('storefront_check_action', { p_check: checkId, p_action: action, p: input });
  refresh();
  return r;
}

export type OrderLine = { id: string; description: string; unit: string | null; ordered: number; unit_price: number; fulfilment: string; catalog_item_id: string | null;
  delivered: number; released: number; received: number | null; on_hand: number | null;
  reserved_here?: number; reserved_total?: number | null; default_lot_id?: string | null; lots?: LotOption[] };
export type OrderDr = { sale_id: string; sale_number: string; dr_number: string; si_number: string | null; sale_date: string; total: number; release_status: string | null;
  released_at: string | null; hardcopy_dr_no?: string | null; invoice_number: string | null; invoice_status: string | null; balance_due: number | null; due_date: string | null };
export type StoreOrder = { id: string; order_number: string; order_date: string; status: string; quotation_number: string | null; customer_id: string; customer: string;
  client_po: string | null; payment_terms: string | null; vat_applied: boolean; total: number; delivery_address: string | null; requested_delivery_date: string | null;
  pr_number: string | null; po_numbers: string[]; lines: OrderLine[]; drs: OrderDr[] };

export async function orderDrAction(input: { order_id: string; lines: { sales_order_item_id: string; quantity: number; lot_id?: string | null }[]; payments: PaymentInput[]; si_number?: string; notes?: string; hardcopy_dr_no?: string }) {
  const p = await signedIn();
  const r = await rpc<{ id: string; sale_number: string; dr_number: string; total: number; balance: number }>('storefront_order_dr', { p: input });
  await notifyWorkflowRole(p.user.business_id, 'logistics', 'preparer', {
    entity_table: 'storefront_sales', entity_id: r.id,
    title: `DR to release: ${r.dr_number}`,
    message: `DR ${r.dr_number} was issued from a sales order; confirm the physical release of the items.`,
    action_url: '/logistics/warehouse-delivery',
  }).catch(() => undefined);
  refresh();
  return r;
}

export async function releaseDrAction(saleId: string, locationId?: string | null) {
  await signedIn();
  const r = await rpc<{ dr_number: string; order_complete: boolean }>('storefront_release_dr', { p_sale: saleId, p_location: locationId ?? null });
  refresh();
  revalidatePath('/logistics/warehouse-delivery');
  return r;
}

// ---------------------------------------------------------------------------
// Build 75 (migration 20261201): one booklet SI across several DRs of an order.
export async function combinedSiAction(input: { sale_ids: string[]; si_number: string; si_date?: string }) {
  await signedIn();
  const r = await rpc<{ invoice_number: string; total: number; received: number; balance: number; drs: string }>('storefront_combined_si', { p: input });
  refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Build 78 (migration 20261209): cancelling a sales order releases its stock
// reservation (Sales approver / Business Admin; only while no DR is out).
export async function cancelOrderAction(orderId: string, reason: string) {
  await signedIn();
  const r = await rpc<{ order_number: string; pr_number: string | null }>('sales_order_cancel', { p_order: orderId, p_reason: reason });
  refresh();
  revalidatePath('/sales/revenue');
  return r;
}
