// Build 136 — one product in a store's public catalog: photos, price, specification; ask the store, share.
import { notFound } from 'next/navigation';
import { ShopShell } from '@/modules/shop/ShopShell';
import { ShopActions } from '@/modules/shop/ShopActions';
import { loadItem, loadStore, pesoShop, viberIntl } from '@/modules/shop/data';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ store: string; id: string }> }) {
  const { store, id } = await props.params;
  const [s, it] = await Promise.all([loadStore(store), loadItem(store, id)]);
  if (!s || !it) return { title: 'Shop' };
  const price = pesoShop(it.price);
  return { title: `${it.name} — ${s.name}`, description: [it.brand, it.category, price].filter(Boolean).join(' · ') };
}

export default async function ShopItemPage(props: { params: Promise<{ store: string; id: string }> }) {
  const { store: slug, id } = await props.params;
  const [store, it] = await Promise.all([loadStore(slug), loadItem(slug, id)]);
  if (!store || !it) notFound();
  const price = pesoShop(it.price);
  const photos = it.photo_urls ?? [];
  return (
    <ShopShell store={store} back={`/shop/${slug}`}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-2xl" aria-label="Photos">
            {photos.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt={`${it.name} — photo ${i + 1}`} className="aspect-square w-full flex-none snap-center rounded-2xl bg-white object-contain" />
            ))}
          </div>
          {photos.length > 1 && <p className="text-center text-[11px] text-slate-400">Swipe for more photos ({photos.length})</p>}
        </div>
        <div className="space-y-4">
          <div>
            <div className="text-xs text-slate-500">{[it.category, it.generic_item, it.brand].filter(Boolean).join(' · ')}</div>
            <h1 className="text-xl font-extrabold leading-tight text-slate-900">{it.name}</h1>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">{price ?? <span className="text-lg text-slate-500">Ask for price</span>}{price && it.unit ? <span className="text-sm font-normal text-slate-500"> / {it.unit}</span> : null}</div>
          </div>
          <ShopActions name={it.name} price={price} messenger={store.messenger_url} viber={viberIntl(store.viber_number)} phone={store.phone} />
          {it.specification && <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-1 text-sm font-bold">Specification</h2><p className="whitespace-pre-line text-sm text-slate-700">{it.specification}</p></section>}
          {it.description && <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-1 text-sm font-bold">Description</h2><p className="whitespace-pre-line text-sm text-slate-700">{it.description}</p></section>}
        </div>
      </div>
    </ShopShell>
  );
}
