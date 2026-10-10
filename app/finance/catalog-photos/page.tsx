// Build 90 — Catalog Photos: the catalog list with its product photos, for
// anyone given the "Catalog photos" function (for example a person who only
// takes and uploads product pictures). No costs, prices or suppliers shown.
// Rows are read with the service role AFTER the function check.
import { requireFunction } from '@/core/auth/requireSection';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { withCatalogPhotoUrls } from '@/modules/finance/procurement/catalogPhotos';
import { CatalogPhotosManagement } from '@/modules/finance/procurement/CatalogPhotosManagement';

export const dynamic = 'force-dynamic';

type SP = { q?: string; category?: string; missing?: string; page?: string };
const PAGE = 40;

export default async function CatalogPhotosPage(props: { searchParams?: Promise<SP> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await requireFunction('catalog.photos');
  const f = { q: (sp.q ?? '').trim().slice(0, 80), category: (sp.category ?? '').trim(), missing: sp.missing === '1' };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const db = createAdminClient();
  let query = db.from('finance_procurement_items')
    .select('id,item_code,item_name,category,generic_item,brand,unit,photo_path,photo_path_2,photo_path_3', { count: 'exact' })
    .eq('active', true);
  if (f.q) {
    const term = f.q.replace(/[%_,()*.]/g, ' ').trim();
    if (term) query = query.or(`item_code.ilike.*${term}*,item_name.ilike.*${term}*,brand.ilike.*${term}*,generic_item.ilike.*${term}*`);
  }
  if (f.category) query = query.ilike('category', f.category);
  if (f.missing) query = query.or('photo_path.is.null,photo_path_2.is.null,photo_path_3.is.null');
  const [{ data: rows, error, count }, { data: cats }] = await Promise.all([
    query.order('category').order('item_name').range((page - 1) * PAGE, page * PAGE - 1),
    db.from('finance_procurement_items').select('category').eq('active', true).limit(10000),
  ]);
  if (error) throw new Error(error.message);
  const items = await withCatalogPhotoUrls((rows ?? []) as any[]);
  const categories = Array.from(new Set(((cats ?? []) as any[]).map((c) => String(c.category ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return (
    <AuthedShell profile={profile}>
      <CatalogPhotosManagement items={items as any} categories={categories} filters={f} page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} total={count ?? 0} />
    </AuthedShell>
  );
}
