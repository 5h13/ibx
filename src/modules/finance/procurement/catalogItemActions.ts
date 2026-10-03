'use server';
import { appError } from '@/core/errors/appError';

// Build 60 — catalog items in the user's column layout:
//   STANDARD ITEM NAME | CATEGORY | ITEM | BRAND | DESCRIPTION | Product Photo |
//   SUPPLIER | SUPPLIER ITEM CODE | Supplier Cost | Add on | Acquisition Cost |
//   STORE PRICE | %Mark up
// Add on / Acquisition Cost / STORE PRICE are calculated (category add-on %
// and item markup % of the user's business); everything else is entered.

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier, type SessionProfile } from '@/core/auth/types';
import { CATALOG_PHOTO_BUCKET, normalizeCatalogHeader } from './catalogColumns';
import { looksLikeXlsx, readXlsxRows } from './xlsxReader';

type Db = ReturnType<typeof createClient>;

function txt(fd: FormData, key: string) { const v = String(fd.get(key) ?? '').trim(); return v || null; }
function need(fd: FormData, key: string, label: string) { const v = txt(fd, key); if (!v) throw appError(`${label} is required.`); return v; }
function money(v: unknown, label: string) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[₱,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw appError(`${label} must be a number of 0 or more.`);
  return n;
}
function percent(v: unknown, label: string) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[%,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw appError(`${label} must be between 0% and 1000%.`);
  return n;
}

async function financeUser(): Promise<SessionProfile> {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  if (!isAdminTier(p) && p.user.section_code !== 'finance' && !p.access.some((a) => a.section_code === 'finance')) throw appError('Finance access required.');
  return p;
}
async function audit(actor: string, id: string, table: string, action: string, detail: Record<string, unknown>) {
  const { error } = await createClient().from('audit_log').insert({ actor_id: actor, entity_table: table, entity_id: id, action, detail });
  if (error) throw appError(error.message);
}
/** Business whose markup / add-on is being set: own business, or the Super Admin's "Acting as" business. */
function pricingBusiness(p: SessionProfile) {
  if (!p.user.business_id) throw appError('Select a business in "Acting as" before setting a markup or add-on — they are set per business.');
  return p.user.business_id;
}

async function saveItemMarkup(db: Db, p: SessionProfile, itemId: string, markup: number | null) {
  if (markup === null) return;
  const businessId = pricingBusiness(p);
  const { data, error } = await db.from('finance_catalog_item_pricing')
    .upsert({ business_id: businessId, item_id: itemId, markup_percent: markup, active: true, updated_at: new Date().toISOString(), created_by: p.user.id }, { onConflict: 'business_id,item_id' })
    .select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to save the markup.');
  await audit(p.user.id, data.id, 'finance_catalog_item_pricing', 'item_markup_updated', { markup_percent: markup, business_id: businessId });
}

