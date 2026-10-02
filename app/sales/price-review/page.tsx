// Build 78 — quick price review (CAT-36, replaces CAT-19 / CAT-29): the Sales
// approver and Finance review and adjust this store's prices on one screen —
// markup or store price per item, add-on per category — with every change
// logged and no approval step. Data: price_review_* functions (20261210).
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { PriceReview } from '@/modules/sales/priceReview/PriceReview';

export const dynamic = 'force-dynamic';
const PAGE = 50;
type SP = { q?: string; category?: string; brand?: string; supplier?: string; page?: string; tab?: string };

export default async function PriceReviewPage({ searchParams }: { searchParams?: SP }) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const db = createClient();
  const { data: allowed } = await db.rpc('can_review_prices');
  if (allowed !== true) {
    return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">The price review is for the Sales approver, Finance and Business Admins.</div></AuthedShell>;
  }
  const sp = searchParams ?? {};
  const f = { q: (sp.q ?? '').trim().slice(0, 60), category: (sp.category ?? '').trim(), brand: (sp.brand ?? '').trim(), supplier: /^[0-9a-f-]{36}$/i.test(sp.supplier ?? '') ? sp.supplier! : '' };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const tab = ['items', 'categories', 'log'].includes(sp.tab ?? '') ? sp.tab! : 'items';
  const [{ data: rows, error }, { data: cats, error: ce }, { data: suppliers, error: se }, { data: filterValues }, { data: changes, error: le }] = await Promise.all([
    db.rpc('price_review_items', { p_q: f.q || null, p_category: f.category || null, p_brand: f.brand || null, p_supplier: f.supplier || null, p_limit: PAGE, p_offset: (page - 1) * PAGE }),
    db.rpc('price_review_categories'),
    db.rpc('price_review_suppliers'),
    db.rpc('catalog_filter_values'),
    db.rpc('price_review_changes', { p_limit: 200, p_item: null }),
  ]);
  const err = error || ce || se || le;
  if (err) {
    return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">{err.message}</div></AuthedShell>;
  }
  const brands = ((filterValues ?? []) as any[]).filter((v) => v.kind === 'brand').map((v) => v.value as string);
  return (
    <AuthedShell profile={profile}>
      <PriceReview rows={(rows ?? []) as any[]} categories={(cats ?? []) as any[]} suppliers={(suppliers ?? []) as any[]} brands={brands} changes={(changes ?? []) as any[]}
        filters={f} page={page} pageSize={PAGE} tab={tab} />
    </AuthedShell>
  );
}
