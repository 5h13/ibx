'use client';
// Build 141 (from 5h13Shops Builds 11–14): choose a tool, pick products, change any words, see the picture, then
// download / share / print it, post it on the store's online shop, or post it to Facebook. Everything is drawn here on
// the phone or computer (no server work) — see templates.ts. ERP changes: specification lines without "Label:" are
// kept as plain lines; product thumbnails load as they scroll into view.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_FONT, STUDIO_FONTS, loadStudioFonts, type StudioFont } from './fonts';
import { loadPic } from './draw';
import {
  BANNER_SIZES, BANNER_TEMPLATES, COLLAGE, PRICELIST, SPECS_LAYOUTS, THEME_KEYS, THEME_LABEL, drawBanner, drawCollage, drawPriceList,
  drawSpecsCard, peso, themeFor, type BannerSize, type BannerTemplate, type Brand, type SpecsLayout, type ThemeKey,
} from './templates';
import { saveStudioFontAction, postStudioImageAction } from './actions';
import { PhotoEditor } from './PhotoEditor';

export type StudioProduct = {
  id: string; code: string; name: string; category: string; price: number | null; available: boolean;
  specs: { label: string; value: string }[]; photos: string[]; created_at: string; updated_at: string;
};
type StoreInfo = { name: string; tagline: string; logoUrl: string | null; brandColor: string; contacts: string; font: StudioFont; shopUrl: string; canStore: boolean; canPost: boolean; /** Build 12.2 */ facebookUrl?: string | null };
type Tool = 'specs' | 'list' | 'banner' | 'collage';
const TOOLS: { key: Tool; label: string }[] = [
  { key: 'specs', label: 'Specs card' }, { key: 'list', label: 'Price list' }, { key: 'banner', label: 'Banner' }, { key: 'collage', label: 'New arrivals' },
];
const month = () => new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
const num = (s: string) => { const n = Number(String(s).replace(/[^\d.]/g, '')); return s.trim() === '' || !Number.isFinite(n) ? null : n; };
const specsText = (p?: StudioProduct) => (p?.specs ?? []).map((s) => (s.label ? `${s.label}: ${s.value}` : s.value)).join('\n');
// ERP: "Label: Value" lines, and plain lines (label left empty)
const parseSpecs = (t: string) => t.split('\n').map((l) => { const i = l.indexOf(':'); return i > 0 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: '', value: l.trim() }; })
  .filter((x) => !!x.value);