/** Supplier item code lives on the item ↔ supplier relationship (shared master). */
async function saveSupplierItemCode(db: Db, p: SessionProfile, itemId: string, supplierId: string | null, code: string | null) {
  if (!supplierId) return;
  const { data: existing, error: e1 } = await db.from('finance_procurement_item_suppliers').select('id,supplier_item_code').eq('item_id', itemId).eq('supplier_id', supplierId).maybeSingle();
  if (e1) throw appError(e1.message);
  if (existing) {
    if ((existing.supplier_item_code ?? null) === code) return;
    const { error } = await db.from('finance_procurement_item_suppliers').update({ supplier_item_code: code, active: true, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) throw appError(error.message);
  } else {
    const { error } = await db.from('finance_procurement_item_suppliers').insert({ item_id: itemId, supplier_id: supplierId, supplier_item_code: code, preferred: true, created_by: p.user.id });
    if (error) throw appError(error.message);
  }
}

const PHOTO_SLOTS = [['photo', 'photo_path'], ['photo_2', 'photo_path_2'], ['photo_3', 'photo_path_3']] as const;
async function savePhoto(itemId: string, file: FormDataEntryValue | null, oldPath: string | null, column: 'photo_path' | 'photo_path_2' | 'photo_path_3' = 'photo_path') {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 5 * 1024 * 1024) throw appError('Product photos must be 5 MB or smaller.');
  if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw appError('Product photo must be JPG, PNG or WebP.');
  const admin = createAdminClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const path = `${itemId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await admin.storage.from(CATALOG_PHOTO_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw appError(error.message);
  const { error: ue } = await createClient().from('finance_procurement_items').update({ [column]: path, updated_at: new Date().toISOString() }).eq('id', itemId);
  if (ue) { await admin.storage.from(CATALOG_PHOTO_BUCKET).remove([path]); throw appError(ue.message); }
  if (oldPath) await admin.storage.from(CATALOG_PHOTO_BUCKET).remove([oldPath]);
  return path;
}

function readItemForm(fd: FormData) {
  const itemType = txt(fd, 'item_type') || 'product';
  if (!['product', 'service'].includes(itemType)) throw appError('Invalid catalog item type.');
  const cost = money(fd.get('supplier_cost'), 'Supplier Cost') ?? 0;
  return {
    item_name: need(fd, 'item_name', 'Standard item name'),
    category: need(fd, 'category', 'Category'),
    generic_item: txt(fd, 'generic_item'),
    brand: txt(fd, 'brand'),
    description: txt(fd, 'description'),
    specification: txt(fd, 'specification'),
    default_supplier_id: txt(fd, 'default_supplier_id'),
    unit: need(fd, 'unit', 'Unit'),
    item_type: itemType,
    standard_cost: itemType === 'service' ? 0 : cost,
    service_cost_basis: itemType === 'service' ? cost : 0,
    supplier_item_code: txt(fd, 'supplier_item_code'),
    markup: percent(fd.get('markup_percent'), '%Mark up'),
  };
}

export async function createCatalogItemAction(fd: FormData) {
  const p = await financeUser(); const db = createClient();
  const f = readItemForm(fd);
  const { data: duplicate } = await db.from('finance_procurement_items').select('id,item_code,item_name').ilike('item_name', f.item_name).ilike('category', f.category).ilike('unit', f.unit).eq('active', true).limit(1).maybeSingle();
  if (duplicate) throw appError(`A matching active catalog item already exists: ${duplicate.item_code} — ${duplicate.item_name}. Select the existing item instead of creating a duplicate.`);
  const { data, error } = await db.from('finance_procurement_items').insert({
    item_name: f.item_name, category: f.category, generic_item: f.generic_item, brand: f.brand, description: f.description, specification: f.specification,
    default_supplier_id: f.default_supplier_id, unit: f.unit, item_type: f.item_type,
    standard_cost: f.standard_cost, service_cost_basis: f.service_cost_basis, created_by: p.user.id,
  }).select('id,item_code').single();
  if (error?.code === '23505') throw appError(`An active catalog item with this name, category and unit already exists. Select the existing item instead of creating a duplicate.`);
  if (error || !data) throw appError(error?.message || 'Unable to create catalog item.');
  await saveSupplierItemCode(db, p, data.id, f.default_supplier_id, f.supplier_item_code);
  await saveItemMarkup(db, p, data.id, f.markup);
  for (const [field, column] of PHOTO_SLOTS) await savePhoto(data.id, fd.get(field), null, column);
  await audit(p.user.id, data.id, 'finance_procurement_items', 'procurement_item_created', { item_code: data.item_code });
  revalidatePath('/finance/procurement');
  return { item_code: data.item_code as string };
}

export async function updateCatalogItemAction(fd: FormData) {
  const p = await financeUser(); const db = createClient();
  const id = need(fd, 'item_id', 'Item');
  const f = readItemForm(fd);
  const { data: current, error: ce } = await db.from('finance_procurement_items').select('id,item_code,photo_path,photo_path_2,photo_path_3,standard_cost,service_cost_basis').eq('id', id).single();
  if (ce || !current) throw appError(ce?.message || 'Catalog item not found.');
  const { data: duplicate } = await db.from('finance_procurement_items').select('id,item_code,item_name').ilike('item_name', f.item_name).ilike('category', f.category).ilike('unit', f.unit).eq('active', true).neq('id', id).limit(1).maybeSingle();
  if (duplicate) throw appError(`Another active catalog item already has this name, category and unit: ${duplicate.item_code} — ${duplicate.item_name}.`);
  const patch: Record<string, unknown> = {
    item_name: f.item_name, category: f.category, generic_item: f.generic_item, brand: f.brand, description: f.description, specification: f.specification,
    default_supplier_id: f.default_supplier_id, unit: f.unit, item_type: f.item_type, updated_at: new Date().toISOString(),
  };
  // only touch the cost when it actually changed, so the cost history (Build 56) stays accurate
  if (Number(current.standard_cost) !== f.standard_cost) patch.standard_cost = f.standard_cost;
  if (Number(current.service_cost_basis) !== f.service_cost_basis) patch.service_cost_basis = f.service_cost_basis;
  const { error } = await db.from('finance_procurement_items').update(patch).eq('id', id);
  if (error?.code === '23505') throw appError('Another active catalog item already has this name, category and unit.');
  if (error) throw appError(error.message);
  await saveSupplierItemCode(db, p, id, f.default_supplier_id, f.supplier_item_code);
  await saveItemMarkup(db, p, id, f.markup);
  for (const [field, column] of PHOTO_SLOTS) {
    const old = (current as any)[column] as string | null;
    if (String(fd.get(`remove_${field}`) || '') === 'true' && old) {
      await createAdminClient().storage.from(CATALOG_PHOTO_BUCKET).remove([old]);
      await db.from('finance_procurement_items').update({ [column]: null }).eq('id', id);
    } else {
      await savePhoto(id, fd.get(field), old, column);
    }
  }
  await audit(p.user.id, id, 'finance_procurement_items', 'procurement_item_updated', { item_code: current.item_code });
  revalidatePath('/finance/procurement');
}

// ------------------------------------------------------------------ import --
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some(Boolean));
}

const normKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const keyOf = (x: { item_name: string; category: string; unit: string }) => `${normKey(x.item_name)}|${normKey(x.category)}|${normKey(x.unit)}`;
const chunk = <T,>(xs: T[], n: number) => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** Excel on Windows saves "CSV" as Windows-1252 (e.g. the ° sign); "CSV UTF-8" as UTF-8. Accept both. */
function decodeCsv(buf: ArrayBuffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

/** CAT-33 / SF-06 — businesses the importer may apply the file's prices to.
 *  Super Admin: every active business; everybody else: their own business only
 *  (the database function catalog_import_pricing enforces the same rule). */
export async function getCatalogImportTargetsAction() {
  const p = await financeUser();
  const isSuper = p.user.role === 'super_admin';
  const { data, error } = await createClient().from('businesses').select('id,code,legal_name,trade_name').eq('is_active', true).order('code');
  if (error) throw appError(error.message);
  const businesses = ((data ?? []) as any[])
    .filter((b) => isSuper || b.id === p.user.business_id)
    .map((b) => ({ id: b.id as string, code: b.code as string, name: (b.trade_name || b.legal_name) as string }));
  const defaultIds = p.user.business_id && businesses.some((b) => b.id === p.user.business_id) ? [p.user.business_id] : [];
  const { data: locs } = await createClient().rpc('inventory_count_locations');
  return { businesses, defaultIds, canChooseOthers: isSuper, locations: ((locs ?? []) as any[]).map((l) => ({ id: l.id as string, label: `${l.location_code} — ${l.location_name}` })) };
}

/** CAT-07 (Build 77): the import file may be CSV (UTF-8 or Windows-1252) or
 *  an Excel workbook (.xlsx, first sheet). Both give the same rows. */
async function readImportRows(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  if (/\.xls$/i.test(file.name)) throw appError('Old Excel .xls files cannot be read: save the file as Excel Workbook (.xlsx) or CSV.');
  if (/\.xlsx$/i.test(file.name) || looksLikeXlsx(buf)) {
    try { return readXlsxRows(buf); }
    catch (e: any) { throw appError(`The Excel file could not be read: ${e?.message || e}. Save it again as .xlsx, or as CSV.`); }
  }
  return parseCsv(decodeCsv(buf));
}

type ImportRow = { line: number; item_name: string; category: string; category_id: string; unit: string; generic_item: string | null; brand: string | null; description: string | null; default_supplier_id: string | null; standard_cost: number; supplier_item_code: string | null; addon: number | null; store: number | null; markup: number | null;
  item_code: string | null; item_id: string | null; specification: string | null; opening_qty: number | null; opening_cost: number | null; stock_type: 'stock' | 'order_only' | null };
type BizResult = { business_id: string; code: string; name: string; markups: number; price_changes?: number; new_item_prices?: number; new_addons: { category: string; addon: number }[]; addon_exceptions: string[] };

/**
 * Build 60a / 66 / 76 / 77 — catalog import (CSV or XLSX), sized for a full
 * catalog (thousands of rows):
 *  - new items are created; items that already exist (same Item Code, or
 *    same name, category, unit) are updated from the file, including their
 *    Supplier Cost when the file has a different non-zero cost (CAT-33;
 *    recorded in the item cost history as "CSV import");
 *  - prices (category add-ons, item markups) are applied to every business
 *    ticked on the import screen (SF-06; default = the current business;
 *    only the Super Admin may tick other businesses — enforced by
 *    catalog_import_pricing in the database);
 *  - STORE PRICE, when given, is kept exactly: the markup is derived from it
 *    per business (STORE PRICE ÷ that business's Acquisition Cost − 1).
 *    Otherwise %Mark up is used;
 *  - Add on: a category with no add-on yet for a business gets the most
 *    common Add on value in the file; items whose Add on differs are listed;
 *  - rows identical in every column are imported once.
 * planCatalogImport() reads and validates the whole file and dry-runs the
 * pricing without writing anything; it powers both the preview (CAT-07) and
 * the import itself, which refuses everything if the plan has any error.
 */
async function planCatalogImport(p: SessionProfile, db: Db, fd: FormData) {
  const file = fd.get('catalog_file');
  if (!(file instanceof File) || !file.size) throw appError('Select a catalog file (CSV or Excel .xlsx).');
  if (file.size > 10 * 1024 * 1024) throw appError('Catalog import is limited to 10 MB.');
  const rows = await readImportRows(file);
  if (rows.length < 2) throw appError('The file must contain a header row and at least one data row.');
  const headers = rows[0].map(normalizeCatalogHeader);
  for (const [h, label] of [['item_name', 'STANDARD ITEM NAME'], ['category', 'CATEGORY'], ['supplier_cost', 'Supplier Cost']] as const) {
    if (!headers.includes(h)) throw appError(`Missing required column: ${label}.`);
  }
  const col = (r: string[], h: string) => { const i = headers.indexOf(h); return i >= 0 ? String(r[i] ?? '').trim().replace(/\s+/g, ' ') : ''; };
  // businesses to apply the prices to (checkboxes); older forms without the
  // field fall back to the current business
  const picked = fd.getAll('target_business_ids').map((v) => String(v).trim()).filter(Boolean);
  const targets = [...new Set(fd.has('target_business_ids_sent') ? picked : (p.user.business_id ? [p.user.business_id] : []))];

  const [{ data: cats }, { data: units }, { data: sups }] = await Promise.all([
    db.from('finance_catalog_categories').select('id,name').eq('active', true),
    db.from('finance_catalog_units').select('name').eq('active', true),
    db.from('finance_suppliers').select('id,supplier_code,legal_name,trade_name,active'),
  ]);
  const catMap = new Map((cats || []).map((x: any) => [String(x.name).toLowerCase().trim(), x as { id: string; name: string }]));
  const unitMap = new Map((units || []).map((x: any) => [String(x.name).toLowerCase().trim(), x.name as string]));
  const supMap = new Map<string, any>();
  for (const s of sups || []) for (const k of [s.supplier_code, s.legal_name, s.trade_name]) if (k) supMap.set(String(k).toLowerCase().trim(), s);
  const defaultUnit = unitMap.get('unit') ?? unitMap.get('pc') ?? unitMap.get('pcs') ?? null;

  // Build 76: rows carrying an Item Code update that item (even when renamed)
  const codeIdx = headers.indexOf('item_code');
  const codesInFile = codeIdx >= 0 ? [...new Set(rows.slice(1).map((r) => String(r[codeIdx] ?? '').trim().toUpperCase()).filter(Boolean))] : [];
  const idByCode = new Map<string, string>();
  for (const part of chunk(codesInFile, 300)) {
    const { data, error } = await db.from('finance_procurement_items').select('id,item_code').in('item_code', part);
    if (error) throw appError(error.message);
    for (const x of (data ?? []) as any[]) idByCode.set(String(x.item_code).toUpperCase(), x.id);
  }
  const specRaw = (r: string[]) => { const i = headers.indexOf('specification'); return i >= 0 ? String(r[i] ?? '').trim() : ''; };
  const hasOpening = headers.includes('opening_stock');
  const openingLocation = String(fd.get('opening_location_id') ?? '').trim();
  const codeSeen = new Set<string>();
  const errors: string[] = []; const prepared: ImportRow[] = []; const seen = new Map<string, string>();
  let identicalDuplicates = 0;
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]; const line = `Row ${n + 1}`;
    if (!r.some((c) => String(c ?? '').trim())) continue;
    const name = col(r, 'item_name'), catRaw = col(r, 'category'), unitRaw = col(r, 'unit'), supRaw = col(r, 'supplier');
    const cat = catMap.get(catRaw.toLowerCase());
    const unit = unitRaw ? unitMap.get(unitRaw.toLowerCase()) : defaultUnit;
    const supplier = supRaw ? supMap.get(supRaw.toLowerCase()) : null;
    let cost: number | null = null, addon: number | null = null, store: number | null = null, markup: number | null = null;
    try { cost = money(col(r, 'supplier_cost'), 'Supplier Cost'); } catch (e: any) { errors.push(`${line}: ${e.message}`); }
    try { addon = percent(col(r, 'add_on'), 'Add on'); } catch (e: any) { errors.push(`${line}: ${e.message}`); }
    try { store = money(col(r, 'store_price'), 'STORE PRICE'); } catch (e: any) { errors.push(`${line}: ${e.message}`); }
    if (store === null) { try { markup = percent(col(r, 'markup_percent'), '%Mark up'); } catch (e: any) { errors.push(`${line}: ${e.message} (or fill in STORE PRICE)`); } }
    if (!name) errors.push(`${line}: STANDARD ITEM NAME is required.`);
    if (!cat) errors.push(`${line}: CATEGORY "${catRaw}" is not an active category.`);
    if (!unit) errors.push(`${line}: unit "${unitRaw || '(blank)'}" is not an active unit.`);
    if (supRaw && !supplier) errors.push(`${line}: SUPPLIER "${supRaw}" not found (use the supplier code or registered name).`);
    if (supplier && !supplier.active) errors.push(`${line}: SUPPLIER "${supRaw}" is inactive.`);
    if (store !== null && !(cost && cost > 0)) errors.push(`${line}: STORE PRICE needs a Supplier Cost above 0.`);
    const code = col(r, 'item_code').toUpperCase();
    const codeId = code ? idByCode.get(code) ?? null : null;
    if (code && !codeId) errors.push(`${line}: Item Code ${code} is not in the catalog (leave it blank for a new item).`);
    if (code && codeSeen.has(code)) errors.push(`${line}: Item Code ${code} appears more than once in the file.`);
    if (code) codeSeen.add(code);
    // CAT-38: STOCK TYPE (Stock / Order only)
    const stRaw = col(r, 'stock_type').toLowerCase().replace(/[^a-z]/g, '');
    const stockType: 'stock' | 'order_only' | null = !stRaw ? null : stRaw.startsWith('order') || stRaw === 'po' || stRaw === 'onorder' ? 'order_only' : stRaw.startsWith('stock') ? 'stock' : null;
    if (stRaw && !stockType) errors.push(`${line}: STOCK TYPE "${col(r, 'stock_type')}" must be Stock or Order only.`);
    let openingQty: number | null = null, openingCost: number | null = null;
    if (hasOpening) {
      try { openingQty = money(col(r, 'opening_stock'), 'OPENING STOCK'); } catch (e: any) { errors.push(`${line}: ${e.message}`); }
      try { openingCost = money(col(r, 'opening_cost'), 'OPENING UNIT COST'); } catch (e: any) { errors.push(`${line}: ${e.message}`); }
    }
    const key = code ? `code:${code}` : `${name.toLowerCase()}|${(cat?.name || '').toLowerCase()}|${(unit || '').toLowerCase()}`;
    const whole = r.map((c) => String(c ?? '').trim()).join('\u0001');
    if (seen.has(key)) {
      if (seen.get(key) === whole) { identicalDuplicates++; continue; }
      errors.push(`${line}: same item as an earlier row but with different values ("${name}").`);
      continue;
    }
    seen.set(key, whole);
    if (!cat || !unit) continue;
    prepared.push({ line: n + 1, item_name: name, category: cat.name, category_id: cat.id, unit, generic_item: col(r, 'generic_item') || null, brand: col(r, 'brand') || null, description: col(r, 'description') || null, default_supplier_id: supplier?.id ?? null, standard_cost: cost ?? 0, supplier_item_code: col(r, 'supplier_item_code') || null, addon, store, markup,
      item_code: code || null, item_id: codeId, specification: specRaw(r) || null, opening_qty: openingQty, opening_cost: openingCost, stock_type: stockType });
  }
  const openingRows = prepared.filter((x) => x.opening_qty !== null);
  if (openingRows.length && !openingLocation) errors.push('The file has OPENING STOCK values: choose the store location the opening stock is counted at.');
  if (openingRows.length && !p.user.business_id) errors.push('Select a business in "Acting as" for the opening stock: it belongs to one store.');
  const deactivateMissing = String(fd.get('deactivate_missing') ?? '') === '1';
  if (deactivateMissing && p.user.role !== 'super_admin') errors.push('Only the Super Admin can deactivate items missing from the file (the catalog is shared by all stores).');
  const hasPricing = prepared.some((x) => x.store !== null || x.markup !== null);
  const hasAddons = prepared.some((x) => x.addon !== null);
  if (hasPricing && !targets.length) errors.push('The file has STORE PRICE / %Mark up values: tick at least one business to apply the prices to (select a business in "Acting as" to have it ticked by default) — prices are set per business.');
  if (!prepared.length && !errors.length) errors.push('The file has no item rows.');

  // existing items, matched by the database's identity rule (catalog_norm);
  // read-only, so the preview can show new vs updated items
  const idByKey = new Map<string, string>();
  const lookup = async (rows: { item_name: string; category: string; unit: string }[]) => {
    for (const part of chunk(rows.map((x) => ({ item_name: x.item_name, category: x.category, unit: x.unit })), 500)) {
      const { data, error } = await db.rpc('catalog_lookup_items', { p_rows: part });
      if (error) throw appError(error.message);
      for (const x of (data ?? []) as any[]) idByKey.set(x.identity_key, x.id);
    }
  };
  for (const x of prepared) if (x.item_id) idByKey.set(keyOf(x), x.item_id);
  await lookup(prepared.filter((x) => !x.item_id));
  for (const x of prepared) if (x.item_id) idByKey.set(keyOf(x), x.item_id);

  // Build 83d: two active items may not share STANDARD ITEM NAME + CATEGORY + unit.
  // Name the rows (and the existing item) that would clash, before anything is saved.
  {
    const byIdentity = new Map<string, ImportRow[]>();
    for (const x of prepared) { const k = keyOf(x); byIdentity.set(k, [...(byIdentity.get(k) ?? []), x]); }
    for (const rs of byIdentity.values()) {
      if (rs.length < 2) continue;
      const distinct = new Set(rs.map((r) => r.item_id ?? `new:${r.line}`));
      if (distinct.size > 1) errors.push(`Rows ${rs.map((r) => r.line).join(', ')}: same STANDARD ITEM NAME, CATEGORY and unit ("${rs[0].item_name}" · ${rs[0].category} · ${rs[0].unit})${rs.some((r) => r.item_code) ? ` — Item Codes ${rs.map((r) => r.item_code || 'none').join(', ')}` : ''}. Two active items cannot share these: merge the rows or change one name.`);
    }
    const coded = prepared.filter((x) => x.item_id);
    const holders = new Map<string, string>();
    for (const part of chunk(coded.map((x) => ({ item_name: x.item_name, category: x.category, unit: x.unit })), 500)) {
      const { data, error } = await db.rpc('catalog_lookup_items', { p_rows: part });
      if (error) throw appError(error.message);
      for (const x of (data ?? []) as any[]) holders.set(x.identity_key, x.id);
    }
    const fileIds = new Map(prepared.filter((x) => x.item_id).map((x) => [x.item_id!, x.line]));
    const clashes = coded.map((x) => ({ x, holder: holders.get(keyOf(x)) })).filter((c) => c.holder && c.holder !== c.x.item_id);
    if (clashes.length) {
      const { data: hs } = await db.from('finance_procurement_items').select('id,item_code').in('id', [...new Set(clashes.map((c) => c.holder!))]);
      const codeOf = new Map(((hs ?? []) as any[]).map((h) => [h.id, h.item_code]));
      for (const { x, holder } of clashes) {
        const otherLine = fileIds.get(holder!);
        if (otherLine) errors.push(`Row ${x.line} (${x.item_code}): takes the name, category and unit of ${codeOf.get(holder!) ?? 'another item'}, which row ${otherLine} renames in the same file. Swap names in two uploads, or merge the rows.`);
        else if (!deactivateMissing) errors.push(`Row ${x.line} (${x.item_code}): another active item, ${codeOf.get(holder!) ?? 'not in this file'}, already has the name "${x.item_name}" · ${x.category} · ${x.unit}. Merge them, change one name, or tick "Deactivate catalog items that are not in this file".`);
      }
    }
  }

  // prices: validated per business by the database (dry run, nothing written).
  // This also refuses a business the importer may not set prices for.
  const doPricing = targets.length > 0 && (hasPricing || hasAddons);
  const pricingRows = (ids: Map<string, string> | null) => prepared.map((x) => ({
    line: x.line, item_id: ids ? ids.get(keyOf(x)) ?? null : null, item_name: x.item_name, category_id: x.category_id,
    cost: x.standard_cost, addon: x.addon, store: x.store, markup: x.markup,
  }));
  let dryRun: BizResult[] = [];
  if (doPricing && !errors.length) {
    const { data, error } = await db.rpc('catalog_import_pricing', { p_business_ids: targets, p_rows: pricingRows(idByKey), p_apply: false });
    if (error) throw appError(error.message);
    errors.push(...(((data as any)?.errors ?? []) as string[]));
    dryRun = (((data as any)?.businesses ?? []) as BizResult[]);
  }
  const existing = prepared.filter((x) => idByKey.has(keyOf(x)));
  const fresh = prepared.filter((x) => !idByKey.has(keyOf(x)));
  return { file, headers, targets, prepared, existing, fresh, idByKey, lookup, pricingRows, doPricing, dryRun, errors, identicalDuplicates, openingRows, openingLocation, deactivateMissing };
}

function importFailure(errors: string[]) {
  return appError(`Catalog import failed — nothing was imported (${errors.length} issue${errors.length === 1 ? '' : 's'}). ${errors.slice(0, 10).join(' ')}${errors.length > 10 ? ` … and ${errors.length - 10} more.` : ''}`);
}

export type CatalogImportPreview = {
  file: string; rows: number; errors: string[];
  newItems: number; updatedItems: number; costChanges: number; costSamples: string[];
  priceChanges: number; businesses: { code: string; name: string; priceChanges: number; newItemPrices: number; newAddons: string[]; addonExceptions: number }[];
  openingLines: number; openingQty: number; deactivate: number | null; identicalDuplicates: number;
};

/** CAT-07 — preview of an import: what the file would change, nothing written. */
export async function previewCatalogImportAction(fd: FormData): Promise<CatalogImportPreview> {
  const p = await financeUser(); const db = createClient();
  const plan = await planCatalogImport(p, db, fd);
  // Supplier Cost changes of existing items (same rule as catalog_import_update_costs)
  const ids = [...new Set(plan.existing.map((x) => plan.idByKey.get(keyOf(x))!))];
  const current = new Map<string, any>();
  for (const part of chunk(ids, 300)) {
    const { data, error } = await db.from('finance_procurement_items').select('id,item_code,item_type,standard_cost,service_cost_basis,active').in('id', part);
    if (error) throw appError(error.message);
    for (const x of (data ?? []) as any[]) current.set(x.id, x);
  }
  let costChanges = 0; const costSamples: string[] = [];
  const seenIds = new Set<string>();
  for (const x of plan.existing) {
    const id = plan.idByKey.get(keyOf(x))!; const cur = current.get(id);
    if (!cur || seenIds.has(id) || !(x.standard_cost > 0) || !(cur.active || x.item_id)) continue;
    seenIds.add(id);
    const old = Number(cur.item_type === 'service' ? cur.service_cost_basis : cur.standard_cost);
    const next = Math.round(x.standard_cost * 100) / 100;
    if (Math.round(old * 100) !== Math.round(next * 100)) {
      costChanges++;
      if (costSamples.length < 8) costSamples.push(`${cur.item_code} ${x.item_name}: ₱${old.toLocaleString(undefined, { minimumFractionDigits: 2 })} → ₱${next.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    }
  }
  let deactivate: number | null = null;
  if (plan.deactivateMissing && !plan.errors.length) {
    const { count, error } = await db.from('finance_procurement_items').select('id', { count: 'exact', head: true }).eq('active', true);
    if (error) throw appError(error.message);
    const keptActive = ids.filter((id) => current.get(id)?.active || plan.existing.some((x) => x.item_id === id)).length;
    deactivate = Math.max(0, (count ?? 0) - keptActive);
  }
  const businesses = plan.dryRun.map((b) => ({
    code: b.code, name: b.name, priceChanges: Number(b.price_changes ?? 0), newItemPrices: Number(b.new_item_prices ?? 0),
    newAddons: (b.new_addons ?? []).map((a) => `${a.category} ${a.addon}%`), addonExceptions: (b.addon_exceptions ?? []).length,
  }));
  return {
    file: plan.file.name, rows: plan.prepared.length, errors: plan.errors,
    newItems: plan.fresh.length, updatedItems: plan.existing.length, costChanges, costSamples,
    priceChanges: businesses.reduce((s, b) => s + b.priceChanges + b.newItemPrices, 0), businesses,
    openingLines: plan.openingRows.length, openingQty: plan.openingRows.reduce((s, x) => s + Number(x.opening_qty || 0), 0),
    deactivate, identicalDuplicates: plan.identicalDuplicates,
  };
}

