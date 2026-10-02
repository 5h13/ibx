// Build 76 — product detail page behind every Product Search card: larger
// photos, specification, store price and stock (same rules as Product Search:
// no cost, add-on, markup or supplier data).
import { notFound } from 'next/navigation';
import { requireSignedIn } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { canViewProductSearch } from '@/modules/catalog/productSearchAccess';
import { ProductGallery } from '@/modules/catalog/ProductGallery';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { CATALOG_PHOTO_BUCKET } from '@/modules/finance/procurement/catalogColumns';

export const dynamic = 'force-dynamic';
const peso = (v: unknown) => (v == null ? '—' : `₱${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const qty = (v: unknown) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

/** "Label: value" lines become a two-column table; other lines stay as text. */
function specRows(spec: string) {
  return spec.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:]{1,60}):\s*(.+)$/);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { label: '', value: l };
  });
}

export default async function ProductDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { back?: string } }) {
  const profile = await requireSignedIn();
  if (!canViewProductSearch(profile)) notFound();
  const { data, error } = await createClient().rpc('catalog_product_detail', { p_item: params.id });
  if (error || !data) notFound();
  const p: any = data;
  const paths: string[] = p.photo_paths ?? [];
  let photos: string[] = [];
  if (paths.length) {
    const { data: signed } = await createAdminClient().storage.from(CATALOG_PHOTO_BUCKET).createSignedUrls(paths, 3600);
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    photos = paths.map((x) => byPath.get(x)).filter((x): x is string => Boolean(x));
  }
  const back = searchParams?.back && searchParams.back.startsWith('/catalog') ? searchParams.back : '/catalog';
  const locs = (p.stock_by_location ?? []) as { location: string; on_hand: number }[];
  const onHand = p.on_hand == null ? null : Number(p.on_hand);
  const rows = p.specification ? specRows(p.specification) : [];

  return (
    <AuthedShell profile={profile}>
      <div className="space-y-4">
        <a href={back} className="text-sm text-slate-600 underline">‹ Back to Product Search</a>
        <div className="grid gap-6 rounded-xl border bg-white p-5 md:grid-cols-2">
          <ProductGallery photos={photos} name={p.item_name} />
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold leading-snug">{p.item_name}</h2>
              <div className="mt-1 text-sm text-slate-500">{p.item_code} · {[p.category, p.generic_item, p.brand].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold">{peso(p.store_price)}</span><span className="text-sm text-slate-500">per {p.unit}</span>
              {!p.priced && <span className="text-xs text-amber-700">Select a business in &quot;Acting as&quot; to see the store price</span>}
            </div>
            {p.item_type === 'service' ? <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs">Service</span>
              : p.stock_type === 'order_only' && !(Number(onHand ?? 0) > 0) ? <span className="inline-block rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-800">Order only — bought against a client PO</span>
              : onHand == null ? (p.priced ? <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Not stocked</span> : null)
              : <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${onHand > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{onHand > 0 ? `In stock: ${qty(onHand)} ${p.unit}` : 'Out of stock'}</span>}
            {Number(p.reserved ?? 0) > 0 && onHand != null && <div className="text-sm text-slate-600">{qty(p.reserved)} reserved for sales orders · <b>{qty(Math.max(onHand - Number(p.reserved), 0))} available</b></div>}
            {locs.length > 0 && <ul className="text-sm text-slate-600">{locs.map((l) => <li key={l.location} className="flex justify-between border-b py-1"><span>{l.location}</span><span>{qty(l.on_hand)}</span></li>)}</ul>}
            {p.description && <p className="text-sm text-slate-700">{p.description}</p>}
            <div>
              <h3 className="mb-2 font-semibold">Specification</h3>
              {rows.length === 0 ? <p className="text-sm text-slate-500">No specification yet.</p> : (
                <table className="w-full text-sm"><tbody>
                  {rows.map((r, k) => <tr key={k} className="border-b align-top">{r.label ? <><td className="w-2/5 py-1.5 pr-3 text-slate-500">{r.label}</td><td className="py-1.5">{r.value}</td></> : <td colSpan={2} className="py-1.5">{r.value}</td>}</tr>)}
                </tbody></table>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthedShell>
  );
}
