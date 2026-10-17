// Build 136 — /shop: the open store shops (the 5H13 all-stores shop with delivery areas comes next).
import Link from 'next/link';
import { loadShops } from '@/modules/shop/data';

export const dynamic = 'force-dynamic';
export const metadata = { title: '5H13 Shop — aircon & refrigeration parts' };

export default async function ShopIndex() {
  const shops = await loadShops();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 px-4 py-4 text-white"><div className="mx-auto max-w-3xl text-lg font-extrabold">5H13 Shop</div><div className="mx-auto max-w-3xl text-xs opacity-80">Aircon &amp; refrigeration parts</div></header>
      <main className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        {shops.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Our online shops open soon.</p>}
        {shops.map((s) => (
          <Link key={s.slug} href={`/shop/${s.slug}`} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.logo_url || '/icons/icon-192.png'} alt="" className="h-12 w-12 rounded-lg object-contain" />
            <span><span className="block font-extrabold">{s.name}</span>{s.tagline && <span className="block text-xs text-slate-500">{s.tagline}</span>}</span>
          </Link>
        ))}
      </main>
    </div>
  );
}
