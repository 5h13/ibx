'use client';
// Build 12 — photo touch-up, ported from the owner's 5H13studio app (v1.5.1), without OCR, the in-app camera, text
// badges, the 5H13 stamp and per-store logos (the shop stamps the store logo itself on upload). On the phone: clean the
// background (remove it, tap away a colour area, erase / restore brush, undo), put the product on a studio backdrop
// with a soft floor shadow, move / size / turn it (drag, two-finger pinch, sliders), and get a square 1080 × 1080 JPEG.
// Used by the product page (the result becomes that product photo) and by the Studio (used in a promo picture only).
// Build 12.1: "Remove background" uses a small AI model on the phone (aiCutout.ts); the colour-based remover below
// (5H13studio v1.5.1) stays as the fallback (offline / download failed) and as "Simple remover". Two fingers: in Move
// they size and turn the product; in the cutout tools they zoom and pan the view (for fine work). Size steps 0.5×–2×.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { aiMask, aiLoaded } from './aiCutout';

const OUT = 1080;        // the square result
const MAX_DIM = 1200;    // the photo is worked on at this size at most (keeps the phone fast)
const UNDO_LIMIT = 6;
const AUTO_KEY = 'studio.autoStrip';
type Tool = 'move' | 'magic' | 'erase' | 'restore';
export type Backdrop = 'original' | 'white' | 'stone' | 'podium' | 'pastel' | 'shop' | 'custom';
const BACKDROPS: { key: Backdrop; label: string; swatch: string }[] = [
  { key: 'original', label: 'Photo as taken', swatch: 'linear-gradient(135deg,#9aa4ad,#e2e8f0)' },
  { key: 'white', label: 'Studio white', swatch: '#ffffff' },
  { key: 'stone', label: 'Warm stone', swatch: 'linear-gradient(#fafaf9,#d6d3d1)' },
  { key: 'podium', label: 'Dark podium', swatch: 'radial-gradient(#334155,#0b1120)' },
  { key: 'pastel', label: 'Pastel', swatch: 'linear-gradient(135deg,#e0f2fe,#fce7f3,#fef3c7)' },
  { key: 'shop', label: 'Shop colour', swatch: '' },
  { key: 'custom', label: 'Own colour', swatch: '' },
];
type Box = { x: number; y: number; w: number; h: number };
type Pos = { x: number; y: number; scale: number; rot: number };

const readPref = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
const writePref = (on: boolean) => { try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* private mode */ } };
const isDark = (hex: string) => { const v = parseInt(hex.slice(1), 16); return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) < 140; };

