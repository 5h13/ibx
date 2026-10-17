'use client';
// Build 136 — online shop settings form.
// Build 137 — layout A / B / C, Facebook page, front-page sections on / off, featured product, slideshow
// (Category / Item / Brand, any part blank), announcements and promotions.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { deleteShopPostAction, saveShopPostAction, saveShopSettingsAction, shopFiltersAction } from './settingsActions';
import { ItemPicker, type Picked } from './ItemPicker';
import { useDialog } from '@/core/ui/Dialog';

export type ShopSettingsRow = {
  business_id: string; slug: string; enabled: boolean; messenger_url: string | null; viber_number: string | null; tagline: string | null;
  facebook_url: string | null; layout: 'A' | 'B' | 'C'; show_announcements: boolean; show_promo: boolean; show_featured: boolean; show_slideshow: boolean;
  featured_item_id: string | null; slideshow_category: string | null; slideshow_item: string | null; slideshow_brand: string | null; slideshow_title: string | null;
};
export type ShopPost = { id: string; kind: 'announcement' | 'promo'; title: string; body: string | null; starts_on: string | null; ends_on: string | null;
  item_id: string | null; item_name?: string | null; link_category: string | null; active: boolean };

const LAYOUTS: { key: 'A' | 'B' | 'C'; name: string; text: string }[] = [
  { key: 'A', name: 'A · Classic storefront', text: 'Branded header with search, Request for quotation and Like us; promo card, slideshow with arrows, featured product, announcements, products by category.' },
  { key: 'B', name: 'B · Bold hero', text: 'Announcement strip on top, a tall centred header with search and contact buttons, photo promo banner, category tiles, a sliding product strip, a large featured product.' },
  { key: 'C', name: 'C · App style', text: 'Compact header, promotion and announcements in one rotating banner, quick contact buttons, product of the week, and Request for quotation fixed at the bottom.' },
];

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-lg border bg-white p-4"><h3 className="font-semibold">{title}</h3>{children}</section>
);

