// Build 11 (Studio, D44): the pictures the Studio makes, drawn on a canvas from the products. Layouts follow the
// mockups the owner approved (Shops\studio_mockups): specs card (4 sizes, sale / promo ribbon / announcement /
// ask for price), price list (with photos, or printable A4 text), banners, New arrivals / Back in stock.
import QRCode from 'qrcode';
import { BODY, headFamily, type StudioFont } from './fonts';
import { box, clip, line, picture, rr, setFont, text, type C2D, type Pic } from './draw';

export type Theme = { bg: string; fg: string; acc: string; soft: string; ink: string };
export const THEME_KEYS = ['brand', 'navy', 'teal', 'red', 'char'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export const THEME_LABEL: Record<ThemeKey, string> = { brand: 'Your colour', navy: 'Navy', teal: 'Teal', red: 'Red', char: 'Charcoal' };
const FIXED: Record<Exclude<ThemeKey, 'brand'>, Theme> = {
  navy: { bg: '#0b2236', fg: '#ffffff', acc: '#ffc928', soft: '#eef3f8', ink: '#0b2236' },
  teal: { bg: '#0e6e63', fg: '#ffffff', acc: '#ffd23f', soft: '#ecf5f3', ink: '#0d2e2a' },
  red: { bg: '#b3261e', fg: '#ffffff', acc: '#ffe066', soft: '#f7f1ef', ink: '#231815' },
  char: { bg: '#22272b', fg: '#ffffff', acc: '#ff7a1a', soft: '#f1f2f3', ink: '#16191b' },
};
/** The store's own colour as a set: its colour behind the header, white or dark text on it as it needs. */
export function themeFor(key: ThemeKey, brand: string): Theme {
  if (key !== 'brand') return FIXED[key];
  const hex = /^#[0-9a-f]{6}$/i.test(brand) ? brand : '#0e6e63';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
  const mix = (t: number) => '#' + [r, g, b].map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('');
  return { bg: hex, fg: light ? '#111111' : '#ffffff', acc: light ? '#111111' : '#ffc928', soft: mix(0.9), ink: light ? '#111111' : hex };
}

export type Brand = { name: string; tagline: string; contacts: string; logo: Pic | null; theme: Theme; font: StudioFont };
export type Spec = { label: string; value: string };
export type Item = { code: string; name: string; price: number | null; specs: Spec[]; available: boolean; photo: Pic | null };

export const peso = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const GREY = '#5b6670', LINE = '#e6eaed';
const H = (b: Brand) => headFamily(b.font);
function spacing(ctx: C2D, px: number) { try { (ctx as C2D & { letterSpacing: string }).letterSpacing = `${px}px`; } catch { /* older browsers */ } }

// ------------------------------------------------------------------ shared pieces --
function logoBox(ctx: C2D, b: Brand, x: number, y: number, s: number, onDark = true) {
  box(ctx, x, y, s, s, onDark ? '#ffffff' : b.theme.bg, s * 0.18);
  if (b.logo) {
    ctx.save(); rr(ctx, x, y, s, s, s * 0.18); ctx.clip();
    picture(ctx, b.logo, x, y, s, s, 'contain', s * 0.06);
    ctx.restore();
  } else {
    const initials = b.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'S';
    line(ctx, initials, x + s / 2, y + s / 2 + s * 0.03, { weight: 800, size: s * 0.42, family: H(b), color: onDark ? b.theme.bg : '#ffffff', align: 'center' });
  }
}
/** Logo, shop name and tagline. */
function brandRow(ctx: C2D, b: Brand, x: number, cy: number, s: number, maxW: number, tag = true, color = b.theme.fg) {
  logoBox(ctx, b, x, cy - s / 2, s);
  const tx = x + s + s * 0.28, w = maxW - (tx - x);
  if (tag && b.tagline.trim()) {
    line(ctx, b.name, tx, cy - s * 0.17, { weight: 800, size: s * 0.46, family: H(b), color, maxW: w });
    ctx.globalAlpha = 0.85; line(ctx, b.tagline, tx, cy + s * 0.24, { weight: 600, size: s * 0.27, color, maxW: w }); ctx.globalAlpha = 1;
  } else line(ctx, b.name, tx, cy, { weight: 800, size: s * 0.46, family: H(b), color, maxW: w });
}
function header(ctx: C2D, b: Brand, x: number, y: number, w: number, h: number, s: number, tag = true) {
  box(ctx, x, y, w, h, b.theme.bg);
  brandRow(ctx, b, x + h * 0.38, y + h / 2, s, w - h * 0.76, tag);
}
/** "0917 123 4567 · Viber · WhatsApp • fb.com/shop": the part before the first "·" in bold. */
function contacts(ctx: C2D, b: Brand, x: number, cy: number, size: number, maxW: number, color = b.theme.fg) {
  const t = b.contacts.trim();
  if (!t) return;
  const i = t.search(/\s[·•|]\s/);
  const first = i > 0 ? t.slice(0, i) : t, rest = i > 0 ? t.slice(i) : '';
  const w1 = line(ctx, first, x, cy, { weight: 800, size, color, maxW });
  if (rest && w1 < maxW) { ctx.globalAlpha = 0.88; line(ctx, rest, x + w1, cy, { weight: 600, size, color, maxW: maxW - w1 }); ctx.globalAlpha = 1; }
}
function footer(ctx: C2D, b: Brand, x: number, y: number, w: number, h: number, size: number, bg = b.theme.bg) {
  box(ctx, x, y, w, h, bg);
  contacts(ctx, b, x + h * 0.66, y + h / 2, size, w - h * 1.32);
}
function chip(ctx: C2D, available: boolean, right: number, cy: number, size: number) {
  const t = available ? 'AVAILABLE' : 'BY ORDER';
  setFont(ctx, 800, size); spacing(ctx, size * 0.06);
  const w = ctx.measureText(t).width + size * 1.4, h = size * 1.6;
  box(ctx, right - w, cy - h / 2, w, h, available ? '#dcf5e3' : '#fff0c7', h / 2);
  line(ctx, t, right - w / 2, cy + 1, { weight: 800, size, color: available ? '#126b33' : '#8a5a00', align: 'center' });
  spacing(ctx, 0);
  return w;
}
function code(ctx: C2D, s: string, x: number, cy: number, size: number, maxW: number) {
  spacing(ctx, size * 0.08);
  line(ctx, s, x, cy, { weight: 700, size, color: GREY, maxW });
  spacing(ctx, 0);
}
function specRows(ctx: C2D, specs: Spec[], x: number, y: number, w: number, size: number, bottom: number) {
  const rowH = size * 1.5;
  let n = 0;
  for (const s of specs) {
    if (y + rowH > bottom + 1) break;
    line(ctx, s.label, x, y + rowH / 2, { weight: 600, size, color: GREY, maxW: w * 0.36 });
    line(ctx, s.value, x + w * 0.38, y + rowH / 2, { weight: 700, size, color: '#14191d', maxW: w * 0.62 });
    box(ctx, x, y + rowH - 2, w, 2, '#edf0f2');
    y += rowH; n++;
  }
  return { y, shown: n };
}

export type Sale = { on: boolean; price: number | null; badge: string; note: string };
export type PriceView = { price: number | null; ask: boolean; sale: Sale };
/** The price (or "Ask for price"); on sale: old price crossed out, then the sale price. Returns the right edge. */
function price(ctx: C2D, b: Brand, p: PriceView, x: number, cy: number, size: number, maxW: number) {
  if (p.ask || p.price == null) return x + line(ctx, 'Ask for price', x, cy, { weight: 800, size: size * 0.62, family: H(b), color: b.theme.ink, maxW });
  let at = x;
  if (p.sale.on && p.sale.price != null && p.sale.price < p.price) {
    const w = line(ctx, peso(p.price), at, cy + size * 0.12, { weight: 700, size: size * 0.45, family: H(b), color: '#8a939b' });
    box(ctx, at - 2, cy + size * 0.12, w + 4, Math.max(2, size * 0.04), '#8a939b');
    at += w + size * 0.18;
    return at + line(ctx, peso(p.sale.price), at, cy, { weight: 800, size, family: H(b), color: b.theme.ink, maxW: maxW - (at - x) });
  }
  return at + line(ctx, peso(p.price), at, cy, { weight: 800, size, family: H(b), color: b.theme.ink, maxW });
}
function saleBadge(ctx: C2D, cx: number, cy: number, r: number, b: Brand, t: string) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-10 * Math.PI / 180);
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = r * 0.2; ctx.shadowOffsetY = r * 0.07;
  ctx.fillStyle = '#e3162b'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  line(ctx, 'SALE', 0, -r * 0.3, { weight: 800, size: r * 0.36, family: H(b), color: '#fff', align: 'center' });
  line(ctx, t || 'SALE', 0, r * 0.2, { weight: 800, size: r * 0.56, family: H(b), color: '#fff', align: 'center', maxW: r * 1.7 });
  ctx.restore();
}
function ribbon(ctx: C2D, b: Brand, t: string, x: number, y: number, size: number, maxW: number) {
  setFont(ctx, 800, size, H(b));
  const s = clip(ctx, t, maxW - size * 1.8);
  const w = ctx.measureText(s).width + size * 1.8, h = size * 1.6;
  ctx.fillStyle = b.theme.acc === '#111111' ? '#ffc928' : b.theme.acc;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - h * 0.3, y + h / 2); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  line(ctx, s, x + size * 0.8, y + h / 2 + 1, { weight: 800, size, family: H(b), color: '#1b1b1b' });
}
function strip(ctx: C2D, b: Brand, t: string, x: number, y: number, w: number, h: number, size: number) {
  box(ctx, x, y, w, h, b.theme.acc === '#111111' ? '#ffc928' : b.theme.acc);
  line(ctx, t, x + h * 0.75, y + h / 2 + 1, { weight: 800, size, color: '#1b1b1b', maxW: w - h * 1.5 });
}

