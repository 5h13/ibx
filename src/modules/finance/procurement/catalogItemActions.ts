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

async function savePhoto(itemId: string, file: FormDataEntryValue | null, oldPath: string | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > 5 * 1024 * 1024) throw appError('Product photos must be 5 MB or smaller.');
  if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw appError('Product photo must be JPG, PNG or WebP.');
  const admin = createAdminClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const path = `${itemId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await admin.storage.from(CATALOG_PHOTO_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw appError(error.message);
  const { error: ue } = await createClient().from('finance_procurement_items').update({ photo_path: path, updated_at: new Date().toISOString() }).eq('id', itemId);
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
    item_name: f.item_name, category: f.category, generic_item: f.generic_item, brand: f.brand, description: f.description,
    default_supplier_id: f.default_supplier_id, unit: f.unit, item_type: f.item_type,
    standard_cost: f.standard_cost, service_cost_basis: f.service_cost_basis, created_by: p.user.id,
  }).select('id,item_code').single();
  if (error?.code === '23505') throw appError(`An active catalog item with this name, category and unit already exists. Select the existing item instead of creating a duplicate.`);
  if (error || !data) throw appError(error?.message || 'Unable to create catalog item.');
  await saveSupplierItemCode(db, p, data.id, f.default_supplier_id, f.supplier_item_code);
  await saveItemMarkup(db, p, data.id, f.markup);
  await savePhoto(data.id, fd.get('photo'), null);
  await audit(p.user.id, data.id, 'finance_procurement_items', 'procurement_item_created', { item_code: data.item_code });
  revalidatePath('/finance/procurement');
  return { item_code: data.item_code as string };
}

export async function updateCatalogItemAction(fd: FormData) {
  const p = await financeUser(); const db = createClient();
  const id = need(fd, 'item_id', 'Item');
  const f = readItemForm(fd);
  const { data: current, error: ce } = await db.from('finance_procurement_items').select('id,item_code,photo_path,standard_cost,service_cost_basis').eq('id', id).single();
  if (ce || !current) throw appError(ce?.message || 'Catalog item not found.');
  const { data: duplicate } = await db.from('finance_procurement_items').select('id,item_code,item_name').ilike('item_name', f.item_name).ilike('category', f.category).ilike('unit', f.unit).eq('active', true).neq('id', id).limit(1).maybeSingle();
  if (duplicate) throw appError(`Another active catalog item already has this name, category and unit: ${duplicate.item_code} — ${duplicate.item_name}.`);
  const patch: Record<string, unknown> = {
    item_name: f.item_name, category: f.category, generic_item: f.generic_item, brand: f.brand, description: f.description,
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
  if (String(fd.get('remove_photo') || '') === 'true' && current.photo_path) {
    await createAdminClient().storage.from(CATALOG_PHOTO_BUCKET).remove([current.photo_path]);
    await db.from('finance_procurement_items').update({ photo_path: null }).eq('id', id);
  } else {
    await savePhoto(id, fd.get('photo'), current.photo_path);
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

const chunk = <T,>(xs: T[], n: number) => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** Excel on Windows saves "CSV" as Windows-1252 (e.g. the ° sign); "CSV UTF-8" as UTF-8. Accept both. */
function decodeCsv(buf: ArrayBuffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

/**
 * Build 60a — catalog CSV import, sized for a full catalog (thousands of rows):
 *  - new items are created; items that already exist (same name, category,
 *    unit) are not changed, but their %Mark up IS set for the importing
 *    business — so each business can import the same file for its own prices;
 *  - STORE PRICE, when given, is kept exactly: the markup is derived from it
 *    (STORE PRICE ÷ Acquisition Cost − 1). Otherwise %Mark up is used;
 *  - Add on: a category with no add-on yet for this business gets the most
 *    common Add on value in the file; items whose Add on differs are listed;
 *  - rows identical in every column are imported once.
 * Validation is all-or-nothing; writes are batched.
 */
export async function importCatalogCsvAction(fd: FormData) {
  const p = await financeUser(); const db = createClient();
  const file = fd.get('catalog_file');
  if (!(file instanceof File) || !file.size) throw appError('Select a CSV catalog file.');
  if (file.size > 10 * 1024 * 1024) throw appError('Catalog import is limited to 10 MB.');
  const rows = parseCsv(decodeCsv(await file.arrayBuffer()));
  if (rows.length < 2) throw appError('The CSV must contain a header row and at least one data row.');
  const headers = rows[0].map(normalizeCatalogHeader);
  for (const [h, label] of [['item_name', 'STANDARD ITEM NAME'], ['category', 'CATEGORY'], ['supplier_cost', 'Supplier Cost']] as const) {
    if (!headers.includes(h)) throw appError(`Missing required column: ${label}.`);
  }
  const col = (r: string[], h: string) => { const i = headers.indexOf(h); return i >= 0 ? String(r[i] ?? '').trim().replace(/\s+/g, ' ') : ''; };
  const businessId = p.user.business_id;

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

  // existing add-ons for this business
  const addonByCat = new Map<string, number>();
  if (businessId) {
    const { data: ex, error } = await db.from('finance_catalog_category_pricing').select('category_id,addon_percent').eq('business_id', businessId).eq('active', true);
    if (error) throw appError(error.message);
    for (const x of ex || []) addonByCat.set(x.category_id, Number(x.addon_percent) || 0);
  }

  type Row = { line: number; item_name: string; category: string; category_id: string; unit: string; generic_item: string | null; brand: string | null; description: string | null; default_supplier_id: string | null; standard_cost: number; supplier_item_code: string | null; addon: number | null; store: number | null; markup: number | null };
  const errors: string[] = []; const prepared: Row[] = []; const seen = new Map<string, string>();
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
    const key = `${name.toLowerCase()}|${(cat?.name || '').toLowerCase()}|${(unit || '').toLowerCase()}`;
    const whole = r.map((c) => String(c ?? '').trim()).join('\u0001');
    if (seen.has(key)) {
      if (seen.get(key) === whole) { identicalDuplicates++; continue; }
      errors.push(`${line}: same item as an earlier row but with different values ("${name}").`);
      continue;
    }
    seen.set(key, whole);
    if (!cat || !unit) continue;
    prepared.push({ line: n + 1, item_name: name, category: cat.name, category_id: cat.id, unit, generic_item: col(r, 'generic_item') || null, brand: col(r, 'brand') || null, description: col(r, 'description') || null, default_supplier_id: supplier?.id ?? null, standard_cost: cost ?? 0, supplier_item_code: col(r, 'supplier_item_code') || null, addon, store, markup });
  }
  const hasPricing = prepared.some((x) => x.store !== null || x.markup !== null);
  if (hasPricing && !businessId) errors.push('The file has STORE PRICE / %Mark up values: select a business in "Acting as" first — prices are set per business.');

  // Add on: categories with no add-on for this business take the file's most common value
  const newAddons = new Map<string, { category: string; addon: number }>();
  if (businessId) {
    const counts = new Map<string, Map<number, number>>();
    for (const x of prepared) if (x.addon !== null) { const m = counts.get(x.category_id) ?? new Map(); m.set(x.addon, (m.get(x.addon) ?? 0) + 1); counts.set(x.category_id, m); }
    for (const [catId, m] of counts) if (!addonByCat.has(catId)) {
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
      addonByCat.set(catId, top); newAddons.set(catId, { category: prepared.find((x) => x.category_id === catId)!.category, addon: top });
    }
  }
  const addonExceptions: string[] = [];
  for (const x of prepared) {
    const catAddon = addonByCat.get(x.category_id) ?? 0;
    if (x.addon !== null && businessId && x.addon !== catAddon) addonExceptions.push(`row ${x.line} ${x.item_name} (${x.addon}% vs category ${catAddon}%)`);
    if (x.store !== null) {
      const acq = x.standard_cost * (1 + catAddon / 100);
      const m = (x.store / acq - 1) * 100;
      if (m < 0) errors.push(`Row ${x.line}: STORE PRICE ₱${x.store} is below the Acquisition Cost ₱${acq.toFixed(2)}.`);
      else if (m > 1000) errors.push(`Row ${x.line}: STORE PRICE is more than 11× the Acquisition Cost (markup above 1000%).`);
      else x.markup = Math.round(m * 1e8) / 1e8;
    }
  }
  if (errors.length) throw appError(`Catalog import failed — nothing was imported (${errors.length} issue${errors.length === 1 ? '' : 's'}). ${errors.slice(0, 10).join(' ')}${errors.length > 10 ? ` … and ${errors.length - 10} more.` : ''}`);
  if (!prepared.length) throw appError('The file has no item rows.');

  // existing items, matched by the database's identity rule (catalog_norm)
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const keyOf = (x: { item_name: string; category: string; unit: string }) => `${norm(x.item_name)}|${norm(x.category)}|${norm(x.unit)}`;
  const idByKey = new Map<string, string>();
  const lookup = async (rows: { item_name: string; category: string; unit: string }[]) => {
    for (const part of chunk(rows.map((x) => ({ item_name: x.item_name, category: x.category, unit: x.unit })), 500)) {
      const { data, error } = await db.rpc('catalog_lookup_items', { p_rows: part });
      if (error) throw appError(error.message);
      for (const x of (data ?? []) as any[]) idByKey.set(x.identity_key, x.id);
    }
  };
  await lookup(prepared);
  const fresh = prepared.filter((x) => !idByKey.has(keyOf(x)));

  const auditRows: any[] = [];
  let insertedCount = 0;
  for (const part of chunk(fresh, 500)) {
    // catalog_insert_items skips rows that already exist (e.g. another import
    // running at the same moment), so duplicates cannot be created.
    const { data, error } = await db.rpc('catalog_insert_items', { p_rows: part.map((x) => ({
      item_name: x.item_name, category: x.category, unit: x.unit, generic_item: x.generic_item, brand: x.brand, description: x.description,
      default_supplier_id: x.default_supplier_id, standard_cost: x.standard_cost, item_type: 'product',
    })) });
    if (error) throw appError(`${error.message} (items saved before this point are kept; re-run the same file to finish)`);
    for (const x of (data ?? []) as any[]) { idByKey.set(keyOf(x), x.id); insertedCount++; auditRows.push({ actor_id: p.user.id, entity_table: 'finance_procurement_items', entity_id: x.id, action: 'catalog_item_imported', detail: { item_code: x.item_code } }); }
  }
  // rows skipped because another import created them meanwhile: pick up their ids
  const missing = fresh.filter((x) => !idByKey.has(keyOf(x)));
  if (missing.length) await lookup(missing);

  // supplier item codes
  const supRows = prepared.filter((x) => x.default_supplier_id && x.supplier_item_code && idByKey.get(keyOf(x)))
    .map((x) => ({ item_id: idByKey.get(keyOf(x))!, supplier_id: x.default_supplier_id!, supplier_item_code: x.supplier_item_code, active: true, updated_at: new Date().toISOString() }));
  for (const part of chunk(supRows, 500)) {
    const { error } = await db.from('finance_procurement_item_suppliers').upsert(part, { onConflict: 'item_id,supplier_id' });
    if (error) throw appError(error.message);
  }

  // category add-ons, then item markups, for this business
  if (businessId && newAddons.size) {
    const { error } = await db.from('finance_catalog_category_pricing').upsert([...newAddons.keys()].map((catId) => ({ business_id: businessId, category_id: catId, addon_percent: newAddons.get(catId)!.addon, active: true, updated_at: new Date().toISOString(), created_by: p.user.id })), { onConflict: 'business_id,category_id', ignoreDuplicates: true });
    if (error) throw appError(error.message);
  }
  const markupRows = businessId ? prepared.filter((x) => x.markup !== null && idByKey.get(keyOf(x)))
    .map((x) => ({ business_id: businessId, item_id: idByKey.get(keyOf(x))!, markup_percent: x.markup, active: true, updated_at: new Date().toISOString(), created_by: p.user.id })) : [];
  for (const part of chunk(markupRows, 500)) {
    const { error } = await db.from('finance_catalog_item_pricing').upsert(part, { onConflict: 'business_id,item_id' });
    if (error) throw appError(`${error.message} (items were saved; re-run the same file to finish the prices)`);
  }
  auditRows.push({ actor_id: p.user.id, entity_table: 'finance_procurement_items', entity_id: p.user.id, action: 'catalog_imported', detail: { file: file.name, rows: prepared.length, created: insertedCount, existing: prepared.length - insertedCount, markups: markupRows.length, business_id: businessId, new_addons: [...newAddons.values()] } });
  for (const part of chunk(auditRows, 500)) {
    const { error } = await createClient().from('audit_log').insert(part);
    if (error) throw appError(error.message);
  }
  revalidatePath('/finance/procurement');

  const msg = [`Imported ${insertedCount} new catalog item(s); ${prepared.length - insertedCount} already existed and were left unchanged.`];
  if (markupRows.length) msg.push(`Prices set for ${markupRows.length} item(s) for this business.`);
  if (identicalDuplicates) msg.push(`${identicalDuplicates} repeated row(s) imported once.`);
  if (newAddons.size) msg.push(`Category add-ons set: ${[...newAddons.values()].map((a) => `${a.category} ${a.addon}%`).join(', ')}.`);
  if (addonExceptions.length) msg.push(`${addonExceptions.length} item(s) have an Add on different from their category (their STORE PRICE is kept exactly; only the Add on / Acquisition Cost shown follow the category): ${addonExceptions.slice(0, 5).join('; ')}${addonExceptions.length > 5 ? ' …' : ''}.`);
  return { imported: insertedCount, skipped: prepared.length - insertedCount, message: msg.join(' ') };
}