export function ShopSettingsForm({ s, superAdmin, posts, featuredName, categories }: { s: ShopSettingsRow; superAdmin: boolean; posts: ShopPost[]; featuredName: string | null; categories: string[] }) {
  const router = useRouter();
  const [f, setF] = useState({ messenger_url: s.messenger_url ?? '', viber_number: s.viber_number ?? '', facebook_url: s.facebook_url ?? '', tagline: s.tagline ?? '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (data: Record<string, string | boolean | null>, done: string) => start(async () => {
    setMsg(null);
    try { await saveShopSettingsAction(s.business_id, data); setMsg({ ok: true, text: done }); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); }
  });
  const field = (k: keyof typeof f, label: string, hint: string, placeholder: string) => (
    <label className="block text-sm"><span className="font-medium">{label}</span>
      <input className="input mt-1 w-full" value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <span className="text-xs text-slate-500">{hint}</span></label>
  );
  const toggle = (key: 'show_promo' | 'show_slideshow' | 'show_featured' | 'show_announcements', label: string) => (
    <label className="flex items-center justify-between gap-3 border-t py-2 text-sm first:border-t-0">
      <span>{label}</span>
      <input type="checkbox" className="h-5 w-5" checked={s[key]} disabled={pending} onChange={(e) => run({ [key]: e.target.checked }, `${label} ${e.target.checked ? 'shown' : 'hidden'}.`)} />
    </label>
  );
  return (
    <div className="max-w-2xl space-y-4">
      {msg && <div role="status" className={`sticky top-2 z-10 rounded px-3 py-2 text-sm shadow ${msg.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</div>}

      <Card title="Shop address">
        <div className="flex items-center justify-between gap-3">
          <a href={`/shop/${s.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-700 underline">5h13.vercel.app/shop/{s.slug}</a>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{s.enabled ? 'Open to the public' : 'Off'}</span>
        </div>
        {superAdmin
          ? <button type="button" disabled={pending} onClick={() => run({ enabled: !s.enabled }, s.enabled ? 'The shop is off.' : 'The shop is open to the public.')}
              className={`rounded px-4 py-2 text-sm font-semibold ${s.enabled ? 'border' : 'bg-slate-800 text-white'}`}>{s.enabled ? 'Turn the shop off' : 'Open the shop to the public'}</button>
          : <p className="text-xs text-slate-500">The Super Admin opens or closes the shop.</p>}
        <p className="text-xs text-slate-500">The shop shows active catalog items that have at least one photo, at this store&apos;s prices, marked Available or By order. Stock quantities, costs and suppliers are never shown.</p>
      </Card>

      <Card title="Layout">
        <div className="grid gap-2 sm:grid-cols-3">
          {LAYOUTS.map((l) => (
            <label key={l.key} className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm ${s.layout === l.key ? 'border-slate-800 ring-2 ring-slate-800' : ''}`}>
              <span className="flex items-center gap-2"><input type="radio" name="layout" checked={s.layout === l.key} disabled={pending} onChange={() => run({ layout: l.key }, `Layout ${l.name} is live.`)} /><b>{l.name}</b></span>
              <span className="text-xs text-slate-600">{l.text}</span>
            </label>
          ))}
        </div>
        <a href={`/shop/${s.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs underline">Open the shop to see it</a>
      </Card>

      <form className="space-y-3 rounded-lg border bg-white p-4" onSubmit={(e) => { e.preventDefault(); run(f, 'Contacts saved.'); }}>
        <h3 className="font-semibold">Contacts and tagline</h3>
        {field('messenger_url', 'Messenger link', 'Your Facebook page’s Messenger link, e.g. https://m.me/Pili.Aire', 'https://m.me/…')}
        {field('viber_number', 'Viber number', 'The mobile number customers message on Viber', '0917 123 4567')}
        {field('facebook_url', 'Facebook page', 'For "Like us on Facebook", e.g. https://www.facebook.com/Pili.Aire/', 'https://www.facebook.com/…')}
        {field('tagline', 'Tagline', 'One line under the store name (up to 120 characters)', 'Your Trusted Aircon and Refrigeration Parts Supplier')}
        <p className="text-xs text-slate-500">The store&apos;s phone, email and address come from System → Businesses.</p>
        <button className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      </form>

      <Card title="Front-page sections">
        <div>
          {toggle('show_promo', 'Promotion')}
          {toggle('show_slideshow', 'Product slideshow')}
          {toggle('show_featured', 'Featured product')}
          {toggle('show_announcements', 'Announcements')}
        </div>
        <p className="text-xs text-slate-500">A section shows only when it is on and has something in it.</p>
      </Card>

      <Card title="Featured product">
        <ItemPicker label="Featured product" value={s.featured_item_id ? { item_id: s.featured_item_id, item_name: featuredName ?? 'Selected item' } : null}
          onPick={(v: Picked) => run({ featured_item_id: v?.item_id ?? '' }, v ? `${v.item_name} is the featured product.` : 'Featured product removed.')} />
      </Card>

      <SlideshowSettings s={s} pending={pending} onSave={(d) => run(d, 'Slideshow saved.')} />

      <PostsManager posts={posts} categories={categories} />
    </div>
  );
}

function SlideshowSettings({ s, pending, onSave }: { s: ShopSettingsRow; pending: boolean; onSave: (d: Record<string, string>) => void }) {
  const [c, setC] = useState(s.slideshow_category ?? '');
  const [it, setIt] = useState(s.slideshow_item ?? '');
  const [b, setB] = useState(s.slideshow_brand ?? '');
  const [title, setTitle] = useState(s.slideshow_title ?? '');
  const [opt, setOpt] = useState<{ categories: string[]; items: string[]; brands: string[]; count: number } | null>(null);
  useEffect(() => { let live = true; shopFiltersAction(c, it, b).then((o) => { if (live) setOpt(o); }).catch(() => {}); return () => { live = false; }; }, [c, it, b]);
  const sel = (label: string, value: string, set: (v: string) => void, list: string[]) => (
    <label className="block text-sm"><span className="font-medium">{label}</span>
      <select className="input mt-1 w-full" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">(any)</option>
        {Array.from(new Set([...(value ? [value] : []), ...list])).map((x) => <option key={x} value={x}>{x}</option>)}
      </select></label>
  );
  const auto = [b, it || c].filter(Boolean).join(' ');
  return (
    <Card title="Product slideshow">
      <p className="text-xs text-slate-500">Choose what the slideshow cycles: any part can be left at (any). Car Aircon / Blower Motor / Toyota = all Toyota blower motors; Car Aircon / (any) / Toyota = all Toyota car aircon parts; Car Aircon / (any) / (any) = all car aircon parts; (any) / Blower Motor / (any) = all blower motors.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {sel('Category', c, setC, opt?.categories ?? [])}
        {sel('Item', it, setIt, opt?.items ?? [])}
        {sel('Brand', b, setB, opt?.brands ?? [])}
      </div>
      <label className="block text-sm"><span className="font-medium">Title</span>
        <input className="input mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={auto || 'e.g. Toyota blower motors'} />
        <span className="text-xs text-slate-500">Leave blank to use “{auto || '…'}”.</span></label>
      <div className="flex items-center gap-3">
        <button type="button" className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || !(c || it || b)}
          onClick={() => onSave({ slideshow_category: c, slideshow_item: it, slideshow_brand: b, slideshow_title: title })}>Save slideshow</button>
        <span className="text-xs text-slate-600">{c || it || b ? `${opt?.count ?? '…'} product${opt?.count === 1 ? '' : 's'} with photos (shows up to 20)` : 'Choose at least one'}</span>
      </div>
    </Card>
  );
}

const blank = (kind: 'announcement' | 'promo'): ShopPost => ({ id: '', kind, title: '', body: '', starts_on: '', ends_on: '', item_id: null, item_name: null, link_category: '', active: true });

function PostsManager({ posts, categories }: { posts: ShopPost[]; categories: string[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [edit, setEdit] = useState<ShopPost | null>(null);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const status = (p: ShopPost) => !p.active ? 'Hidden' : p.starts_on && p.starts_on > today ? `From ${p.starts_on}` : p.ends_on && p.ends_on < today ? 'Ended' : 'Showing';
  const save = () => edit && start(async () => {
    setErr('');
    try {
      await saveShopPostAction({ id: edit.id || null, kind: edit.kind, title: edit.title, body: edit.body ?? '', starts_on: edit.starts_on ?? '', ends_on: edit.ends_on ?? '',
        item_id: edit.item_id ?? '', link_category: edit.link_category ?? '', active: edit.active });
      setEdit(null); router.refresh();
    } catch (e) { setErr(errorText(e)); }
  });
  const remove = async (p: ShopPost) => {
    if (!(await dialog.confirm(`Remove "${p.title}" from the shop?`, { confirmLabel: 'Remove' }))) return;
    start(async () => { try { await deleteShopPostAction(p.id); router.refresh(); } catch (e) { setErr(errorText(e)); } });
  };
  return (
    <Card title="Announcements and promotions">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border px-3 py-1.5 text-sm font-semibold" onClick={() => setEdit(blank('announcement'))}>+ Announcement</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm font-semibold" onClick={() => setEdit(blank('promo'))}>+ Promotion</button>
      </div>
      <p className="text-xs text-slate-500">The shop shows the newest current promotion and up to 5 current announcements. Dates are optional: with none, a post shows until you hide or remove it.</p>
      {edit && (
        <div className="space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
          <div className="text-sm font-semibold">{edit.id ? 'Edit' : 'New'} {edit.kind === 'promo' ? 'promotion' : 'announcement'}</div>
          <label className="block text-sm"><span className="font-medium">Title *</span><input className="input mt-1 w-full" maxLength={120} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
          <label className="block text-sm"><span className="font-medium">Details</span><textarea className="input mt-1 w-full" rows={3} maxLength={600} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm"><span className="font-medium">Show from</span><input type="date" className="input mt-1 w-full" value={edit.starts_on ?? ''} onChange={(e) => setEdit({ ...edit, starts_on: e.target.value })} /></label>
            <label className="block text-sm"><span className="font-medium">Until</span><input type="date" className="input mt-1 w-full" value={edit.ends_on ?? ''} onChange={(e) => setEdit({ ...edit, ends_on: e.target.value })} /></label>
          </div>
          {edit.kind === 'promo' && (
            <>
              <ItemPicker label="Promo product (its photo shows)" value={edit.item_id ? { item_id: edit.item_id, item_name: edit.item_name ?? 'Selected item' } : null}
                onPick={(v) => setEdit({ ...edit, item_id: v?.item_id ?? null, item_name: v?.item_name ?? null })} />
              <label className="block text-sm"><span className="font-medium">“Shop the promo” opens this category</span>
                <select className="input mt-1 w-full" value={edit.link_category ?? ''} onChange={(e) => setEdit({ ...edit, link_category: e.target.value })}>
                  <option value="">(none)</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Show on the shop</label>
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={pending} className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white">{pending ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEdit(null); setErr(''); }} className="rounded border px-3 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      {posts.length === 0 && !edit && <p className="text-sm text-slate-500">No announcements or promotions yet.</p>}
      <ul className="divide-y">
        {posts.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.kind === 'promo' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{p.kind === 'promo' ? 'Promo' : 'News'}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.title}</span><span className="text-xs text-slate-500">{status(p)}{p.ends_on ? ` · until ${p.ends_on}` : ''}</span></span>
            <button type="button" className="text-xs underline" onClick={() => setEdit({ ...p, body: p.body ?? '', starts_on: p.starts_on ?? '', ends_on: p.ends_on ?? '', link_category: p.link_category ?? '' })}>Edit</button>
            <button type="button" className="text-xs text-red-700 underline" onClick={() => remove(p)}>Remove</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
