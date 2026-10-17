// Build 137 — /shop/<store>/quote: Request for quotation (sent to the store by Messenger / Viber / text).
import { notFound } from 'next/navigation';
import { ShopShell } from '@/modules/shop/ShopShell';
import { QuoteForm } from '@/modules/shop/QuoteForm';
import { loadStore } from '@/modules/shop/data';
import { viberIntl } from '@/modules/shop/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ store: string }> }) {
  const { store } = await props.params;
  const s = await loadStore(store);
  return { title: s ? `Request for quotation — ${s.name}` : 'Request for quotation' };
}

export default async function QuotePage(props: { params: Promise<{ store: string }>; searchParams?: Promise<{ item?: string }> }) {
  const { store: slug } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const store = await loadStore(slug);
  if (!store) notFound();
  return (
    <ShopShell store={store} back={`/shop/${slug}`}>
      <div className="mx-auto max-w-xl space-y-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Request for quotation</h1>
          <p className="text-sm text-slate-600">List the parts you need and we will send you prices and availability.</p>
        </div>
        <QuoteForm storeName={store.name} messenger={store.messenger_url} viber={viberIntl(store.viber_number)} phone={store.phone} firstItem={sp.item?.slice(0, 120)} />
      </div>
    </ShopShell>
  );
}