// ------------------------------------------------------------------ 1. specs card --
export const SPECS_LAYOUTS = {
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5', use: 'Facebook feed' },
  square: { w: 1080, h: 1080, label: 'Square 1:1', use: 'Facebook, Viber, Marketplace' },
  landscape: { w: 1200, h: 630, label: 'Landscape', use: 'Link size, Viber, email' },
  story: { w: 1080, h: 1920, label: 'Story 9:16', use: 'Facebook / Messenger story' },
} as const;
export type SpecsLayout = keyof typeof SPECS_LAYOUTS;
export type SpecsCard = { layout: SpecsLayout; item: Item } & PriceView & { ribbon: { on: boolean; text: string }; strip: { on: boolean; text: string } };

export function drawSpecsCard(ctx: C2D, b: Brand, d: SpecsCard) {
  const { w: W, h: Hh } = SPECS_LAYOUTS[d.layout];
  box(ctx, 0, 0, W, Hh, '#ffffff');
  const it = d.item;
  const pv: PriceView = { price: d.price, ask: d.ask, sale: d.sale };
  const saleOn = d.sale.on && !d.ask && d.sale.price != null && d.price != null && d.sale.price < d.price;
  if (d.layout === 'portrait' || d.layout === 'story') {
    const k = d.layout === 'story' ? 1.2 : 1;
    const hdr = d.layout === 'story' ? 170 : 116, ph = d.layout === 'story' ? 820 : 560;
    const ftr = d.layout === 'story' ? 120 : 66, sh = d.strip.on && d.strip.text.trim() ? 58 * k : 0, prh = 112 * k, pad = 52 * k;
    header(ctx, b, 0, 0, W, hdr, 64 * k);
    box(ctx, 0, hdr, W, ph, b.theme.soft);
    picture(ctx, it.photo, 0, hdr, W, ph, 'contain', 30 * k);
    if (saleOn) saleBadge(ctx, W - 28 * k - 85 * k, hdr + 28 * k + 85 * k, 85 * k, b, d.sale.badge);
    if (d.ribbon.on && d.ribbon.text.trim()) ribbon(ctx, b, d.ribbon.text, 0, hdr + 28 * k, 30 * k, W * 0.8);
    let y = hdr + ph + 30 * k;
    const priceTop = Hh - ftr - sh - prh;
    const cw = chip(ctx, it.available, W - pad, y + 16 * k, 22 * k);
    code(ctx, it.code, pad, y + 16 * k, 24 * k, W - pad * 2 - cw - 20);
    y = text(ctx, it.name, pad, y + 44 * k, { weight: 800, size: 54 * k, min: 36 * k, family: H(b), maxW: W - pad * 2, maxLines: 2, color: b.theme.ink, lh: 1.04 });
    specRows(ctx, it.specs, pad, y + 12 * k, W - pad * 2, 27 * k, priceTop - 14 * k);
    box(ctx, 0, priceTop, W, prh, b.theme.soft);
    const end = price(ctx, b, pv, pad, priceTop + prh / 2, 72 * k, W - pad * 2);
    if (saleOn && d.sale.note.trim()) line(ctx, d.sale.note, end + 20 * k, priceTop + prh / 2 + 10 * k, { weight: 600, size: 22 * k, color: GREY, maxW: W - end - pad });
    if (sh) strip(ctx, b, d.strip.text, 0, Hh - ftr - sh, W, sh, 28 * k);
    footer(ctx, b, 0, Hh - ftr, W, ftr, 25 * k);
  } else if (d.layout === 'square') {
    const hdr = 112, ftr = 64, sh = d.strip.on && d.strip.text.trim() ? 54 : 0, pw = 470;
    header(ctx, b, 0, 0, W, hdr, 60);
    const top = hdr, bottom = Hh - ftr - sh;
    box(ctx, 0, top, pw, bottom - top, b.theme.soft);
    picture(ctx, it.photo, 0, top, pw, bottom - top, 'contain', 28);
    if (saleOn) saleBadge(ctx, pw - 24 - 70, top + 24 + 70, 70, b, d.sale.badge);
    if (d.ribbon.on && d.ribbon.text.trim()) ribbon(ctx, b, d.ribbon.text, 0, top + 24, 26, pw - 20);
    const x = pw + 40, cw = W - x - 40;
    let y = top + 34;
    const chw = chip(ctx, it.available, W - 40, y + 14, 20);
    code(ctx, it.code, x, y + 14, 22, cw - chw - 16);
    y = text(ctx, it.name, x, y + 42, { weight: 800, size: 52, min: 34, family: H(b), maxW: cw, maxLines: 3, color: b.theme.ink, lh: 1.04 });
    const note = saleOn && d.sale.note.trim();
    const priceY = bottom - (note ? 92 : 64);
    specRows(ctx, it.specs, x, y + 14, cw, 27, priceY - 56);
    price(ctx, b, pv, x, priceY, 84, cw);
    if (note) line(ctx, d.sale.note, x, priceY + 58, { weight: 600, size: 22, color: GREY, maxW: cw });
    if (sh) strip(ctx, b, d.strip.text, 0, bottom, W, sh, 26);
    footer(ctx, b, 0, Hh - ftr, W, ftr, 23);
  } else {
    const pw = 500, x0 = pw, cw0 = W - pw, hdr = 78, ftr = 52, sh = d.strip.on && d.strip.text.trim() ? 42 : 0;
    box(ctx, 0, 0, pw, Hh, b.theme.soft);
    picture(ctx, it.photo, 0, 0, pw, Hh, 'contain', 26);
    if (saleOn) saleBadge(ctx, pw - 22 - 60, 22 + 60, 60, b, d.sale.badge);
    if (d.ribbon.on && d.ribbon.text.trim()) ribbon(ctx, b, d.ribbon.text, 0, 24, 22, pw - 20);
    header(ctx, b, x0, 0, cw0, hdr, 46, false);
    const x = x0 + 36, cw = cw0 - 72, bottom = Hh - ftr - sh;
    let y = hdr + 20;
    const chw = chip(ctx, it.available, W - 36, y + 12, 17);
    code(ctx, it.code, x, y + 12, 19, cw - chw - 12);
    y = text(ctx, it.name, x, y + 32, { weight: 800, size: 38, min: 26, family: H(b), maxW: cw, maxLines: 2, color: b.theme.ink, lh: 1.04 });
    const priceY = bottom - 36;
    specRows(ctx, it.specs, x, y + 8, cw, 20, priceY - 36);
    const end = price(ctx, b, pv, x, priceY, 50, cw);
    if (saleOn && d.sale.note.trim()) line(ctx, d.sale.note, end + 14, priceY + 8, { weight: 600, size: 17, color: GREY, maxW: W - end - 50 });
    if (sh) strip(ctx, b, d.strip.text, x0, bottom, cw0, sh, 20);
    footer(ctx, b, x0, Hh - ftr, cw0, ftr, 19);
  }
}