/** Loads a photo (file or address) at most MAX_DIM px on the long side. */
async function loadRaw(src: File | Blob | string): Promise<HTMLCanvasElement> {
  const blob = typeof src === 'string' ? await (await fetch(src, { mode: 'cors', credentials: 'omit' })).blob() : src;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** Background = the colour region joined to the photo's edges (5H13studio v1.5.1). Returns the cleaned pixels. */
function removeBackground(raw: ImageData, tolerance: number): ImageData {
  const w = raw.width, h = raw.height, n = w * h, src = raw.data;
  const out = new ImageData(new Uint8ClampedArray(src), w, h), d = out.data;
  // background colour = per-channel median of the border pixels
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const sample = (x: number, y: number) => { const i = (y * w + x) * 4; rs.push(src[i]); gs.push(src[i + 1]); bs.push(src[i + 2]); };
  for (let x = 0; x < w; x += step) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += step) { sample(0, y); sample(w - 1, y); }
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const br = med(rs), bg = med(gs), bb = med(bs);
  const tol = tolerance * 2.2, tolSq = tol * tol, driftSq = (tol * 0.35) ** 2, farSq = (tol * 2) ** 2;
  const distBg = (i: number) => { const r = src[i] - br, g = src[i + 1] - bg, b = src[i + 2] - bb; return r * r + g * g + b * b; };
  const mask = new Uint8Array(n), queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const seed = (p: number) => { if (!mask[p] && distBg(p * 4) < tolSq) { mask[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const p = queue[qh++], x = p % w, pi = p * 4;
    const tryN = (q: number) => {
      if (mask[q]) return;
      const qi = q * 4, db = distBg(qi);
      if (db < tolSq) { mask[q] = 1; queue[qt++] = q; return; }
      // gentle drift: shadows / light fall-off on the backdrop
      const r = src[qi] - src[pi], g = src[qi + 1] - src[pi + 1], b = src[qi + 2] - src[pi + 2];
      if (r * r + g * g + b * b < driftSq && db < farSq) { mask[q] = 1; queue[qt++] = q; }
    };
    if (x > 0) tryN(p - 1);
    if (x < w - 1) tryN(p + 1);
    if (p >= w) tryN(p - w);
    if (p < n - w) tryN(p + w);
  }
  removeSmallIslands(mask, w, h, Math.max(24, Math.floor(n * 0.0005)));
  // apply with a soft 1–2 px edge
  for (let p = 0; p < n; p++) {
    if (mask[p]) { d[p * 4 + 3] = 0; continue; }
    const x = p % w;
    const edge = (x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (p >= w && mask[p - w]) || (p < n - w && mask[p + w]);
    if (edge) { const a = Math.min(1, Math.max(0.35, (Math.sqrt(distBg(p * 4)) - tol) / (tol * 0.8))); d[p * 4 + 3] = Math.round(d[p * 4 + 3] * a); }
  }
  return out;
}
/** Specks left in the background (smaller than minSize) become background too. */
function removeSmallIslands(mask: Uint8Array, w: number, h: number, minSize: number) {
  const n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (mask[s] || seen[s]) continue;
    let top = 0, count = 0; stack[top++] = s; seen[s] = 1;
    const members: number[] = [];
    while (top) {
      const p = stack[--top]; count++;
      if (count <= minSize) members.push(p);
      const x = p % w;
      const push = (q: number) => { if (!mask[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; } };
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < n - w) push(p + w);
    }
    if (count < minSize) for (const p of members) mask[p] = 1;
  }
}
function boundsOf(c: HTMLCanvasElement): Box | null {
  const w = c.width, h = c.height, d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) { const row = y * w * 4; for (let x = 0; x < w; x++) if (d[row + x * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function PhotoEditor({ source, shopColor = '#0e6e63', title = 'Touch up photo', onDone, onCancel, onAsIs }: {
  source: File | Blob | string;
  shopColor?: string;
  title?: string;
  /** the finished square photo */
  onDone: (file: File) => void;
  onCancel: () => void;
  /** "Use the photo as it is" (no editing); when missing, the button is not shown */
  onAsIs?: () => void;
}) {
  const view = useRef<HTMLCanvasElement>(null);
  const raw = useRef<HTMLCanvasElement | null>(null);       // the photo as loaded
  const rawData = useRef<ImageData | null>(null);
  const work = useRef<HTMLCanvasElement | null>(null);      // the photo with its background cleaned
  const bbox = useRef<Box | null>(null);                    // what is left of the photo (the product)
  const undoStack = useRef<ImageData[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [tool, setTool] = useState<Tool>('move');
  const [tol, setTol] = useState(35);
  const [brush, setBrush] = useState(36);
  const [bg, setBg] = useState<Backdrop>('original');
  const [custom, setCustom] = useState('#f1f5f9');
  const [shadow, setShadow] = useState(true);
  const [pos, setPos] = useState<Pos>({ x: OUT / 2, y: OUT / 2, scale: 1, rot: 0 });
  const [cleaned, setCleaned] = useState(false);
  const [undos, setUndos] = useState(0);
  const [auto, setAuto] = useState(true);
  const [working, setWorking] = useState('');                 // e.g. "Removing background…"
  const [viewZ, setViewZ] = useState({ z: 1, tx: 0, ty: 0 });  // view zoom for fine cutout work (does not change the photo)
  const box = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'bg' | 'backdrop' | 'pos'>('bg');
  const [, bump] = useState(0);
  const redraw = () => bump((n) => n + 1);
  const wctx = () => work.current!.getContext('2d', { willReadFrequently: true })!;
  const say = (t: string) => { setNote(t); setTimeout(() => setNote((x) => (x === t ? '' : x)), 3000); };

  // ---------------- position helpers (on the product's own bounds) ----------------
  const subject = (): Box | null => bbox.current ?? (work.current ? { x: 0, y: 0, w: work.current.width, h: work.current.height } : null);
  /** the position that puts the product's centre at (tx, ty) */
  function centred(p: Pos, tx = OUT / 2, ty = OUT / 2): Pos {
    const b = subject(), w = work.current; if (!b || !w) return p;
    const ox = (b.x + b.w / 2 - w.width / 2) * p.scale, oy = (b.y + b.h / 2 - w.height / 2) * p.scale, a = p.rot * Math.PI / 180;
    return { ...p, x: tx - (ox * Math.cos(a) - oy * Math.sin(a)), y: ty - (ox * Math.sin(a) + oy * Math.cos(a)) };
  }
  /** the product at 80% of the square, upright, centred; "as taken": the whole photo fills the square */
  function fitted(backdrop = bg): Pos {
    const w = work.current; if (!w) return pos;
    if (backdrop === 'original') return { x: OUT / 2, y: OUT / 2, rot: 0, scale: Math.max(OUT / w.width, OUT / w.height) };
    const b = subject()!;
    return centred({ x: OUT / 2, y: OUT / 2, rot: 0, scale: (OUT * 0.8) / Math.max(b.w, b.h) });
  }
  /** the size of "1×" (Fit) on the current backdrop */
  const fitScale = () => fitted().scale;
  /** size / turn around the product's current centre */
  function resized(scale: number, rot: number): Pos {
    const b = subject(), w = work.current; if (!b || !w) return pos;
    const cx = b.x + b.w / 2 - w.width / 2, cy = b.y + b.h / 2 - w.height / 2, a = pos.rot * Math.PI / 180;
    const vx = pos.x + (cx * Math.cos(a) - cy * Math.sin(a)) * pos.scale, vy = pos.y + (cx * Math.sin(a) + cy * Math.cos(a)) * pos.scale;
    return centred({ ...pos, scale: Math.min(6, Math.max(0.05, scale)), rot }, vx, vy);
  }

  // ---------------- loading ----------------
  useEffect(() => {
    let live = true;
    const autoOn = readPref();
    setAuto(autoOn);
    loadRaw(source).then((c) => {
      if (!live) return;
      raw.current = c;
      rawData.current = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
      const w = document.createElement('canvas'); w.width = c.width; w.height = c.height;
      w.getContext('2d', { willReadFrequently: true })!.putImageData(rawData.current, 0, 0);
      work.current = w; bbox.current = null; undoStack.current = []; setUndos(0);
      if (autoOn) strip(true); else setPos({ x: OUT / 2, y: OUT / 2, rot: 0, scale: Math.max(OUT / c.width, OUT / c.height) });
      setReady(true);
    }).catch(() => setError('This photo could not be opened. Use a JPG or PNG photo.'));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // ---------------- drawing ----------------
  function paint(ctx: CanvasRenderingContext2D) {
    const w = work.current;
    ctx.clearRect(0, 0, OUT, OUT);
    if (!w) return;
    let fill: string | CanvasGradient = '#ffffff';
    if (bg === 'stone') { const g = ctx.createLinearGradient(0, 0, 0, OUT); g.addColorStop(0, '#fafaf9'); g.addColorStop(1, '#d6d3d1'); fill = g; }
    else if (bg === 'podium') { const g = ctx.createRadialGradient(OUT / 2, OUT * 0.42, OUT * 0.08, OUT / 2, OUT * 0.5, OUT * 0.78); g.addColorStop(0, '#334155'); g.addColorStop(1, '#0b1120'); fill = g; }
    else if (bg === 'pastel') { const g = ctx.createLinearGradient(0, 0, OUT, OUT); g.addColorStop(0, '#e0f2fe'); g.addColorStop(0.5, '#fce7f3'); g.addColorStop(1, '#fef3c7'); fill = g; }
    else if (bg === 'shop') fill = shopColor;
    else if (bg === 'custom') fill = custom;
    ctx.fillStyle = fill; ctx.fillRect(0, 0, OUT, OUT);
    const onBackdrop = bg !== 'original';
    const b = bbox.current;
    if (onBackdrop && shadow && b) {
      // soft floor shadow under the product's bottom centre (follows the turn)
      const lx = (b.x + b.w / 2 - w.width / 2) * pos.scale, ly = (b.y + b.h - w.height / 2) * pos.scale, a = pos.rot * Math.PI / 180;
      const sx = pos.x + lx * Math.cos(a) - ly * Math.sin(a), sy = pos.y + lx * Math.sin(a) + ly * Math.cos(a);
      const rw = Math.max(20, b.w * pos.scale * 0.55), rh = Math.max(6, rw * 0.13);
      const dark = bg === 'podium' || ((bg === 'shop' || bg === 'custom') && isDark(bg === 'shop' ? shopColor : custom));
      const k = dark ? 0.55 : 0.32;
      ctx.save(); ctx.translate(sx, sy - rh * 0.25); ctx.scale(1, rh / rw);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rw);
      g.addColorStop(0, `rgba(0,0,0,${k})`); g.addColorStop(0.55, `rgba(0,0,0,${k * 0.3})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rw, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(pos.x, pos.y); ctx.rotate(pos.rot * Math.PI / 180); ctx.scale(pos.scale, pos.scale);
    ctx.drawImage(onBackdrop ? w : raw.current!, -w.width / 2, -w.height / 2);
    ctx.restore();
  }
  useEffect(() => {
    const c = view.current;
    if (!c || !ready) return;
    c.width = OUT; c.height = OUT;
    paint(c.getContext('2d')!);
  });

  // ---------------- background tools ----------------
  function pushUndo() {
    const w = work.current; if (!w) return;
    undoStack.current.push(wctx().getImageData(0, 0, w.width, w.height));
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setUndos(undoStack.current.length);
  }
  function undo(silent = false) {
    const last = undoStack.current.pop(); if (!last) return;
    wctx().putImageData(last, 0, 0); setUndos(undoStack.current.length);
    bbox.current = boundsOf(work.current!);
    setCleaned(undoStack.current.length > 0 || !!bbox.current && (bbox.current.w < work.current!.width || bbox.current.h < work.current!.height));
    redraw(); if (!silent) say('Undone');
  }
  function startOver() {
    if (!rawData.current) return;
    pushUndo(); wctx().putImageData(rawData.current, 0, 0); bbox.current = null;
    setCleaned(false); setBg('original'); setPos(fitted('original')); say('Back to the photo as taken');
  }
  /** puts a cleaned version in place and fits it on the backdrop */
  function applyCleaned(img: ImageData, onLoad: boolean, label: string) {
    const w = work.current!;
    wctx().putImageData(img, 0, 0);
    bbox.current = boundsOf(w);
    if (!bbox.current) { wctx().putImageData(rawData.current!, 0, 0); say('Everything was removed — try the Simple remover, or move the slider to the left.'); setPos(fitted('original')); return false; }
    setCleaned(true);
    const next = bg === 'original' ? 'white' : bg;
    setBg(next);
    setPos(fitted(next));
    if (!onLoad || label) say(label || 'Background removed');
    return true;
  }
  /** colour-based remover (plain backgrounds; no download) */
  function simple(onLoad = false) {
    if (!work.current || !rawData.current) return;
    if (!onLoad) pushUndo();
    applyCleaned(removeBackground(rawData.current, tol), onLoad, onLoad ? '' : 'Background removed (simple remover)');
  }
  /** AI remover (small model on the phone); falls back to the simple remover */
  async function strip(onLoad = false) {
    const w = work.current; if (!w || !rawData.current || !raw.current) return;
    if (!onLoad) pushUndo();
    setWorking(aiLoaded ? 'Removing background…' : 'Getting the photo tool ready (about 15 MB, first time only)…');
    try {
      const alpha = await aiMask(raw.current);
      const img = new ImageData(new Uint8ClampedArray(rawData.current.data), w.width, w.height);
      for (let p = 0; p < alpha.length; p++) img.data[p * 4 + 3] = Math.round(img.data[p * 4 + 3] * alpha[p] / 255);
      applyCleaned(img, onLoad, '');
    } catch {
      applyCleaned(removeBackground(rawData.current, tol), onLoad, 'The AI tool could not load (no internet?) — used the simple remover.');
    }
    setWorking('');
  }
  /** where a point on the square falls on the photo */
  function toPhoto(cx: number, cy: number) {
    const w = work.current!, a = -pos.rot * Math.PI / 180, dx = cx - pos.x, dy = cy - pos.y;
    return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / pos.scale + w.width / 2, y: (dx * Math.sin(a) + dy * Math.cos(a)) / pos.scale + w.height / 2 };
  }
  function magicTap(cx: number, cy: number) {
    const w = work.current!, p = toPhoto(cx, cy), px = Math.floor(p.x), py = Math.floor(p.y);
    if (px < 0 || py < 0 || px >= w.width || py >= w.height) return;
    const ctx = wctx(), img = ctx.getImageData(0, 0, w.width, w.height), d = img.data, start = py * w.width + px;
    if (d[start * 4 + 3] === 0) return say('Already removed there');
    pushUndo();
    const tr = d[start * 4], tg = d[start * 4 + 1], tb = d[start * 4 + 2], tolSq = (tol * 2.2) ** 2;
    const n = w.width * w.height, seen = new Uint8Array(n), stack = new Int32Array(n);
    let top = 0; stack[top++] = start; seen[start] = 1;
    while (top) {
      const q = stack[--top]; d[q * 4 + 3] = 0;
      const x = q % w.width;
      const push = (r: number) => { if (seen[r]) return; seen[r] = 1; const j = r * 4; if (d[j + 3] === 0) return; const a = d[j] - tr, g = d[j + 1] - tg, b = d[j + 2] - tb; if (a * a + g * g + b * b <= tolSq) stack[top++] = r; };
      if (x > 0) push(q - 1); if (x < w.width - 1) push(q + 1); if (q >= w.width) push(q - w.width); if (q < n - w.width) push(q + w.width);
    }
    ctx.putImageData(img, 0, 0);
    bbox.current = boundsOf(w); setCleaned(true);
    if (bg === 'original') setBg('white');
    redraw();
  }
  /** soft-edged erase / restore at one point (photo pixels) */
  function brushAt(cx: number, cy: number, erase: boolean) {
    const w = work.current!, p = toPhoto(cx, cy), r = brush / pos.scale;
    const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(w.width - 1, Math.ceil(p.x + r)), y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(w.height - 1, Math.ceil(p.y + r));
    if (x0 > x1 || y0 > y1) return;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ctx = wctx(), img = ctx.getImageData(x0, y0, bw, bh), d = img.data, src = rawData.current!.data, soft = Math.max(1, r * 0.25);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x - p.x, y - p.y); if (dist > r) continue;
      const k = Math.min(1, (r - dist) / soft), i = ((y - y0) * bw + (x - x0)) * 4;
      if (erase) d[i + 3] = Math.round(d[i + 3] * (1 - k));
      else { const j = (y * w.width + x) * 4; d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = Math.max(d[i + 3], Math.round(src[j + 3] * k)); }
    }
    ctx.putImageData(img, x0, y0);
  }

  // ---------------- touch / mouse: one finger = tool, two fingers = size and turn ----------------
  const pointers = useRef(new Map<number, { x: number; y: number; sx: number; sy: number; k: number }>());
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const stroke = useRef<{ x: number; y: number; erase: boolean } | null>(null);
  const pinch = useRef<{ d: number; ang: number; mx: number; my: number; p: Pos } | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; r: number } | null>(null);
  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect(), k = OUT / rect.width; // rect follows the view zoom
    const br = box.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, sx: e.clientX - br.left, sy: e.clientY - br.top, k };
  }
  const viewPinch = useRef<{ d: number; mx: number; my: number; v: { z: number; tx: number; ty: number } } | null>(null);
  /** keeps the zoomed view inside the frame */
  function clampView(v: { z: number; tx: number; ty: number }) {
    const W = box.current?.clientWidth ?? 1, H = box.current?.clientHeight ?? 1;
    const z = Math.min(5, Math.max(1, v.z));
    return { z, tx: Math.min(0, Math.max(W * (1 - z), v.tx)), ty: Math.min(0, Math.max(H * (1 - z), v.ty)) };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    const p = at(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as ReturnType<typeof at>[];
      if (stroke.current) { undo(true); stroke.current = null; } // the first finger's brush dab is taken back
      drag.current = null; setRing(null);
      if (tool === 'move') pinch.current = { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, p: pos };
      else viewPinch.current = { d: Math.hypot(b.sx - a.sx, b.sy - a.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2, v: viewZ };
      return;
    }
    if (pointers.current.size > 2) return;
    if (tool === 'magic') return magicTap(p.x, p.y);
    if (tool === 'erase' || tool === 'restore') {
      pushUndo(); stroke.current = { x: p.x, y: p.y, erase: tool === 'erase' };
      brushAt(p.x, p.y, tool === 'erase'); setCleaned(true);
      if (tool === 'erase' && bg === 'original') setBg('white');
      setRing({ x: p.sx, y: p.sy, r: brush / p.k }); redraw();
      return;
    }
    drag.current = { sx: p.x, sy: p.y, ox: pos.x, oy: pos.y };
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = at(e);
    if (!pointers.current.has(e.pointerId)) { if (e.pointerType === 'mouse' && (tool === 'erase' || tool === 'restore')) setRing({ x: p.sx, y: p.sy, r: brush / p.k }); return; }
    pointers.current.set(e.pointerId, p);
    const vp = viewPinch.current;
    if (vp && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as ReturnType<typeof at>[];
      const d = Math.hypot(b.sx - a.sx, b.sy - a.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      const z = Math.min(5, Math.max(1, vp.v.z * d / vp.d)), k = z / vp.v.z;
      setViewZ(clampView({ z, tx: mx - (vp.mx - vp.v.tx) * k, ty: my - (vp.my - vp.v.ty) * k }));
      return;
    }
    const pi = pinch.current;
    if (pi && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let rot = pi.p.rot + (ang - pi.ang) * 180 / Math.PI;
      rot = ((rot + 540) % 360) - 180; if (Math.abs(rot) < 3) rot = 0; // snap upright
      const scale = Math.min(6, Math.max(0.05, pi.p.scale * d / pi.d)), k = scale / pi.p.scale, da = (rot - pi.p.rot) * Math.PI / 180;
      const vx = pi.p.x - pi.mx, vy = pi.p.y - pi.my;
      setPos({ x: mx + k * (vx * Math.cos(da) - vy * Math.sin(da)), y: my + k * (vx * Math.sin(da) + vy * Math.cos(da)), scale, rot: Math.round(rot) });
      return;
    }
    const s = stroke.current;
    if (s) {
      const steps = Math.ceil(Math.hypot(p.x - s.x, p.y - s.y) / Math.max(2, brush / 3));
      for (let i = 1; i <= steps; i++) brushAt(s.x + (p.x - s.x) * i / steps, s.y + (p.y - s.y) * i / steps, s.erase);
      stroke.current = { ...s, x: p.x, y: p.y };
      setRing({ x: p.sx, y: p.sy, r: brush / p.k }); redraw();
      return;
    }
    const dr = drag.current;
    if (dr) setPos((q) => ({ ...q, x: dr.ox + p.x - dr.sx, y: dr.oy + p.y - dr.sy }));
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (stroke.current && pointers.current.size === 0) { stroke.current = null; bbox.current = boundsOf(work.current!); redraw(); }
    if ((pinch.current || viewPinch.current) && pointers.current.size < 2) { pinch.current = null; viewPinch.current = null; drag.current = null; }
    if (pointers.current.size === 0) { drag.current = null; if (e.pointerType !== 'mouse') setRing(null); }
  }
  function wheel(e: React.WheelEvent<HTMLCanvasElement>) { // computer: wheel = size, Shift + wheel = turn
    if (!ready) return;
    if (e.shiftKey) setPos(resized(pos.scale, Math.max(-180, Math.min(180, pos.rot + Math.sign(e.deltaY) * 2))));
    else setPos(resized(pos.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06), pos.rot));
  }

  // ---------------- result ----------------
  const [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
    paint(c.getContext('2d')!);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    setBusy(false);
    if (blob) onDone(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  const chip = (on: boolean) => `min-h-[40px] rounded-full border px-3 text-[14px] font-semibold ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-800'}`;
  const toolBtn = (t: Tool, label: string) => <button type="button" aria-pressed={tool === t} onClick={() => { setTool(t); setRing(null); if (t === 'move') setViewZ({ z: 1, tx: 0, ty: 0 }); }} className={chip(tool === t)}>{label}</button>;
  const hint = tool === 'move' ? 'Drag to move · two fingers to size and turn' : (tool === 'magic' ? 'Tap a colour area to remove it' : tool === 'erase' ? 'Rub over what should go' : 'Rub over what should come back') + ' · two fingers to zoom in';
  // Build 14: drawn on top of the whole page (side menu, Save bar), wherever the editor was opened from
  return createPortal((
    <div role="dialog" aria-modal="true" aria-label={title} className="studio-ui fixed inset-0 z-[80] !m-0 flex flex-col bg-slate-100" data-testid="photo-editor">
      <header className="flex items-center gap-2 border-b bg-white px-3 py-2">
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-xl px-3 text-[15px] font-semibold text-slate-600">Cancel</button>
        <h2 className="min-w-0 flex-1 truncate text-center text-[17px] font-extrabold">{title}</h2>
        <button type="button" onClick={finish} disabled={!ready || busy} className="btn-primary min-h-[44px] px-4 text-[15px]">{busy ? '…' : 'Use photo'}</button>
      </header>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="relative mx-auto mt-3 w-full max-w-[420px] px-3">
          <div ref={box} className="relative aspect-square w-full overflow-hidden rounded-2xl bg-white shadow">
          <canvas ref={view} style={{ transform: `translate(${viewZ.tx}px, ${viewZ.ty}px) scale(${viewZ.z})`, transformOrigin: '0 0' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pointers.current.size) setRing(null); }} onWheel={wheel}
            className="block aspect-square w-full touch-none" aria-label="Photo" data-testid="photo-editor-canvas" data-ready={ready && !working ? '1' : '0'} data-cleaned={cleaned ? '1' : '0'} data-viewzoom={viewZ.z.toFixed(2)} />
          {ring && <span className="pointer-events-none absolute rounded-full border-2 border-cyan-500 bg-cyan-400/20" style={{ left: ring.x - ring.r, top: ring.y - ring.r, width: ring.r * 2, height: ring.r * 2 }} />}
          {working && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/80 p-6 text-center text-[14px] font-semibold text-slate-700" role="status"><span className="h-9 w-9 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />{working}</div>}
          {viewZ.z > 1.01 && <button type="button" onClick={() => setViewZ({ z: 1, tx: 0, ty: 0 })} className="absolute bottom-2 left-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-[13px] font-bold shadow">Zoom {viewZ.z.toFixed(1)}× · Reset view</button>}
          </div>
          {!ready && !error && <p className="absolute inset-0 flex items-center justify-center text-[14px] text-slate-500">Opening photo…</p>}
          {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-[14px] text-red-700">{error}</p>}
          {ready && (
            <div className="absolute right-5 top-2 flex gap-1.5">
              <button type="button" onClick={() => undo()} disabled={!undos} className="rounded-lg bg-white/95 px-2.5 py-1.5 text-[13px] font-bold shadow disabled:opacity-40">Undo</button>
              <button type="button" onClick={() => setPos(fitted())} className="rounded-lg bg-white/95 px-2.5 py-1.5 text-[13px] font-bold shadow">Fit</button>
            </div>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-[420px] px-4 text-center text-[12px] text-slate-500" role="status">{note || hint}</p>
        {ready && (
          <div className="mx-auto mt-2 flex max-w-[420px] justify-center gap-1.5 px-3" aria-label="Product size">
            {[0.5, 0.75, 1, 1.5, 2].map((f) => {
              const on = Math.abs(pos.scale / fitScale() - f) < 0.02;
              return <button key={f} type="button" aria-pressed={on} onClick={() => setPos(resized(fitScale() * f, pos.rot))} className={`min-h-[36px] min-w-[52px] rounded-full border px-2 text-[13px] font-bold ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white'}`}>{f}×</button>;
            })}
          </div>
        )}
        {onAsIs && <div className="mx-auto mt-2 max-w-[420px] px-3"><button type="button" onClick={onAsIs} className="btn-ghost w-full">Use the photo as it is</button></div>}

        <nav aria-label="Photo tools" className="mx-auto mt-3 flex max-w-[420px] gap-2 px-3">
          {([['bg', 'Background'], ['backdrop', 'Backdrop'], ['pos', 'Size & turn']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className={`min-w-0 flex-1 ${chip(tab === k)}`}>{l}</button>
          ))}
        </nav>
        <section className="mx-auto mt-3 max-w-[420px] space-y-3 px-3 pb-10">
          {tab === 'bg' && (<>
            <p className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">Best results: shoot the product on a plain background — a white sheet, a wall or a table — with good light. Too close? Use 0.5× on your camera, or step back.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => strip()} disabled={!ready || !!working} className="btn-primary">Remove background</button>
              <button type="button" onClick={startOver} disabled={!ready || !cleaned} className="btn-ghost">Start over</button>
            </div>
            <button type="button" onClick={() => simple()} disabled={!ready || !!working} className="w-full text-left text-[13px] font-semibold text-brand-dark underline">Simple remover (plain backgrounds, works offline)</button>
            <div className="flex flex-wrap gap-2">{toolBtn('move', 'Move')}{toolBtn('magic', 'Tap to remove')}{toolBtn('erase', 'Erase brush')}{toolBtn('restore', 'Restore brush')}</div>
            <label className="block text-[14px]"><span className="flex justify-between"><span>How much colour to remove</span><b>{tol}</b></span>
              <input type="range" min={5} max={110} value={tol} onChange={(e) => setTol(Number(e.target.value))} className="w-full accent-[#0e6e63]" aria-label="How much colour to remove" />
              <span className="block text-[12px] text-slate-500">For Tap to remove and the Simple remover. Too much removed? Move it left.</span></label>
            {(tool === 'erase' || tool === 'restore') && <label className="block text-[14px]"><span className="flex justify-between"><span>Brush size</span><b>{brush}</b></span>
              <input type="range" min={8} max={90} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="w-full accent-[#0e6e63]" aria-label="Brush size" /></label>}
            <label className="flex min-h-[44px] items-center gap-3 text-[14px]"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); writePref(e.target.checked); }} className="h-5 w-5 accent-[#0e6e63]" />Remove the background as soon as a photo opens</label>
          </>)}
          {tab === 'backdrop' && (<>
            <div className="grid grid-cols-2 gap-2">{BACKDROPS.map((b) => (
              <button key={b.key} type="button" aria-pressed={bg === b.key} onClick={() => { const was = bg; setBg(b.key); if ((was === 'original') !== (b.key === 'original')) setPos(fitted(b.key)); }} className={`flex min-h-[48px] items-center gap-2 rounded-xl border px-3 text-left text-[14px] font-semibold ${bg === b.key ? 'border-brand bg-brand-soft' : 'border-slate-200 bg-white'}`}>
                <span className="h-6 w-6 flex-none rounded-md border" style={{ background: b.key === 'shop' ? shopColor : b.key === 'custom' ? custom : b.swatch }} />{b.label}
              </button>))}</div>
            {bg === 'custom' && <label className="flex items-center gap-3 text-[14px]">Own colour<input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-11 w-16 rounded-lg border" aria-label="Own backdrop colour" /></label>}
            {bg !== 'original' && !cleaned && <p className="text-[13px] text-amber-800">The backdrop shows around the product once the background is removed (Background → Remove background).</p>}
            {bg !== 'original' && <label className="flex min-h-[44px] items-center gap-3 text-[15px]"><input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} className="h-5 w-5 accent-[#0e6e63]" />Soft shadow under the product</label>}
          </>)}
          {tab === 'pos' && (<>
            <label className="block text-[14px]"><span className="flex justify-between"><span>Size (100% = Fit)</span><b>{Math.round(pos.scale / fitScale() * 100)}%</b></span>
              <input type="range" min={20} max={300} value={Math.round(pos.scale / fitScale() * 100)} onChange={(e) => setPos(resized(fitScale() * Number(e.target.value) / 100, pos.rot))} className="w-full accent-[#0e6e63]" aria-label="Size" /></label>
            <label className="block text-[14px]"><span className="flex justify-between"><span>Turn</span><b>{pos.rot}°</b></span>
              <input type="range" min={-180} max={180} value={pos.rot} onChange={(e) => setPos(resized(pos.scale, Number(e.target.value)))} className="w-full accent-[#0e6e63]" aria-label="Turn" /></label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" onClick={() => setPos(centred(pos))}>Centre</button>
              <button type="button" className="btn-ghost" onClick={() => setPos(fitted())}>Fit</button>
            </div>
            <p className="text-[12px] text-slate-500">On a phone you can also use two fingers on the photo to size and turn it (with the Move tool).</p>
          </>)}
        </section>
      </div>
    </div>
  ), document.body);
}
