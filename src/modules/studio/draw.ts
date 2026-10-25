// Build 11 (Studio): small canvas helpers — text that fits, rounded boxes, pictures that fit a box.
import { BODY } from './fonts';

export type C2D = CanvasRenderingContext2D;
export type Pic = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export function setFont(ctx: C2D, weight: number, size: number, family = BODY) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
}

export function rr(ctx: C2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k); ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k); ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
export function box(ctx: C2D, x: number, y: number, w: number, h: number, color: string, r = 0) {
  ctx.fillStyle = color;
  if (r) { rr(ctx, x, y, w, h, r); ctx.fill(); } else ctx.fillRect(x, y, w, h);
}

/** Words into lines no wider than maxW (a very long word is cut). */
export function wrap(ctx: C2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width <= maxW) { line = t; continue; }
      if (line) out.push(line);
      if (ctx.measureText(word).width <= maxW) { line = word; continue; }
      let part = '';
      for (const ch of word) { if (ctx.measureText(part + ch).width > maxW && part) { out.push(part); part = ch; } else part += ch; }
      line = part;
    }
    out.push(line);
  }
  return out;
}

/** Cuts a line to maxW with "…". */
export function clip(ctx: C2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** The largest size (from size down to min) at which the text fits in maxLines; the last line is cut with "…". */
export function fit(ctx: C2D, text: string, o: { weight: number; size: number; min?: number; family?: string; maxW: number; maxLines: number }) {
  const min = o.min ?? Math.round(o.size * 0.6);
  let size = o.size, lines: string[] = [];
  for (; size >= min; size -= Math.max(1, Math.round(size * 0.04))) {
    setFont(ctx, o.weight, size, o.family);
    lines = wrap(ctx, text, o.maxW);
    if (lines.length <= o.maxLines) return { size, lines };
  }
  size = min; setFont(ctx, o.weight, size, o.family);
  lines = wrap(ctx, text, o.maxW);
  if (lines.length > o.maxLines) { lines = lines.slice(0, o.maxLines); lines[o.maxLines - 1] = clip(ctx, lines[o.maxLines - 1] + ' …', o.maxW); }
  return { size, lines };
}

/** Draws fitted text from the top (y = top of the first line). Returns the y below the text. */
export function text(ctx: C2D, s: string, x: number, y: number, o: { weight: number; size: number; min?: number; family?: string; maxW: number; maxLines?: number; color: string; lh?: number; align?: CanvasTextAlign }) {
  if (!s?.trim()) return y;
  const f = fit(ctx, s, { ...o, maxLines: o.maxLines ?? 1 });
  ctx.fillStyle = o.color; ctx.textBaseline = 'top'; ctx.textAlign = o.align ?? 'left';
  const lh = f.size * (o.lh ?? 1.12);
  f.lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  ctx.textAlign = 'left';
  return y + f.lines.length * lh;
}

/** One line of text, vertically centred on cy. Returns its width. */
export function line(ctx: C2D, s: string, x: number, cy: number, o: { weight: number; size: number; family?: string; color: string; maxW?: number; align?: CanvasTextAlign }) {
  setFont(ctx, o.weight, o.size, o.family);
  const t = o.maxW ? clip(ctx, s, o.maxW) : s;
  ctx.fillStyle = o.color; ctx.textBaseline = 'middle'; ctx.textAlign = o.align ?? 'left';
  ctx.fillText(t, x, cy);
  ctx.textAlign = 'left';
  return ctx.measureText(t).width;
}

/** A picture inside a box, whole (contain) or filling it (cover). */
export function picture(ctx: C2D, img: Pic | null | undefined, x: number, y: number, w: number, h: number, mode: 'contain' | 'cover' = 'contain', pad = 0) {
  if (!img) return;
  const iw = img.width, ih = img.height;
  if (!iw || !ih) return;
  const bw = w - pad * 2, bh = h - pad * 2;
  const s = mode === 'contain' ? Math.min(bw / iw, bh / ih) : Math.max(bw / iw, bh / ih);
  const dw = iw * s, dh = ih * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + pad + (bw - dw) / 2, y + pad + (bh - dh) / 2, dw, dh);
  ctx.restore();
}

/** Loads a picture for the canvas without "tainting" it (fetch → bitmap), or null. */
export async function loadPic(url: string | null | undefined): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch { return null; }
}