/** Pictures for the canvas, loaded once per address. */
function usePics(urls: (string | null | undefined)[]) {
  const cache = useRef(new Map<string, ImageBitmap | null>());
  const [, bump] = useState(0);
  const key = urls.filter(Boolean).join('|');
  useEffect(() => {
    let live = true;
    const todo = Array.from(new Set(urls.filter((u): u is string => !!u && !cache.current.has(u))));
    if (!todo.length) return;
    Promise.all(todo.map(async (u) => { cache.current.set(u, await loadPic(u)); })).then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const ready = urls.every((u) => !u || cache.current.has(u));
  return { get: (u: string | null | undefined) => (u ? cache.current.get(u) ?? null : null), ready };
}

export function StudioApp({ products, store, initialTool, initialCode }: { products: StudioProduct[]; store: StoreInfo; initialTool?: string; initialCode?: string }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const startProduct = products.find((p) => p.code.toLowerCase() === (initialCode ?? '').toLowerCase()) ?? products[0];
  const [tool, setTool] = useState<Tool>((['specs', 'list', 'banner', 'collage'] as Tool[]).includes(initialTool as Tool) ? initialTool as Tool : 'specs');
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { loadStudioFonts().then(() => setFontsReady(true)); }, []);

  // ---------------- the look (every tool) ----------------
  const [themeKey, setThemeKey] = useState<ThemeKey>('brand');
  const [font, setFontState] = useState<StudioFont>(store.font ?? DEFAULT_FONT);
  const [shopName, setShopName] = useState(store.name);
  const [tagline, setTagline] = useState(store.tagline);
  const [contacts, setContacts] = useState(store.contacts);
  function setFont(f: StudioFont) { setFontState(f); if (store.canStore) saveStudioFontAction(f).catch(() => { /* kept on this screen */ }); }

  // ---------------- photos from the phone / computer (Build 11.2) ----------------
  // kept on this screen only; nothing is uploaded until a finished picture is posted
  const [mine, setMine] = useState<{ id: string; bmp: ImageBitmap; url: string }[]>([]);
  const mineById = (id: string | null | undefined) => mine.find((m) => m.id === id) ?? null;
  // Build 12: touch up one of my photos (background, backdrop, size) — for this promo picture only
  const [touching, setTouching] = useState<string | null>(null);
  async function touched(id: string, f: File) {
    const bmp = await createImageBitmap(f), url = URL.createObjectURL(f);
    setMine((m) => m.map((x) => (x.id === id ? { id, bmp, url } : x)));
    setTouching(null);
  }
  async function addMine(files: FileList | null, max: number) {
    const out: { id: string; bmp: ImageBitmap; url: string }[] = [];
    for (const f of Array.from(files ?? []).slice(0, max)) {
      if (!/^image\//.test(f.type)) continue;
      try { out.push({ id: `mine-${Date.now()}-${out.length}`, bmp: await createImageBitmap(f), url: URL.createObjectURL(f) }); }
      catch { setMsg({ ok: false, text: `“${f.name}” could not be opened. Use a JPG or PNG photo.` }); }
    }
    setMine((m) => [...m, ...out]);
    return out.map((x) => x.id);
  }

  // ---------------- 1. specs card ----------------
  const [sp, setSp] = useState(() => specsFrom(startProduct));
  function specsFrom(p?: StudioProduct) {
    return { id: p?.id ?? '', layout: 'portrait' as SpecsLayout, name: p?.name ?? '', code: p?.code ?? '', specs: specsText(p), price: p?.price == null ? '' : String(p.price),
      ask: p?.price == null, available: p?.available ?? true, photo: 0, mine: null as string | null,
      saleOn: false, salePrice: p?.price == null ? '' : String(Math.round(p.price * 0.9)), saleNote: '', ribbonOn: false, ribbon: '', stripOn: false, strip: '' };
  }
  const spProduct = byId.get(sp.id);

  // ---------------- 2. price list ----------------
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(), [products]);
  // the list starts with the category that has the most products
  const bigCat = useMemo(() => { const n = new Map<string, number>(); for (const p of products) if (p.category) n.set(p.category, (n.get(p.category) ?? 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; }, [products]);
  const [pl, setPl] = useState({ kind: 'photos' as 'photos' | 'a4', source: 'category' as 'category' | 'pick', category: bigCat, picked: [] as string[],
    kicker: `Price list · ${month()}`, title: bigCat || 'Our prices', note: 'Prices may change without notice · Ask for bulk prices', qr: true,
    edits: {} as Record<string, { name?: string; price?: string }> });
  const plProducts = (pl.source === 'category' ? products.filter((p) => !pl.category || p.category === pl.category) : pl.picked.map((id) => byId.get(id)).filter((p): p is StudioProduct => !!p))
    .slice().sort((a, b) => pl.source === 'pick' ? 0 : (a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
  const plMax = pl.kind === 'photos' ? PRICELIST.photos.max : PRICELIST.a4.max;

  // ---------------- 3. banner ----------------
  const BANNER_TEXT: Record<BannerTemplate, { kicker: string; headline: string; sub: string; small: string }> = {
    photos: { kicker: 'Just arrived', headline: 'NEW STOCK', sub: 'Compressors · Capacitors · Refrigerant', small: '' },
    big: { kicker: 'Bulk discount', headline: '5% OFF', sub: 'on 10 pieces and up', small: 'Until the end of the month' },
    notice: { kicker: 'Store notice', headline: 'CLOSED ON SUNDAY', sub: 'Open again Monday, 8 AM.', small: 'Requests sent through our shop are answered when we open.' },
  };
  const [bn, setBn] = useState({ template: 'photos' as BannerTemplate, size: 'square' as BannerSize, ...BANNER_TEXT.photos, picked: products.slice(0, 3).map((p) => p.id), mine: [] as string[] });
  const bnMax = bn.template === 'photos' ? 3 : 1;

  // ---------------- 4. new arrivals / back in stock ----------------
  const suggest = (mode: 'new' | 'back', n: number) => (mode === 'new'
    ? products.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
    : products.filter((p) => p.available).sort((a, b) => b.updated_at.localeCompare(a.updated_at))).slice(0, n).map((p) => p.id);
  const [co, setCo] = useState({ mode: 'new' as 'new' | 'back', count: 4 as 4 | 6, kicker: 'This week', title: 'NEW ARRIVALS', showPrices: true, picked: suggest('new', 4) });

  // ---------------- pictures needed ----------------
  const urls = tool === 'specs' ? [store.logoUrl, spProduct?.photos[sp.photo] ?? spProduct?.photos[0]]
    : tool === 'list' ? [store.logoUrl, ...(pl.kind === 'photos' ? plProducts.slice(0, plMax).map((p) => p.photos[0]) : [])]
      : tool === 'banner' ? [store.logoUrl, ...(bn.template === 'notice' ? [] : bn.picked.slice(0, bn.template === 'photos' ? 3 : 1).map((id) => byId.get(id)?.photos[0]))]
        : [store.logoUrl, ...co.picked.slice(0, co.count).map((id) => byId.get(id)?.photos[0])];
  const pics = usePics(urls);

  // ---------------- drawing ----------------
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState('');
  const [fitted, setFitted] = useState<number | null>(null);
  const size = tool === 'specs' ? SPECS_LAYOUTS[sp.layout] : tool === 'list' ? PRICELIST[pl.kind] : tool === 'banner' ? BANNER_SIZES[bn.size] : COLLAGE[co.count];
  useEffect(() => {
    const c = canvas.current;
    if (!c || !fontsReady) return;
    c.width = size.w; c.height = size.h;
    const ctx = c.getContext('2d')!;
    const brand: Brand = { name: shopName, tagline, contacts, logo: pics.get(store.logoUrl), theme: themeFor(themeKey, store.brandColor), font };
    let fit: number | null = null;
    if (tool === 'specs') {
      const price = sp.ask ? null : num(sp.price);
      const sale = num(sp.salePrice);
      const pct = price && sale != null && sale < price ? `−${Math.round((1 - sale / price) * 100)}%` : '';
      drawSpecsCard(ctx, brand, {
        layout: sp.layout, item: { code: sp.code, name: sp.name, price, specs: parseSpecs(sp.specs), available: sp.available, photo: mineById(sp.mine)?.bmp ?? pics.get(spProduct?.photos[sp.photo] ?? spProduct?.photos[0]) },
        price, ask: sp.ask, sale: { on: sp.saleOn, price: sale, badge: pct, note: sp.saleNote },
        ribbon: { on: sp.ribbonOn, text: sp.ribbon }, strip: { on: sp.stripOn, text: sp.strip },
      });
    } else if (tool === 'list') {
      const rows = plProducts.map((p) => {
        const e = pl.edits[p.id] ?? {};
        const first = p.specs[0]?.value ?? '';
        return { code: p.code, name: e.name ?? p.name, sub: pl.kind === 'photos' ? [p.code, first].filter(Boolean).join(' · ') : first, price: e.price !== undefined ? num(e.price) : p.price,
          group: pl.kind === 'a4' && pl.source === 'category' && !pl.category ? p.category : '', photo: pics.get(p.photos[0]) };
      });
      fit = drawPriceList(ctx, brand, { kind: pl.kind, kicker: pl.kicker, title: pl.title, note: pl.note, rows, qr: pl.kind === 'a4' && pl.qr ? store.shopUrl : null });
    } else if (tool === 'banner') {
      drawBanner(ctx, brand, { template: bn.template, size: bn.size, kicker: bn.kicker, headline: bn.headline, sub: bn.sub, small: bn.small,
        photos: bn.template === 'notice' ? [] : [...bn.mine.map((id) => mineById(id)?.bmp ?? null), ...bn.picked.map((id) => pics.get(byId.get(id)?.photos[0]))].filter(Boolean).slice(0, bnMax) });
    } else {
      drawCollage(ctx, brand, { count: co.count, kicker: co.kicker, title: co.title, showPrices: co.showPrices,
        items: co.picked.slice(0, co.count).map((id) => byId.get(id)).filter((p): p is StudioProduct => !!p).map((p) => ({ name: p.name, price: p.price, photo: pics.get(p.photos[0]) })) });
    }
    setFitted(fit);
    setDrawn(pics.ready ? 'ready' : '');
  });

  // ---------------- saving ----------------
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const fileName = () => `${tool === 'specs' ? `specs-${sp.code || 'card'}-${sp.layout}` : tool === 'list' ? `price-list-${pl.kind}` : tool === 'banner' ? `banner-${bn.template}-${bn.size}` : `${co.mode === 'new' ? 'new-arrivals' : 'back-in-stock'}`}.png`.toLowerCase();
  const blob = () => new Promise<Blob>((res, rej) => canvas.current!.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
  async function download() {
    const url = URL.createObjectURL(await blob());
    const a = document.createElement('a'); a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setMsg({ ok: true, text: 'Saved to your downloads. Post it on Facebook or send it in Viber / WhatsApp.' });
  }
  async function share() {
    try {
      const file = new File([await blob()], fileName(), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: shopName }); return; }
      await download();
    } catch { /* closed */ }
  }
  function print() {
    const data = canvas.current!.toDataURL('image/png');
    const w = window.open('', '_blank');
    if (!w) { setMsg({ ok: false, text: 'Allow pop-ups for this site to print, or use Download.' }); return; }
    w.document.write(`<!doctype html><title>${fileName()}</title><style>@page{size:A4;margin:0}html,body{margin:0}img{width:100%;display:block}</style><img src="${data}" onload="setTimeout(()=>print(),300)">`);
    w.document.close();
  }
  const [post, setPost] = useState({ open: false, title: '', ends: '', kind: 'promo' as 'promo' | 'announcement' });
  // the promotion's title starts as the picture's own words; the seller can change it
  const defaultTitle = (tool === 'banner' ? [bn.headline, bn.sub].filter((x) => x.trim()).join(' — ') : tool === 'collage' ? co.title : tool === 'specs' ? sp.name : pl.title).trim().slice(0, 120);
  async function putOnShop() {
    const kind = post.kind;
    setBusy('post'); setMsg(null);
    try {
      const fd = new FormData();
      fd.set('file', new File([await blob()], 'studio.png', { type: 'image/png' }));
      fd.set('title', post.title.trim() || defaultTitle);
      fd.set('ends_on', post.ends); fd.set('kind', kind);
      if (tool === 'specs' && sp.id) fd.set('product_id', sp.id);
      await postStudioImageAction(fd);
      setMsg({ ok: true, text: kind === 'promo' ? 'Posted — it shows at the top of your shop. Change or remove it in Posts.' : 'Posted — it shows in your shop’s announcements. Change or remove it in Posts.' });
      setPost({ open: false, title: '', ends: '', kind: 'promo' });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error)?.message || 'It could not be saved. Try again.' }); }
    setBusy('');
  }

  // ---------------- Facebook (Build 12.2) ----------------
  // Facebook does not let a website fill in a post, so the caption is copied and the picture shared / downloaded.
  const [caption, setCaption] = useState<string | null>(null);
  const [fbMsg, setFbMsg] = useState('');
  const pesoTxt = (n: number | null) => (n == null ? 'Ask for price' : peso(n));
  const defaultCaption = (() => {
    const link = `Order / ask: ${store.shopUrl}`;
    if (tool === 'specs') {
      const price = sp.ask ? 'Ask for price' : sp.saleOn && num(sp.salePrice) != null ? `${pesoTxt(num(sp.salePrice))} (was ${pesoTxt(num(sp.price))})` : pesoTxt(num(sp.price));
      return [sp.name, price + (sp.available ? ' · Available' : ' · By order'), ...parseSpecs(sp.specs).slice(0, 6).map((s) => `• ${s.label ? `${s.label}: ` : ''}${s.value}`), sp.ribbonOn && sp.ribbon.trim() ? sp.ribbon : '', sp.stripOn && sp.strip.trim() ? sp.strip : '', '', link].filter((x, i, a) => x !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
    }
    if (tool === 'banner') return [bn.headline, bn.sub, bn.small, '', link].filter((x, i, a) => x.trim() !== '' || (i > 0 && a[i - 1].trim() !== '')).join('\n');
    if (tool === 'collage') return [co.title, ...co.picked.slice(0, co.count).map((id) => byId.get(id)).filter((p): p is StudioProduct => !!p).map((p) => `• ${p.name}${co.showPrices ? ` — ${pesoTxt(p.price)}` : ''}`), '', link].join('\n');
    return [pl.title, pl.kicker, pl.note, '', link].filter((x, i, a) => x.trim() !== '' || (i > 0 && a[i - 1].trim() !== '')).join('\n');
  })();
  async function copyText(t: string) {
    try { await navigator.clipboard.writeText(t); return true; } catch {
      try { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
    }
  }
  async function toFacebook() {
    const text = caption ?? defaultCaption;
    const copied = await copyText(text);
    try {
      const file = new File([await blob()], fileName(), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        setFbMsg(copied ? 'Caption copied. Choose Facebook in the menu, then paste the caption (press and hold, Paste).' : 'Choose Facebook in the menu.');
        await navigator.share({ files: [file], text });
        return;
      }
    } catch { /* closed the menu */ return; }
    await download();
    setMsg(null);
    window.open(store.facebookUrl || 'https://www.facebook.com/', '_blank', 'noopener');
    setFbMsg(`Picture saved to your downloads${copied ? ' and caption copied' : ''}. In Facebook: Photo/video → add the picture → paste the caption (Ctrl+V) → Post.`);
  }

  // ---------------- screen ----------------
  const chip = (on: boolean) => `min-h-[40px] rounded-full border px-3.5 text-[14px] font-semibold ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white'}`;
  if (!products.length) return <p className="m-4 rounded-2xl bg-white p-6 text-[15px] text-slate-600">Add products first — the Studio makes pictures from your products (photos, names, prices, specs).</p>;
  return (
    <div className="space-y-4 overflow-x-hidden px-4 pb-8 pt-3 md:px-0 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-4 lg:space-y-0 lg:overflow-visible">
      {touching && mineById(touching) && <PhotoEditor source={mineById(touching)!.url} shopColor={store.brandColor} title="Touch up my photo"
        onCancel={() => setTouching(null)} onAsIs={() => setTouching(null)} onDone={(f) => touched(touching, f)} />}
      <style>{STUDIO_FONTS.map((f) => `@font-face{font-family:"Preview-${f.key}";src:url(/fonts/${f.file}.woff2)}`).join('')}</style>
      <nav aria-label="Studio tools" className="flex flex-wrap gap-2 lg:col-start-1 lg:row-start-1">
        {TOOLS.map((t) => <button key={t.key} type="button" aria-pressed={tool === t.key} onClick={() => { setTool(t.key); setMsg(null); setFbMsg(''); setCaption(null); setPost({ open: false, title: '', ends: '', kind: 'promo' }); }} className={chip(tool === t.key)}>{t.label}</button>)}
      </nav>

      {/* Build 14: on wide screens the picture and its buttons stay in view on the right while you edit on the left */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
      <div className="card overflow-hidden p-2">
        <canvas ref={canvas} data-testid="studio-canvas" data-ready={drawn ? '1' : '0'} data-fitted={fitted ?? ''} aria-label="Picture preview"
          className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full rounded-lg" style={{ aspectRatio: `${size.w} / ${size.h}` }} />
        {!fontsReady && <p className="p-3 text-center text-[13px] text-slate-500">Loading fonts…</p>}
        {tool === 'list' && fitted != null && fitted < Math.min(plProducts.length, plMax) && <p role="status" className="p-2 text-center text-[13px] text-amber-800">{Math.min(plProducts.length, plMax) - fitted} items did not fit — pick fewer, or make a second list.</p>}
        {tool === 'list' && plProducts.length > plMax && <p role="status" className="p-2 text-center text-[13px] text-amber-800">This list shows the first {plMax} items. Pick fewer, or make a second list.</p>}
      </div>

      <section className="card space-y-2 p-4" aria-label="Save or use the picture">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primary" onClick={download} disabled={!drawn}>Download</button>
          <button type="button" className="btn-ghost" onClick={share} disabled={!drawn}>Share…</button>
          {tool === 'list' && pl.kind === 'a4' && <button type="button" className="btn-ghost col-span-2" onClick={print} disabled={!drawn}>Print / Save as PDF</button>}
          {store.canPost && tool !== 'list' && (['promo', 'announcement'] as const).map((k) => (
            <button key={k} type="button" className="btn-ghost col-span-2" aria-expanded={post.open && post.kind === k}
              onClick={() => setPost(post.open && post.kind === k ? { ...post, open: false } : { open: true, kind: k, ends: post.ends, title: post.open ? post.title : defaultTitle })}>
              {k === 'promo' ? 'Post on my shop as the promotion' : 'Post on my shop as an announcement'}</button>))}
        </div>
        {post.open && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <label className="block"><span className="lbl">Title (for you, and for buyers who can&apos;t see pictures)</span>
              <input className="field" value={post.title} maxLength={120} onChange={(e) => setPost({ ...post, title: e.target.value })} placeholder="e.g. New stock this week" aria-label={post.kind === 'promo' ? 'Promotion title' : 'Announcement title'} /></label>
            <label className="block"><span className="lbl">Show until (optional)</span><input type="date" className="field" value={post.ends} onChange={(e) => setPost({ ...post, ends: e.target.value })} /></label>
            <button type="button" className="btn-primary w-full" disabled={!!busy || !drawn} onClick={putOnShop}>{busy === 'post' ? 'Posting…' : 'Post it'}</button>
            <p className="text-[12px] text-slate-500">{post.kind === 'promo' ? `It replaces the promotion at the top of your shop (the newest one shows).${tool === 'specs' ? ' Buyers tap it to open the product.' : ''}` : 'It is added to your shop’s announcements (the newest first, up to 5 show).'}</p>
          </div>
        )}
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-[14px] ${msg.ok ? 'text-brand-dark' : 'text-red-700'}`}>{msg.text}</p>}
      </section>

      <section className="card space-y-2 p-4" aria-label="Post to Facebook">
        <h2 className="text-[16px] font-extrabold">Post to Facebook</h2>
        <label className="block"><span className="lbl">Caption (you can change it)</span>
          <textarea className="field text-[14px]" rows={6} value={caption ?? defaultCaption} onChange={(e) => setCaption(e.target.value)} aria-label="Facebook caption" /></label>
        {caption != null && <button type="button" className="text-[13px] font-semibold text-brand-dark underline" onClick={() => setCaption(null)}>Use the suggested caption again</button>}
        <button type="button" className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[#0866ff] text-[16px] font-bold text-white disabled:opacity-60" disabled={!drawn} onClick={toFacebook}>Post to Facebook</button>
        <p className="text-[12px] text-slate-500">On a phone: choose Facebook (or Meta Business Suite / Pages Manager) in the share menu, then paste the caption. On a computer: the picture is saved to your downloads and the caption copied — in Facebook tap Photo/video, add the picture, paste the caption.</p>
        {fbMsg && <p role="status" className="rounded-xl bg-sky-50 p-3 text-[14px] text-sky-900">{fbMsg}</p>}
      </section>
      </div>
      <div className="space-y-4 lg:col-start-1 lg:row-start-2">

      {tool === 'specs' && (
        <section className="card space-y-3 p-4" aria-label="Specs card">
          <ProductPicker products={products} picked={sp.id ? [sp.id] : []} max={1} label="Product" onChange={(ids) => setSp({ ...specsFrom(byId.get(ids[0])), layout: sp.layout })} />
          <fieldset className="min-w-0"><legend className="lbl">Size</legend>
            <div className="flex flex-wrap gap-2">{(Object.keys(SPECS_LAYOUTS) as SpecsLayout[]).map((k) => <button key={k} type="button" aria-pressed={sp.layout === k} onClick={() => setSp({ ...sp, layout: k })} className={chip(sp.layout === k)}>{SPECS_LAYOUTS[k].label}</button>)}</div>
            <p className="mt-1 text-[12px] text-slate-500">{SPECS_LAYOUTS[sp.layout].use}</p>
          </fieldset>
          <fieldset className="min-w-0"><legend className="lbl">Photo</legend>
            <div className="flex flex-wrap gap-2">
              {(spProduct?.photos ?? []).map((_, i) => <button key={i} type="button" aria-pressed={!sp.mine && sp.photo === i} onClick={() => setSp({ ...sp, photo: i, mine: null })} className={chip(!sp.mine && sp.photo === i)}>Photo {i + 1}</button>)}
              {mine.map((m, i) => <button key={m.id} type="button" aria-pressed={sp.mine === m.id} onClick={() => setSp({ ...sp, mine: m.id })} className={`${chip(sp.mine === m.id)} flex items-center gap-1.5`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={m.url} alt="" className="h-6 w-6 rounded object-cover" />My photo {i + 1}</button>)}
            </div>
            <MyPhotoButton label="Use my own photo" onFiles={async (f) => { const [id] = await addMine(f, 1); if (id) { setSp((x) => ({ ...x, mine: id })); setTouching(id); } }} />
            {sp.mine && <button type="button" className="btn-ghost mt-2 w-full" onClick={() => setTouching(sp.mine)}>Touch up my photo</button>}
          </fieldset>
          <label className="block"><span className="lbl">Name</span><input className="field" value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} aria-label="Card name" /></label>
          <label className="block"><span className="lbl">Code</span><input className="field" value={sp.code} onChange={(e) => setSp({ ...sp, code: e.target.value })} aria-label="Card code" /></label>
          <label className="block"><span className="lbl">Specs — one per line, “Label: Value”</span><textarea className="field" rows={5} value={sp.specs} onChange={(e) => setSp({ ...sp, specs: e.target.value })} aria-label="Card specs" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="lbl">Price</span><input className="field" inputMode="decimal" value={sp.price} disabled={sp.ask} onChange={(e) => setSp({ ...sp, price: e.target.value })} aria-label="Card price" /></label>
            <fieldset className="min-w-0"><legend className="lbl">Stock</legend><div className="flex gap-1.5"><button type="button" aria-pressed={sp.available} onClick={() => setSp({ ...sp, available: true })} className={chip(sp.available)}>Available</button><button type="button" aria-pressed={!sp.available} onClick={() => setSp({ ...sp, available: false })} className={chip(!sp.available)}>By order</button></div></fieldset>
          </div>
          <Toggle on={sp.ask} set={(v) => setSp({ ...sp, ask: v })} label="Show “Ask for price” instead of the price" />
          <Toggle on={sp.saleOn} set={(v) => setSp({ ...sp, saleOn: v })} label="On sale (old price crossed out, % badge)" disabled={sp.ask} />
          {sp.saleOn && !sp.ask && (
            <div className="grid grid-cols-2 gap-2 pl-8">
              <label className="block"><span className="lbl">Sale price</span><input className="field" inputMode="decimal" value={sp.salePrice} onChange={(e) => setSp({ ...sp, salePrice: e.target.value })} aria-label="Sale price" /></label>
              <label className="block"><span className="lbl">Note (optional)</span><input className="field" value={sp.saleNote} maxLength={40} onChange={(e) => setSp({ ...sp, saleNote: e.target.value })} placeholder="Promo until Nov 15" aria-label="Sale note" /></label>
            </div>
          )}
          <Toggle on={sp.ribbonOn} set={(v) => setSp({ ...sp, ribbonOn: v })} label="Promo ribbon" />
          {sp.ribbonOn && <input className="field" value={sp.ribbon} maxLength={50} onChange={(e) => setSp({ ...sp, ribbon: e.target.value })} placeholder="BULK: 10+ pcs ₱2,300 each" aria-label="Ribbon text" />}
          <Toggle on={sp.stripOn} set={(v) => setSp({ ...sp, stripOn: v })} label="Announcement strip" />
          {sp.stripOn && <input className="field" value={sp.strip} maxLength={70} onChange={(e) => setSp({ ...sp, strip: e.target.value })} placeholder="Free delivery within Bulacan, ₱5,000+" aria-label="Strip text" />}
        </section>
      )}

      {tool === 'list' && (
        <section className="card space-y-3 p-4" aria-label="Price list">
          <fieldset className="min-w-0"><legend className="lbl">Kind</legend><div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={pl.kind === 'photos'} onClick={() => setPl({ ...pl, kind: 'photos', kicker: `Price list · ${month()}`, title: pl.category || 'Our prices' })} className={chip(pl.kind === 'photos')}>With photos (up to 8)</button>
            <button type="button" aria-pressed={pl.kind === 'a4'} onClick={() => setPl({ ...pl, kind: 'a4', kicker: 'Price list', title: month() })} className={chip(pl.kind === 'a4')}>Printable A4</button>
          </div></fieldset>
          <fieldset className="min-w-0"><legend className="lbl">Products</legend><div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={pl.source === 'category'} onClick={() => setPl({ ...pl, source: 'category' })} className={chip(pl.source === 'category')}>A category</button>
            <button type="button" aria-pressed={pl.source === 'pick'} onClick={() => setPl({ ...pl, source: 'pick', picked: pl.picked.length ? pl.picked : plProducts.slice(0, plMax).map((p) => p.id) })} className={chip(pl.source === 'pick')}>Pick products</button>
          </div></fieldset>
          {pl.source === 'category' ? (
            <label className="block"><span className="lbl">Category</span>
              <select className="field" value={pl.category} onChange={(e) => setPl({ ...pl, category: e.target.value, title: pl.kind === 'photos' ? (e.target.value || 'Our prices') : pl.title })} aria-label="List category">
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="">All categories{pl.kind === 'a4' ? ' (grouped)' : ''}</option>
              </select></label>
          ) : <ProductPicker products={products} picked={pl.picked} max={plMax} label={`Products (up to ${plMax})`} onChange={(ids) => setPl({ ...pl, picked: ids })} />}
          <label className="block"><span className="lbl">Small heading</span><input className="field" value={pl.kicker} onChange={(e) => setPl({ ...pl, kicker: e.target.value })} aria-label="List small heading" /></label>
          <label className="block"><span className="lbl">Title</span><input className="field" value={pl.title} onChange={(e) => setPl({ ...pl, title: e.target.value })} aria-label="List title" /></label>
          <label className="block"><span className="lbl">Note (optional)</span><input className="field" value={pl.note} onChange={(e) => setPl({ ...pl, note: e.target.value })} aria-label="List note" /></label>
          {pl.kind === 'a4' && <Toggle on={pl.qr} set={(v) => setPl({ ...pl, qr: v })} label="QR code to your shop (for printed sheets)" />}
          <details className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-[15px] font-bold">Change names or prices on this list</summary>
            <div className="mt-2 space-y-2">{plProducts.slice(0, plMax).map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_7rem] gap-2">
                <input className="field" value={pl.edits[p.id]?.name ?? p.name} onChange={(e) => setPl({ ...pl, edits: { ...pl.edits, [p.id]: { ...pl.edits[p.id], name: e.target.value } } })} aria-label={`List name ${p.code}`} />
                <input className="field" inputMode="decimal" value={pl.edits[p.id]?.price ?? (p.price == null ? '' : String(p.price))} onChange={(e) => setPl({ ...pl, edits: { ...pl.edits, [p.id]: { ...pl.edits[p.id], price: e.target.value } } })} aria-label={`List price ${p.code}`} placeholder="Ask" />
              </div>))}
              <p className="text-[12px] text-slate-500">Changes here are for this picture only; your products stay as they are.</p>
            </div>
          </details>
        </section>
      )}

      {tool === 'banner' && (
        <section className="card space-y-3 p-4" aria-label="Banner">
          <fieldset className="min-w-0"><legend className="lbl">Template</legend><div className="flex flex-wrap gap-2">{(Object.keys(BANNER_TEMPLATES) as BannerTemplate[]).map((k) => (
            <button key={k} type="button" aria-pressed={bn.template === k} onClick={() => setBn({ ...bn, template: k, ...BANNER_TEXT[k] })} className={chip(bn.template === k)}>{BANNER_TEMPLATES[k]}</button>))}</div></fieldset>
          <fieldset className="min-w-0"><legend className="lbl">Size</legend><div className="flex flex-wrap gap-2">{(Object.keys(BANNER_SIZES) as BannerSize[]).map((k) => (
            <button key={k} type="button" aria-pressed={bn.size === k} onClick={() => setBn({ ...bn, size: k })} className={chip(bn.size === k)}>{BANNER_SIZES[k].label}</button>))}</div></fieldset>
          <label className="block"><span className="lbl">Small heading</span><input className="field" value={bn.kicker} onChange={(e) => setBn({ ...bn, kicker: e.target.value })} aria-label="Banner small heading" /></label>
          <label className="block"><span className="lbl">Headline</span><input className="field" value={bn.headline} onChange={(e) => setBn({ ...bn, headline: e.target.value })} aria-label="Banner headline" /></label>
          <label className="block"><span className="lbl">Line under it</span><input className="field" value={bn.sub} onChange={(e) => setBn({ ...bn, sub: e.target.value })} aria-label="Banner line" /></label>
          <label className="block"><span className="lbl">Small print (optional)</span><input className="field" value={bn.small} onChange={(e) => setBn({ ...bn, small: e.target.value })} aria-label="Banner small print" /></label>
          {bn.template !== 'notice' && (
            <div className="space-y-2">
              <span className="lbl">My own photos{bnMax > 1 ? ` (with product photos, up to ${bnMax} in all)` : ' (instead of a product photo)'}</span>
              {bn.mine.length > 0 && <div className="flex flex-wrap gap-2">{bn.mine.map((id) => { const m = mineById(id); return m && (
                <span key={id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-1.5 pr-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={m.url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  <button type="button" className="text-[13px] font-bold text-brand-dark" onClick={() => setTouching(id)} aria-label="Touch up my photo">Touch up</button>
                  <button type="button" className="text-[13px] font-bold text-red-700" onClick={() => setBn({ ...bn, mine: bn.mine.filter((x) => x !== id) })} aria-label="Remove my photo">Remove</button></span>); })}</div>}
              {bn.mine.length < bnMax && <MyPhotoButton multiple={bnMax > 1} label="Add my own photos" onFiles={async (f, camera) => { const ids = await addMine(f, bnMax - bn.mine.length); if (camera && ids[0]) setTouching(ids[0]); setBn((x) => ({ ...x, mine: [...x.mine, ...ids].slice(0, bnMax), picked: x.picked.slice(0, Math.max(0, bnMax - x.mine.length - ids.length)) })); }} />}
              {bn.mine.length < bnMax && <ProductPicker products={products} picked={bn.picked.slice(0, bnMax - bn.mine.length)} max={bnMax - bn.mine.length} label={bnMax > 1 ? 'Product photos' : 'Product photo'} onChange={(ids) => setBn({ ...bn, picked: ids })} />}
            </div>
          )}
        </section>
      )}

      {tool === 'collage' && (
        <section className="card space-y-3 p-4" aria-label="New arrivals">
          <fieldset className="min-w-0"><legend className="lbl">Kind</legend><div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={co.mode === 'new'} onClick={() => setCo({ ...co, mode: 'new', kicker: 'This week', title: 'NEW ARRIVALS', picked: suggest('new', co.count) })} className={chip(co.mode === 'new')}>New arrivals</button>
            <button type="button" aria-pressed={co.mode === 'back'} onClick={() => setCo({ ...co, mode: 'back', kicker: 'Ready for pickup', title: 'BACK IN STOCK', picked: suggest('back', co.count) })} className={chip(co.mode === 'back')}>Back in stock</button>
          </div></fieldset>
          <fieldset className="min-w-0"><legend className="lbl">How many</legend><div className="flex gap-2">{([4, 6] as const).map((n) => <button key={n} type="button" aria-pressed={co.count === n} onClick={() => setCo({ ...co, count: n, picked: n > co.picked.length ? [...co.picked, ...suggest(co.mode, 12).filter((id) => !co.picked.includes(id))].slice(0, n) : co.picked })} className={chip(co.count === n)}>{n} products</button>)}</div></fieldset>
          <label className="block"><span className="lbl">Small heading</span><input className="field" value={co.kicker} onChange={(e) => setCo({ ...co, kicker: e.target.value })} aria-label="Collage small heading" /></label>
          <label className="block"><span className="lbl">Title</span><input className="field" value={co.title} onChange={(e) => setCo({ ...co, title: e.target.value })} aria-label="Collage title" /></label>
          <Toggle on={co.showPrices} set={(v) => setCo({ ...co, showPrices: v })} label="Show prices" />
          <ProductPicker products={products} picked={co.picked} max={co.count} label={`Products (${co.count})`} hint={co.mode === 'new' ? 'Your newest products are ticked — change them as you like.' : 'Products in stock that changed lately are ticked — change them as you like.'} onChange={(ids) => setCo({ ...co, picked: ids })} />
        </section>
      )}

      <details className="card p-4" open={false}>
        <summary className="cursor-pointer text-[16px] font-bold">Look: colours, font, shop name, contacts</summary>
        <div className="mt-3 space-y-3">
          <fieldset className="min-w-0"><legend className="lbl">Colours</legend><div className="flex flex-wrap gap-2">{THEME_KEYS.map((k) => {
            const t = themeFor(k, store.brandColor);
            return <button key={k} type="button" aria-pressed={themeKey === k} onClick={() => setThemeKey(k)} className={`${chip(themeKey === k)} flex items-center gap-2`}><span className="h-5 w-5 rounded-full border" style={{ background: t.bg }} />{THEME_LABEL[k]}</button>;
          })}</div></fieldset>
          <fieldset className="min-w-0"><legend className="lbl">Headline font</legend><div className="grid grid-cols-1 gap-2">{STUDIO_FONTS.map((f) => (
            <button key={f.key} type="button" aria-pressed={font === f.key} onClick={() => setFont(f.key)} className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3 text-left ${font === f.key ? 'border-brand bg-brand-soft' : 'border-slate-200 bg-white'}`}>
              <span style={{ fontFamily: `"Preview-${f.key}", sans-serif`, fontSize: 22, fontWeight: 800 }}>{f.label}</span><span className="text-[12px] text-slate-500">{f.note}</span>
            </button>))}</div>
            {store.canStore && <p className="mt-1 text-[12px] text-slate-500">Saved for this store — your next pictures use it too.</p>}
          </fieldset>
          <label className="block"><span className="lbl">Shop name</span><input className="field" value={shopName} onChange={(e) => setShopName(e.target.value)} aria-label="Picture shop name" /></label>
          <label className="block"><span className="lbl">Tagline</span><input className="field" value={tagline} onChange={(e) => setTagline(e.target.value)} aria-label="Picture tagline" /></label>
          <label className="block"><span className="lbl">Contacts line</span><input className="field" value={contacts} onChange={(e) => setContacts(e.target.value)} aria-label="Picture contacts" />
            <span className="mt-1 block text-[12px] text-slate-500">The part before the first “·” is shown in bold.</span></label>
        </div>
      </details>
      <p className="text-center text-[12px] text-slate-400">Prices are this store&apos;s prices{products.some((p) => p.price == null) ? '; products without a price show “Ask”' : ''}.</p>
      </div>
    </div>
  );
}