// ------------------------------------------------------------------ 2. price lists --
export const PRICELIST = { photos: { w: 1080, h: 1350, max: 8 }, a4: { w: 1240, h: 1754, max: 60 } } as const;
export type ListRow = { code: string; name: string; sub: string; price: number | null; group: string; photo: Pic | null };
export type PriceList = { kind: 'photos' | 'a4'; kicker: string; title: string; note: string; rows: ListRow[]; qr: string | null };

/** Draws the list; returns how many rows fitted. */
export function drawPriceList(ctx: C2D, b: Brand, d: PriceList): number {
  const { w: W, h: Hh } = PRICELIST[d.kind];
  box(ctx, 0, 0, W, Hh, '#ffffff');
  if (d.kind === 'photos') {
    header(ctx, b, 0, 0, W, 112, 60);
    let y = 112 + 30;
    spacing(ctx, 3); y = text(ctx, d.kicker.toUpperCase(), 48, y, { weight: 800, size: 24, maxW: W - 96, color: GREY }); spacing(ctx, 0);
    y = text(ctx, d.title, 48, y + 4, { weight: 800, size: 72, min: 44, family: H(b), maxW: W - 96, maxLines: 1, color: b.theme.ink });
    const ftr = 64, noteH = d.note.trim() ? 52 : 0, bottom = Hh - ftr - noteH - 10;
    const rows = d.rows.slice(0, PRICELIST.photos.max);
    const rh = Math.min(126, (bottom - y - 14) / Math.max(1, rows.length));
    y += 14;
    const th = Math.min(104, rh - 18);
    rows.forEach((r) => {
      box(ctx, 48, y + (rh - th) / 2, th, th, b.theme.soft, 12);
      picture(ctx, r.photo, 48, y + (rh - th) / 2, th, th, 'contain', 6);
      setFont(ctx, 800, 46, H(b));
      const pw = r.price == null ? 0 : ctx.measureText(peso(r.price)).width;
      const tx = 48 + th + 22, tw = W - 48 - tx - pw - 24;
      line(ctx, r.name, tx, y + rh / 2 - (r.sub ? 14 : 0), { weight: 800, size: 28, color: '#14191d', maxW: tw });
      if (r.sub) line(ctx, r.sub, tx, y + rh / 2 + 22, { weight: 600, size: 21, color: GREY, maxW: tw });
      line(ctx, r.price == null ? 'Ask' : peso(r.price), W - 48, y + rh / 2, { weight: 800, size: r.price == null ? 32 : 46, family: H(b), color: b.theme.ink, align: 'right' });
      box(ctx, 48, y + rh - 2, W - 96, 2, '#edf0f2');
      y += rh;
    });
    if (noteH) { box(ctx, 0, Hh - ftr - noteH, W, noteH, b.theme.soft); line(ctx, d.note, 48, Hh - ftr - noteH / 2, { weight: 600, size: 22, color: '#3a434b', maxW: W - 96 }); }
    footer(ctx, b, 0, Hh - ftr, W, ftr, 24);
    return rows.length;
  }
  // printable A4 (150 dpi)
  const M = 90;
  logoBox(ctx, b, M, 70, 84, false);
  line(ctx, b.name, M + 108, 70 + 30, { weight: 800, size: 40, family: H(b), color: b.theme.bg === '#ffffff' ? '#111' : b.theme.bg, maxW: 560 });
  if (b.tagline.trim()) line(ctx, b.tagline, M + 108, 70 + 66, { weight: 600, size: 22, color: '#3a434b', maxW: 560 });
  spacing(ctx, 3); line(ctx, d.kicker.toUpperCase(), W - M, 82, { weight: 800, size: 22, color: GREY, align: 'right', maxW: 420 }); spacing(ctx, 0);
  line(ctx, d.title, W - M, 124, { weight: 800, size: 56, family: H(b), color: b.theme.ink, align: 'right', maxW: 460 });
  box(ctx, M, 178, W - M * 2, 6, b.theme.bg);
  const footTop = Hh - 60 - 190;
  let y = 206;
  const rowH = 36;
  box(ctx, M, y, W - M * 2, 40, b.theme.bg);
  spacing(ctx, 1.5);
  line(ctx, 'CODE', M + 12, y + 20, { weight: 800, size: 19, color: b.theme.fg });
  line(ctx, 'ITEM', M + 200, y + 20, { weight: 800, size: 19, color: b.theme.fg });
  line(ctx, 'PRICE', W - M - 12, y + 20, { weight: 800, size: 19, color: b.theme.fg, align: 'right' });
  spacing(ctx, 0);
  y += 40;
  let shown = 0, lastGroup: string | null = null;
  for (const r of d.rows) {
    const needGroup = r.group !== lastGroup && r.group.trim() !== '';
    if (y + rowH + (needGroup ? 48 : 0) > footTop) break;
    if (needGroup) {
      line(ctx, r.group, M + 4, y + 30, { weight: 800, size: 28, family: H(b), color: b.theme.ink, maxW: W - M * 2 });
      box(ctx, M, y + 46, W - M * 2, 3, b.theme.ink);
      y += 50;
    }
    lastGroup = r.group;
    line(ctx, r.code, M + 12, y + rowH / 2, { weight: 600, size: 21, color: GREY, maxW: 176 });
    line(ctx, r.sub ? `${r.name} — ${r.sub}` : r.name, M + 200, y + rowH / 2, { weight: 600, size: 22, color: '#14191d', maxW: W - M * 2 - 200 - 190 });
    line(ctx, r.price == null ? 'Ask' : peso(r.price), W - M - 12, y + rowH / 2, { weight: 800, size: 23, color: '#14191d', align: 'right' });
    box(ctx, M, y + rowH - 1.5, W - M * 2, 1.5, LINE);
    y += rowH; shown++;
  }
  // footer: note, contacts, shop link; QR on the right (optional)
  const qrS = d.qr ? 170 : 0;
  box(ctx, M, footTop + 20, W - M * 2, 3, LINE);
  const fw = W - M * 2 - (qrS ? qrS + 30 : 0);
  let fy = footTop + 60;
  if (d.note.trim()) { text(ctx, d.note, M, fy - 16, { weight: 600, size: 22, color: '#3a434b', maxW: fw, maxLines: 2 }); fy += 62; }
  contacts(ctx, b, M, fy, 24, fw, '#14191d');
  if (d.qr) {
    drawQr(ctx, d.qr, W - M - qrS, footTop + 40, qrS, '#0b2236');
    line(ctx, 'Scan to see our shop', W - M - qrS / 2, footTop + 40 + qrS + 20, { weight: 600, size: 18, color: '#3a434b', align: 'center' });
  }
  return shown;
}
function drawQr(ctx: C2D, url: string, x: number, y: number, s: number, color: string) {
  try {
    const q = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const n = q.modules.size, cell = s / n;
    box(ctx, x, y, s, s, '#ffffff');
    ctx.fillStyle = color;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) ctx.fillRect(x + c * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell));
  } catch { /* no QR */ }
}