export async function importCatalogCsvAction(fd: FormData) {
  const p = await financeUser(); const db = createClient();
  const { file, headers, targets, prepared, existing, fresh, idByKey, lookup, pricingRows, doPricing, errors, identicalDuplicates, openingRows, openingLocation, deactivateMissing } = await planCatalogImport(p, db, fd);
  if (errors.length) throw importFailure(errors);

  // Build 83d: deactivate the items missing from the file first, so a row may take the name of an item being retired
  let deactivated = 0;
  if (deactivateMissing) {
    const keep = [...new Set(prepared.map((x) => idByKey.get(keyOf(x))).filter((x): x is string => Boolean(x)))];
    const { data, error } = await db.rpc('catalog_deactivate_missing', { p_keep: keep });
    if (error) throw appError(error.message);
    deactivated = Number(data ?? 0);
  }

  // Build 76: the file overwrites the details of items that already exist
  // (name, category, unit, item, brand, description, specification, supplier)
  let detailsUpdated = 0;
  for (const part of chunk(existing, 300)) {
    const { data, error } = await db.rpc('catalog_import_update_items', { p_rows: part.map((x) => ({
      id: idByKey.get(keyOf(x)), item_name: x.item_name, category: x.category, unit: x.unit, generic_item: x.generic_item ?? '', brand: x.brand ?? '',
      description: x.description ?? '', ...(headers.includes('specification') ? { specification: x.specification ?? '' } : {}),
      ...(x.default_supplier_id ? { default_supplier_id: x.default_supplier_id } : {}), ...(x.stock_type ? { stock_type: x.stock_type } : {}), reactivate: Boolean(x.item_id),
    })) });
    if (error) throw appError(error.code === '23505' ? `Two items would end up with the same name, category and unit (${error.message}). Merge them in the file first.` : error.message);
    detailsUpdated += Number(data ?? 0);
  }

  const auditRows: any[] = [];
  let insertedCount = 0;
  for (const part of chunk(fresh, 500)) {
    // catalog_insert_items skips rows that already exist (e.g. another import
    // running at the same moment), so duplicates cannot be created.
    const { data, error } = await db.rpc('catalog_insert_items', { p_rows: part.map((x) => ({
      item_name: x.item_name, category: x.category, unit: x.unit, generic_item: x.generic_item, brand: x.brand, description: x.description,
      default_supplier_id: x.default_supplier_id, standard_cost: x.standard_cost, item_type: 'product',
    })) });
    if (!error && part.some((x) => x.specification || x.stock_type)) {
      const ids = new Map(((data ?? []) as any[]).map((d) => [keyOf(d), d.id]));
      await db.rpc('catalog_import_update_items', { p_rows: part.filter((x) => (x.specification || x.stock_type) && ids.get(keyOf(x))).map((x) => ({ id: ids.get(keyOf(x)), ...(x.specification ? { specification: x.specification } : {}), ...(x.stock_type ? { stock_type: x.stock_type } : {}) })) });
    }
    if (error) throw appError(`${error.message} (items saved before this point are kept; re-run the same file to finish)`);
    for (const x of (data ?? []) as any[]) { idByKey.set(keyOf(x), x.id); insertedCount++; auditRows.push({ actor_id: p.user.id, entity_table: 'finance_procurement_items', entity_id: x.id, action: 'catalog_item_imported', detail: { item_code: x.item_code } }); }
  }
  // rows skipped because another import created them meanwhile: pick up their ids
  const missing = fresh.filter((x) => !idByKey.has(keyOf(x)));
  if (missing.length) await lookup(missing);

  // CAT-33: Supplier Cost of items that already existed, when the file has a
  // different non-zero cost (cost history source "CSV import")
  let costsUpdated = 0;
  const costRows = existing.filter((x) => x.standard_cost > 0).map((x) => ({ id: idByKey.get(keyOf(x))!, cost: x.standard_cost }));
  for (const part of chunk(costRows, 500)) {
    const { data, error } = await db.rpc('catalog_import_update_costs', { p_rows: part });
    if (error) throw appError(`${error.message} (items were saved; re-run the same file to finish the costs)`);
    costsUpdated += ((data ?? []) as any[]).length;
  }

  // supplier item codes
  const supRows = prepared.filter((x) => x.default_supplier_id && x.supplier_item_code && idByKey.get(keyOf(x)))
    .map((x) => ({ item_id: idByKey.get(keyOf(x))!, supplier_id: x.default_supplier_id!, supplier_item_code: x.supplier_item_code, active: true, updated_at: new Date().toISOString() }));
  for (const part of chunk(supRows, 500)) {
    const { error } = await db.from('finance_procurement_item_suppliers').upsert(part, { onConflict: 'item_id,supplier_id' });
    if (error) throw appError(error.message);
  }

  // category add-ons, then item markups, for every chosen business (one
  // all-or-nothing database call)
  let priced: BizResult[] = [];
  if (doPricing) {
    const { data, error } = await db.rpc('catalog_import_pricing', { p_business_ids: targets, p_rows: pricingRows(idByKey), p_apply: true });
    if (error) throw appError(`${error.message} (items were saved; re-run the same file to finish the prices)`);
    priced = (((data as any)?.businesses ?? []) as BizResult[]);
  }
  const markupCount = priced.reduce((s, b) => s + Number(b.markups || 0), 0);

  // Build 76 (LOG-46): opening stock from the same file, recorded as an opening
  // count for the chosen location — a Business Admin approves it before it posts
  let opening: { count_number: string; lines: number; total_qty: number; total_value: number } | null = null;
  if (openingRows.length) {
    const { data, error } = await db.rpc('inventory_opening_count_create', { p: {
      location_id: openingLocation, count_date: String(fd.get('opening_date') ?? '') || null, source: `Catalog upload ${file.name}`,
      lines: openingRows.map((x) => ({ item_id: idByKey.get(keyOf(x)), qty: x.opening_qty, unit_cost: x.opening_cost ?? undefined })).filter((x) => x.item_id),
    } });
    if (error) throw appError(`${error.message} (the catalog was saved; fix the opening stock and upload again)`);
    opening = data as any;
  }
  auditRows.push({ actor_id: p.user.id, entity_table: 'finance_procurement_items', entity_id: p.user.id, action: 'catalog_imported', detail: { file: file.name, rows: prepared.length, created: insertedCount, existing: prepared.length - insertedCount, costs_updated: costsUpdated, markups: markupCount, business_ids: doPricing ? targets : [], new_addons: priced.map((b) => ({ business: b.code, addons: b.new_addons })) } });
  for (const part of chunk(auditRows, 500)) {
    const { error } = await createClient().from('audit_log').insert(part);
    if (error) throw appError(error.message);
  }
  revalidatePath('/finance/procurement');

  const multi = priced.length > 1;
  const msg = [`Imported ${insertedCount} new catalog item(s); ${prepared.length - insertedCount} existing item(s) updated from the file${costsUpdated ? ` (Supplier Cost changed for ${costsUpdated})` : ''}.`];
  if (deactivated) msg.push(`${deactivated} item(s) not in the file were deactivated.`);
  if (opening) msg.push(`Opening stock recorded as ${opening.count_number}: ${opening.lines} item(s), ${Number(opening.total_qty).toLocaleString()} units, ₱${Number(opening.total_value).toLocaleString(undefined, { minimumFractionDigits: 2 })} — waiting for a Business Admin's approval (Finance → Opening Stock) before it posts.`);
  for (const b of priced) {
    const who = multi ? `${b.name}: ` : '';
    if (b.markups) msg.push(`${who}prices set for ${b.markups} item(s)${multi ? '' : ' for this business'}.`);
    if (b.new_addons.length) msg.push(`${who}category add-ons set: ${b.new_addons.map((a) => `${a.category} ${a.addon}%`).join(', ')}.`);
    if (b.addon_exceptions.length) msg.push(`${who}${b.addon_exceptions.length} item(s) have an Add on different from their category (their STORE PRICE is kept exactly; only the Add on / Acquisition Cost shown follow the category): ${b.addon_exceptions.slice(0, 5).join('; ')}${b.addon_exceptions.length > 5 ? ' …' : ''}.`);
  }
  if (identicalDuplicates) msg.push(`${identicalDuplicates} repeated row(s) imported once.`);
  void detailsUpdated;
  return { imported: insertedCount, skipped: prepared.length - insertedCount, costsUpdated, message: msg.join(' ') };
}