/** Two buttons: take a photo with the camera, or choose photos from the gallery / computer files. */
function MyPhotoButton({ label, multiple = false, onFiles }: { label: string; multiple?: boolean; onFiles: (f: FileList | null, camera: boolean) => void }) {
  const box = 'flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-[14px] font-bold';
  return (
    <div className="mt-2 space-y-1">
      <span className="block text-[13px] text-slate-600">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <label className={`${box} bg-brand text-white`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label={`${label}: take photo`} onChange={(e) => { onFiles(e.target.files, true); e.target.value = ''; }} />
        </label>
        <label className={`${box} border border-slate-300 bg-white text-slate-800`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
          Gallery
          <input type="file" accept="image/*" multiple={multiple} className="sr-only" aria-label={`${label}: gallery`} onChange={(e) => { onFiles(e.target.files, false); e.target.value = ''; }} />
        </label>
      </div>
    </div>
  );
}

function Toggle({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-[44px] items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} className="h-5 w-5 accent-[#0e6e63]" />
      <span className="text-[15px]">{label}</span>
    </label>
  );
}

/** Search and tick products (max = how many; 1 = choose one). */
function ProductPicker({ products, picked, max, label, hint, onChange }: { products: StudioProduct[]; picked: string[]; max: number; label: string; hint?: string; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const list = products.filter((p) => !q.trim() || `${p.code} ${p.name} ${p.category}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => {
    if (max === 1) return onChange([id]);
    if (picked.includes(id)) return onChange(picked.filter((x) => x !== id));
    if (picked.length >= max) return;
    onChange([...picked, id]);
  };
  return (
    <fieldset className="min-w-0">
      <legend className="lbl">{label}{max > 1 ? ` · ${picked.length} of ${max} ticked` : ''}</legend>
      {hint && <p className="mb-1 text-[12px] text-slate-500">{hint}</p>}
      <input type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name…" aria-label={`Search: ${label}`} />
      <ul className="mt-2 max-h-72 space-y-1 overflow-auto rounded-xl border border-slate-200 p-1">
        {list.slice(0, 200).map((p) => {
          const on = picked.includes(p.id);
          return (
            <li key={p.id}>
              <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg px-2 ${on ? 'bg-brand-soft' : ''} ${!on && max > 1 && picked.length >= max ? 'opacity-50' : ''}`}>
                <input type={max === 1 ? 'radio' : 'checkbox'} checked={on} onChange={() => toggle(p.id)} className="h-5 w-5 accent-[#0e6e63]" aria-label={`${p.code} ${p.name}`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.photos[0] ? <img src={p.photos[0]} alt="" loading="lazy" className="h-10 w-10 flex-none rounded-lg bg-slate-100 object-contain" /> : <span className="h-10 w-10 flex-none rounded-lg bg-slate-100" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{p.name}</span><span className="block truncate text-[12px] text-slate-500">{p.code}{p.category ? ` · ${p.category}` : ''}{p.price != null ? ` · ${peso(p.price)}` : ''}</span></span>
              </label>
            </li>
          );
        })}
        {!list.length && <li className="p-3 text-[14px] text-slate-500">No product matches.</li>}
      </ul>
    </fieldset>
  );
}
