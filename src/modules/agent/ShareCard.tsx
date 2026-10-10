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