// ------------------------------------------------------------------ 3. banners --
export const BANNER_SIZES = { square: { w: 1080, h: 1080, label: 'Square 1:1 (Facebook post)' }, wide: { w: 1600, h: 600, label: 'Wide (Facebook cover, promotion)' } } as const;
export type BannerSize = keyof typeof BANNER_SIZES;
export const BANNER_TEMPLATES = { photos: 'With product photos', big: 'Big number (discount)', notice: 'Announcement (text only)' } as const;
export type BannerTemplate = keyof typeof BANNER_TEMPLATES;
export type Banner = { template: BannerTemplate; size: BannerSize; kicker: string; headline: string; sub: string; small: string; photos: (Pic | null)[] };

export function drawBanner(ctx: C2D, b: Brand, d: Banner) {
  const { w: W, h: Hh } = BANNER_SIZES[d.size];
  const t = b.theme, photos = d.photos.filter(Boolean) as Pic[];
  box(ctx, 0, 0, W, Hh, t.bg);
  const acc = t.acc === '#111111' ? t.fg : t.acc;
  const block = (ctx: C2D, x: number, y: number, w: number, k: number, maxH: number) => {
    spacing(ctx, 3 * k);
    let yy = text(ctx, d.kicker.toUpperCase(), x, y, { weight: 800, size: 34 * k, maxW: w, color: acc }); spacing(ctx, 0);
    const big = d.template === 'big';
    yy = text(ctx, d.headline, x, yy + 6 * k, { weight: 800, size: (big ? 220 : 140) * k, min: 48 * k, family: H(b), maxW: w, maxLines: big ? 2 : 2, color: big ? acc : t.fg, lh: 0.95 });
    yy = text(ctx, d.sub, x, yy + 14 * k, { weight: 700, size: 40 * k, min: 26 * k, maxW: w, maxLines: 2, color: t.fg });
    ctx.globalAlpha = 0.85; yy = text(ctx, d.small, x, yy + 12 * k, { weight: 600, size: 27 * k, min: 20 * k, maxW: w, maxLines: 2, color: t.fg }); ctx.globalAlpha = 1;
    return Math.min(yy, y + maxH);
  };
  if (d.size === 'wide') {
    const lw = 500;
    box(ctx, 0, 0, lw, Hh, 'rgba(0,0,0,.22)');
    brandRow(ctx, b, 46, 46 + 35, 70, lw - 92);
    const c = (b.contacts.split(/\s[•|]\s/)[0] ?? '').split(/\s·\s/);
    line(ctx, c[0] ?? '', 46, Hh - 46 - 50, { weight: 800, size: 30, maxW: lw - 92, color: t.fg });
    if (c.length > 1) { ctx.globalAlpha = 0.85; line(ctx, c.slice(1).join(' · '), 46, Hh - 46 - 12, { weight: 600, size: 24, maxW: lw - 92, color: t.fg }); ctx.globalAlpha = 1; }
    const showPic = d.template !== 'notice' && photos.length > 0;
    const pw = showPic ? 420 : 0;
    if (showPic) { box(ctx, W - pw, 40, pw - 40, Hh - 80, '#ffffff', 24); picture(ctx, photos[0], W - pw, 40, pw - 40, Hh - 80, 'contain', 18); }
    const tx = lw + 56, tw = W - tx - 56 - pw;
    // centre the text block vertically: measure by drawing off-screen first
    const yEnd = measure(ctx, (m) => block(m, tx, 0, tw, 0.85, Hh));
    block(ctx, tx, Math.max(40, (Hh - yEnd) / 2), tw, 0.85, Hh);
    return;
  }
  header(ctx, b, 0, 0, W, 112, 60);
  box(ctx, 0, 0, W, 112, 'rgba(0,0,0,0)');
  const ftr = 64;
  box(ctx, 0, Hh - ftr, W, ftr, 'rgba(0,0,0,.25)');
  contacts(ctx, b, 44, Hh - ftr / 2, 25, W - 88);
  if (d.template === 'photos') {
    const y = block(ctx, 56, 130, W - 112, 1, 420);
    const n = Math.max(1, Math.min(3, photos.length));
    if (photos.length) {
      const gap = 22, pw = (W - 112 - gap * (n - 1)) / n, room = Hh - ftr - 36 - (y + 36), ph = Math.min(room, pw * 1.2), py = y + 36 + (room - ph) / 2;
      photos.slice(0, 3).forEach((p, i) => { box(ctx, 56 + i * (pw + gap), py, pw, ph, '#ffffff', 22); picture(ctx, p, 56 + i * (pw + gap), py, pw, ph, 'contain', 18); });
    }
  } else if (d.template === 'big') {
    const pic = photos[0];
    const tw = pic ? W * 0.56 : W - 112;
    const yEnd = measure(ctx, (m) => block(m, 56, 0, tw, 1, Hh));
    block(ctx, 56, 112 + Math.max(20, (Hh - 112 - ftr - yEnd) / 2), tw, 1, Hh);
    if (pic) { const x = 56 + tw + 30, pw = W - x - 40, ph = Math.min(pw * 1.15, Hh - ftr - 192), py = 112 + (Hh - 112 - ftr - ph) / 2; box(ctx, x, py, pw, ph, '#ffffff', 26); picture(ctx, pic, x, py, pw, ph, 'contain', 22); }
  } else {
    const yEnd = measure(ctx, (m) => block(m, 56, 0, W - 112, 1, Hh));
    block(ctx, 56, 112 + Math.max(20, (Hh - 112 - ftr - yEnd) / 2), W - 112, 1, Hh);
  }
}
/** Where a drawing would end (drawn on a scratch canvas of the same size, never on the picture). */
function measure(ctx: C2D, draw: (scratch: C2D) => number) {
  const c = document.createElement('canvas'); c.width = ctx.canvas.width; c.height = ctx.canvas.height;
  return draw(c.getContext('2d')!);
}

