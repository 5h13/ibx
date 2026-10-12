'use client';
// Build 102 — "Share as image": the agent's phone draws a 1080 × 1080 product card
// (store logo, name and colours; photo; name; specification; the price picked in the
// product pop-up, valid 7 days; the agent's name and phone) and opens the phone's own
// share menu (Messenger, Viber, Gallery…). On a computer the image downloads.
// Nothing is published: no link, no public page. Capital, markup and tiers are never drawn.
import { useState } from 'react';

export type ShareBrand = { name: string; logo: string | null; header: string; headerEnd: string; headerText: string };
export type ShareAgent = { name: string; phone: string | null };
export type ShareItem = { item_code: string; item_name: string; unit: string; specification: string | null; photo: string | null; price: number };

const S = 1080;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const src = URL.createObjectURL(await res.blob());
    return await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  } catch { return null; }
}

function lines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= width) { cur = t; continue; }
    if (cur) out.push(cur);
    cur = w;
    if (out.length === max) break;
  }
  if (out.length < max && cur) out.push(cur);
  const used = out.join(' ').split(' ').length;
  if (used < words.length && out.length) {          // more text than fits: end the last line with …
    let last = out[out.length - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    out[out.length - 1] = `${last.trimEnd()}…`;
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Build 105 — the store logo as a faint watermark over the product photo. The logo's own background (the flat colour
// around its edges: PILI's light blue, ISHABELLA's navy, ATON's gold frame) is removed so only the artwork shows;
// near-white artwork is tinted slate so it does not vanish on a white photo. Cropped to the artwork.
function watermarkFrom(logo: HTMLImageElement): HTMLCanvasElement | null {
  const k = Math.min(1, 600 / Math.max(logo.width, logo.height));
  const w = Math.max(1, Math.round(logo.width * k)), h = Math.max(1, Math.round(logo.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(logo, 0, 0, w, h);
  let img: ImageData;
  try { img = x.getImageData(0, 0, w, h); } catch { return null; }
  const d = img.data, edge: number[][] = [];
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (xx >= ring && yy >= ring && xx < w - ring && yy < h - ring) continue;
    const i = (yy * w + xx) * 4; if (d[i + 3] > 200) edge.push([d[i], d[i + 1], d[i + 2]]);
  }
  const transparentBg = edge.length < (2 * (w + h) * ring) * 0.3;     // already a cut-out logo
  const med = (n: number) => { const v = edge.map((p) => p[n]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
  const bg = transparentBg ? null : [med(0), med(1), med(2)];
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let a = d[i + 3] / 255;
    if (bg) { const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]); a *= Math.min(1, Math.max(0, (dist - 45) / 50)); }
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (lum > 200) { const t = Math.min(1, (lum - 200) / 40); d[i] = d[i] * (1 - t) + 120 * t; d[i + 1] = d[i + 1] * (1 - t) + 135 * t; d[i + 2] = d[i + 2] * (1 - t) + 155 * t; }
    d[i + 3] = Math.round(a * 255);
    if (d[i + 3] > 30) { const px = p % w, py = (p / w) | 0; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
  }
  if (maxX < 0) return null;
  // drop small stray specks (e.g. a frame's shaded corner): keep shapes at least 5 % the size of the biggest
  const lab = new Int32Array(w * h), sizes: number[] = [0];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (lab[p0] || d[p0 * 4 + 3] <= 30) continue;
    const id = sizes.length; let n = 0; const st = [p0]; lab[p0] = id;
    while (st.length) {
      const q = st.pop()!; n++;
      const qx = q % w, qy = (q / w) | 0;
      for (const [nx, ny] of [[qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx; if (!lab[r] && d[r * 4 + 3] > 30) { lab[r] = id; st.push(r); }
      }
    }
    sizes.push(n);
  }
  const big = Math.max(...sizes);
  minX = w; minY = h; maxX = -1; maxY = -1;
  for (let p0 = 0; p0 < w * h; p0++) {
    const id = lab[p0];
    if (id && sizes[id] < big * 0.05) { d[p0 * 4 + 3] = 0; continue; }
    if (id) { const px = p0 % w, py = (p0 / w) | 0; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
  }
  if (maxX < 0) return null;
  x.putImageData(img, 0, 0);
  const out = document.createElement('canvas'); out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function drawWatermark(ctx: CanvasRenderingContext2D, wm: HTMLCanvasElement, S: number, top: number, height: number) {
  const box = Math.min(height, S) * 0.62, k = Math.min(box / wm.width, box / wm.height);
  const ww = wm.width * k, wh = wm.height * k, wx = (S - ww) / 2, wy = top + (height - wh) / 2;
  // a white copy, "screened" on: lightens the product's dark parts (invisible on white)
  const sil = document.createElement('canvas'); sil.width = Math.ceil(ww); sil.height = Math.ceil(wh);
  const sc = sil.getContext('2d')!; sc.drawImage(wm, 0, 0, ww, wh); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#ffffff'; sc.fillRect(0, 0, ww, wh);
  ctx.save(); ctx.globalAlpha = 0.22; ctx.globalCompositeOperation = 'screen'; ctx.drawImage(sil, wx, wy); ctx.restore();
  // the artwork in its own colours at 18 %: shows on the white background
  ctx.save(); ctx.globalAlpha = 0.18; ctx.drawImage(wm, wx, wy, ww, wh); ctx.restore();
}

export const validUntil = (days = 7) =>
  new Date(Date.now() + days * 86400000).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });

export async function drawShareCard(brand: ShareBrand, agent: ShareAgent, item: ShareItem): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  const [logo, photo] = await Promise.all([loadImage(brand.logo), loadImage(item.photo)]);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);

  // header (slim): the store the agent is selling from — logo, name, colours
  const HB = 112;
  const g = ctx.createLinearGradient(0, 0, S, 0); g.addColorStop(0, brand.header); g.addColorStop(1, brand.headerEnd);
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, HB);
  let x = 40;
  if (logo) {
    ctx.save(); roundRect(ctx, 28, 16, 80, 80, 14); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
    const k = Math.min(70 / logo.width, 70 / logo.height);
    ctx.drawImage(logo, 68 - (logo.width * k) / 2, 56 - (logo.height * k) / 2, logo.width * k, logo.height * k);
    ctx.restore(); x = 128;
  }
  ctx.fillStyle = brand.headerText; ctx.textBaseline = 'middle';
  ctx.font = `600 28px ${FONT}`; ctx.textAlign = 'right';
  ctx.globalAlpha = 0.8; ctx.fillText(item.item_code, S - 36, HB / 2); ctx.globalAlpha = 1;
  const codeW = ctx.measureText(item.item_code).width;
  ctx.textAlign = 'left';
  const nameW = S - x - codeW - 64;
  let fs = 42; ctx.font = `700 ${fs}px ${FONT}`;
  while (fs > 30 && ctx.measureText(brand.name).width > nameW) { fs -= 2; ctx.font = `700 ${fs}px ${FONT}`; }   // long store names: smaller before cutting
  ctx.fillText(lines(ctx, brand.name, nameW, 1)[0] ?? '', x, HB / 2);
  ctx.textBaseline = 'alphabetic';

  // bottom block, measured first so the photo gets all the space left
  const FOOT = 64, PRICE = 92;
  ctx.font = `700 46px ${FONT}`;
  const nameLines = lines(ctx, item.item_name, S - 80, 2);
  const spec = (item.specification ?? '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean).join(' · ');
  ctx.font = `400 30px ${FONT}`;
  const specLine = spec ? lines(ctx, spec, S - 80, 1)[0] : '';
  const textH = 14 + nameLines.length * 54 + (specLine ? 38 : 0);
  const pTop = HB, pH = S - HB - FOOT - PRICE - textH;

  // photo: as large as it fits, whole product visible
  if (photo) {
    const k = Math.min((S - 16) / photo.width, (pH - 8) / photo.height);
    ctx.drawImage(photo, (S - photo.width * k) / 2, pTop + (pH - photo.height * k) / 2, photo.width * k, photo.height * k);
    const wm = logo ? watermarkFrom(logo) : null;   // Build 105: faint store logo across the product
    if (wm) drawWatermark(ctx, wm, S, pTop, pH);
  } else {
    ctx.fillStyle = '#f4f4f2'; ctx.fillRect(0, pTop, S, pH);
    ctx.fillStyle = '#9a9a94'; ctx.font = `400 34px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('No photo', S / 2, pTop + pH / 2); ctx.textAlign = 'left';
  }

  // name, specification
  let y = pTop + pH + 14 + 42;
  ctx.fillStyle = '#1f2328'; ctx.font = `700 46px ${FONT}`;
  for (const l of nameLines) { ctx.fillText(l, 40, y); y += 54; }
  if (specLine) { ctx.fillStyle = '#5f5e5a'; ctx.font = `400 30px ${FONT}`; ctx.fillText(specLine, 40, y - 14); }

  // price + validity
  const py = S - FOOT - 22;
  const price = `₱${item.price.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  ctx.fillStyle = '#14213d'; ctx.font = `800 72px ${FONT}`; ctx.fillText(price, 40, py);
  const pw = ctx.measureText(price).width;
  ctx.fillStyle = '#5f5e5a'; ctx.font = `400 28px ${FONT}`; ctx.fillText(`per ${item.unit}`, 40 + pw + 14, py);
  const v = `Valid until ${validUntil()}`;
  ctx.font = `600 26px ${FONT}`;
  const vw = ctx.measureText(v).width + 32;
  roundRect(ctx, S - 40 - vw, py - 40, vw, 50, 10); ctx.fillStyle = '#faeeda'; ctx.fill();
  ctx.fillStyle = '#854f0b'; ctx.fillText(v, S - 40 - vw + 16, py - 6);

  // footer: the agent
  ctx.fillStyle = '#e4e2da'; ctx.fillRect(0, S - FOOT, S, 2);
  ctx.fillStyle = '#444441'; ctx.font = `500 30px ${FONT}`;
  ctx.fillText(lines(ctx, `${agent.name}, sales agent`, agent.phone ? 620 : S - 80, 1)[0] ?? '', 40, S - 22);
  if (agent.phone) { ctx.textAlign = 'right'; ctx.fillText(agent.phone, S - 40, S - 22); ctx.textAlign = 'left'; }

  return await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Could not make the image.'))), 'image/jpeg', 0.9));
}

export function ShareImageButton({ brand, agent, item }: { brand: ShareBrand; agent: ShareAgent; item: ShareItem | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async () => {
    if (!item) return;
    setBusy(true); setMsg('');
    try {
      const blob = await drawShareCard(brand, agent, item);
      const file = new File([blob], `${item.item_code.replace(/[^\w-]+/g, '_')}.jpg`, { type: 'image/jpeg' });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title: item.item_name }); }
        catch (e) { if ((e as Error)?.name !== 'AbortError') throw e; }
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setMsg('Image saved. Attach it to your message.');
      }
    } catch (e) { setMsg((e as Error)?.message || 'Could not share the image.'); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <button type="button" className="button-secondary w-full" disabled={busy || !item} onClick={go}>
        {busy ? 'Making the image…' : 'Share as image'}
      </button>
      {!item && <p className="mt-1 text-xs text-slate-500">This item has no price yet.</p>}
      {msg && <p className="mt-1 text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