// ------------------------------------------------------------ bulk photos --
// Build 79a: photos named by Item Code (PA-0123.jpg, PA-0123_2.jpg …) are
// matched to their items, then sent one file per call so no request is large.
export type PhotoMatch = { item_code: string; id: string; item_name: string; active: boolean; photo_path: string | null; photo_path_2: string | null; photo_path_3: string | null };
export async function matchPhotoCodesAction(codes: string[]): Promise<PhotoMatch[]> {
  await financeUser(); const db = createClient();
  const wanted = Array.from(new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))).slice(0, 5000);
  const out: PhotoMatch[] = [];
  for (const part of chunk(wanted, 300)) {
    const { data, error } = await db.from('finance_procurement_items').select('id,item_code,item_name,active,photo_path,photo_path_2,photo_path_3').in('item_code', part);
    if (error) throw appError(error.message);
    for (const x of (data ?? []) as any[]) out.push({ ...x, item_code: String(x.item_code).toUpperCase() });
  }
  return out;
}

export async function uploadCatalogPhotoAction(fd: FormData): Promise<'saved' | 'skipped'> {
  const p = await financeUser(); const db = createClient();
  const id = need(fd, 'item_id', 'Item');
  const slot = Number(fd.get('slot'));
  if (![1, 2, 3].includes(slot)) throw appError('Photo slot must be 1, 2 or 3.');
  const column = PHOTO_SLOTS[slot - 1][1];
  const { data: current, error } = await db.from('finance_procurement_items').select(`id,item_code,${column}`).eq('id', id).single();
  if (error || !current) throw appError(error?.message || 'Catalog item not found.');
  const old = (current as any)[column] as string | null;
  if (old && String(fd.get('replace') || '') !== 'true') return 'skipped';
  const path = await savePhoto(id, fd.get('file'), old, column);
  if (!path) throw appError('The photo file is empty.');
  await audit(p.user.id, id, 'finance_procurement_items', 'catalog_photo_uploaded', { item_code: (current as any).item_code, slot });
  return 'saved';
}

export async function photoUploadDoneAction() {
  await financeUser();
  revalidatePath('/finance/procurement');
  revalidatePath('/catalog');
}
