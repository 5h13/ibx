'use server';
// Build 91 — agent portal server actions. Every read / write goes through a
// SECURITY DEFINER database function that checks the agent (agent_require)
// and that the client is his; these actions only pass the request on.
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

const AGENT_BUCKET = 'agent-files';

async function agentId(): Promise<string> {
  const p = await getSessionProfile();
  if (!p?.user.is_active || p.user.role !== 'agent') throw appError('This is for agent logins.');
  const { data, error } = await createClient().rpc('current_agent_id');
  if (error) throw appError(error.message);
  if (!data) throw appError('Your login is not linked to an agent record yet. Ask the Business Admin.');
  return data as string;
}
async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  await agentId();
  const { data, error } = await createClient().rpc(fn, args ?? {});
  if (error) throw appError(error.message);
  return data as T;
}
const refresh = () => revalidatePath('/agent', 'layout');

export async function setAgentStoreAction(businessId: string) {
  await agentId();
  (await cookies()).set('ibx_agent_store', businessId, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  refresh();
}

export async function addClientAction(input: { business_id: string; name: string; phone?: string; address?: string; tax_id?: string }) {
  const id = await rpc<string>('agent_add_client', { p_business: input.business_id, p_name: input.name, p_phone: input.phone ?? null, p_address: input.address ?? null, p_tax_id: input.tax_id ?? null });
  refresh();
  return id;
}

export async function setClientTierAction(customerId: string, tier: number) {
  await rpc('agent_set_client_tier', { p_customer: customerId, p_tier: tier });
  refresh();
}

export type CatalogRow = {
  item_id: string; item_code: string; item_name: string; category: string | null; brand: string | null; description: string | null; unit: string; item_type: string;
  photo_path: string | null; on_hand: number | null; available: number | null; stock_type: string | null; acquisition_cost: number | null; markup_percent: number | null;
  list_price: number | null; floor_price: number | null; tier2: number | null; tier3: number | null; tier4: number | null; client_tier: number; client_discount: number | null;
  client_price: number | null; total_count: number; photo_url?: string | null;
};
export async function catalogAction(input: { business_id: string; customer_id?: string | null; q?: string; category?: string; in_stock?: boolean; offset?: number }) {
  const rows = await rpc<CatalogRow[]>('agent_catalog', {
    p_business: input.business_id, p_customer: input.customer_id || null, p_q: input.q?.trim() || null, p_category: input.category || null,
    p_in_stock: !!input.in_stock, p_limit: 40, p_offset: input.offset ?? 0,
  });
  const paths = (rows ?? []).map((r) => r.photo_path).filter((x): x is string => !!x);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await createAdminClient().storage.from('catalog-photos').createSignedUrls(paths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return (rows ?? []).map((r) => ({ ...r, photo_url: r.photo_path ? urls.get(r.photo_path) ?? null : null }));
}

export type OrderLineInput = { item_id: string; quantity: number; tier?: number | null; unit_price?: number | null };
export async function saveOrderAction(input: { id?: string | null; business_id: string; customer_id: string; notes?: string; lines: OrderLineInput[]; send?: boolean }) {
  const id = await rpc<string>('agent_order_save', { p: input });
  refresh();
  return id;
}
export async function orderStatusAction(orderId: string, status: 'sent' | 'cancelled') {
  await rpc('agent_order_set_status', { p_order: orderId, p_status: status });
  refresh();
}

export async function openInvoicesAction(customerId: string) {
  return rpc<{ invoice_id: string; invoice_number: string; invoice_date: string; due_date: string | null; total_amount: number; amount_received: number; balance_due: number;
    dr_numbers: string | null; si_number: string | null; reported: number }[]>('agent_open_invoices', { p_customer: customerId });
}

/** Receipt / deposit photo: stored privately under the agent's folder; returns the path. */
export async function uploadAgentPhotoAction(fd: FormData) {
  const id = await agentId();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) throw appError('Choose a photo.');
  if (file.size > 8 * 1024 * 1024) throw appError('The photo must be 8 MB or smaller.');
  if (file.type && !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && file.type !== 'application/pdf') throw appError('Use a photo (JPG, PNG, WebP) or a PDF.');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
  const path = `${id}/${crypto.randomUUID()}-${safe}`;
  const { error } = await createAdminClient().storage.from(AGENT_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw appError(error.message);
  return path;
}

export async function reportPaymentAction(input: { customer_id: string; method: string; reference?: string; paid_on: string; check_bank?: string; check_date?: string;
  issuer?: string; notes?: string; photo_path?: string | null; allocations: { invoice_id: string; amount: number }[] }) {
  const id = await rpc<string>('agent_payment_report', { p: input });
  refresh();
  return id;
}
export async function cancelPaymentAction(reportId: string) {
  await rpc('agent_payment_cancel', { p_report: reportId });
  refresh();
}

export async function submitExpenseAction(input: { business_id: string; category_id: string; amount: number; expense_date: string; description: string; photo_path?: string | null }) {
  const id = await rpc<string>('agent_expense_submit', { p: input });
  refresh();
  return id;
}
export async function cancelExpenseAction(id: string) {
  await rpc('agent_expense_cancel', { p_id: id });
  refresh();
}

/** A short-lived link to one of the agent's own photos. */
export async function agentPhotoUrlAction(path: string) {
  const id = await agentId();
  if (!path.startsWith(`${id}/`)) throw appError('Not your file.');
  const { data, error } = await createAdminClient().storage.from(AGENT_BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw appError(error?.message || 'Unable to open the photo.');
  return data.signedUrl;
}

// Build 92 — agent quotations (approved by the Sales approver) and commission.
export async function saveQuoteAction(input: { business_id: string; customer_id: string; notes?: string; payment_terms?: string; delivery_lead_time?: string; valid_until?: string;
  lines: OrderLineInput[] }) {
  const id = await rpc<string>('agent_quote_save', { p: input });
  refresh();
  return id;
}

// Build 95 — one product for the agent app's detail view (photos as short-lived links).
export type ProductDetail = {
  item_id: string; item_code: string; item_name: string; category: string | null; generic_item: string | null; brand: string | null; description: string | null;
  specification: string | null; unit: string; item_type: string; stock_type: string | null; photo_paths: string[]; photo_urls: string[];
  on_hand: number | null; reserved: number | null; available: number | null; list_price: number | null; acquisition_cost: number | null; floor_price: number | null;
  markup_percent: number | null; tier2: number | null; tier3: number | null; tier4: number | null; client_tier: number | null; client_price: number | null; client_discount: number | null;
};
export async function productDetailAction(input: { business_id: string; item_id: string; customer_id?: string | null }) {
  const d = await rpc<ProductDetail>('agent_product_detail', { p_business: input.business_id, p_item: input.item_id, p_customer: input.customer_id || null });
  let urls: string[] = [];
  if (d.photo_paths?.length) {
    const { data } = await createAdminClient().storage.from('catalog-photos').createSignedUrls(d.photo_paths, 3600);
    urls = (data ?? []).map((x) => x.signedUrl).filter((x): x is string => !!x);
  }
  return { ...d, photo_urls: urls };
}