// ------------------------------------------------------------------ 4. new arrivals / back in stock --
export const COLLAGE = { 4: { w: 1080, h: 1080, cols: 2, rows: 2 }, 6: { w: 1080, h: 1350, cols: 2, rows: 3 } } as const;
export type Collage = { count: 4 | 6; kicker: string; title: string; showPrices: boolean; items: { name: string; price: number | null; photo: Pic | null }[] };

export function drawCollage(ctx: C2D, b: Brand, d: Collage) {
  const g = COLLAGE[d.count], W = g.w, Hh = g.h;
  box(ctx, 0, 0, W, Hh, '#ffffff');
  const t = b.theme, acc = t.acc === '#111111' ? t.fg : t.acc;
  box(ctx, 0, 0, W, 300, t.bg);
  brandRow(ctx, b, 44, 56, 60, W - 88);
  spacing(ctx, 3); let y = text(ctx, d.kicker.toUpperCase(), 48, 124, { weight: 800, size: 30, maxW: W - 96, color: acc }); spacing(ctx, 0);
  y = text(ctx, d.title, 48, y + 4, { weight: 800, size: 96, min: 50, family: H(b), maxW: W - 96, maxLines: 1, color: t.fg, lh: 1 });
  const top = Math.max(y + 26, 260);
  box(ctx, 0, 0, W, top, t.bg);
  // redraw the title band on the final height
  brandRow(ctx, b, 44, 56, 60, W - 88);
  spacing(ctx, 3); y = text(ctx, d.kicker.toUpperCase(), 48, 124, { weight: 800, size: 30, maxW: W - 96, color: acc }); spacing(ctx, 0);
  text(ctx, d.title, 48, y + 4, { weight: 800, size: 96, min: 50, family: H(b), maxW: W - 96, maxLines: 1, color: t.fg, lh: 1 });
  const ftr = 64, gap = 18, x0 = 48, y0 = top + 24;
  const rows = Math.max(1, Math.min(g.rows, Math.ceil(d.items.slice(0, d.count).length / g.cols)));
  const cw = (W - x0 * 2 - gap * (g.cols - 1)) / g.cols, ch = (Hh - ftr - 24 - y0 - gap * (rows - 1)) / rows;
  d.items.slice(0, d.count).forEach((it, i) => {
    const x = x0 + (i % g.cols) * (cw + gap), yy = y0 + Math.floor(i / g.cols) * (ch + gap);
    box(ctx, x, yy, cw, ch, t.soft, 18);
    const textH = d.showPrices && it.price != null ? 90 : 50;
    picture(ctx, it.photo, x, yy, cw, ch - textH, 'contain', 14);
    if (!it.photo) line(ctx, 'No photo', x + cw / 2, yy + (ch - textH) / 2, { weight: 600, size: 22, color: '#9aa4ad', align: 'center' });
    line(ctx, it.name, x + 16, yy + ch - textH + 22, { weight: 800, size: 23, color: '#14191d', maxW: cw - 32 });
    if (d.showPrices && it.price != null) line(ctx, peso(it.price), x + 16, yy + ch - 30, { weight: 800, size: 38, family: H(b), color: t.ink });
  });
  footer(ctx, b, 0, Hh - ftr, W, ftr, 24);
}

export { BODY };
