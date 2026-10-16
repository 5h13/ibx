'use client';
// Build 119 — read a picture (JPG / PNG) or a PDF into plain text, on the device.
//   * PDF with real text (exported from a supplier's system): the text is read directly (pdf.js).
//   * Scanned PDF or picture: read with Tesseract OCR (English). Nothing is uploaded anywhere.
// The libraries and the English language file are served by the app itself (public/ocr, see README.txt)
// and loaded only when a file is chosen — no outside CDN.
// Build 120: photos are turned upright first (sideways DR photos read as noise) and tables are read row by row.
const TESS_URL = '/ocr/tesseract.min.js';
const PDF_URL = '/ocr/pdf.min.mjs';
const PDF_WORKER = '/ocr/pdf.worker.min.mjs';
const MAX_PAGES = 10;

let tessLoading: Promise<any> | null = null;
function loadTesseract(): Promise<any> {
  const w = window as any;
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  tessLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESS_URL; s.async = true;
    s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error('The text reader did not load.')));
    s.onerror = () => { tessLoading = null; reject(new Error('The text reader could not be loaded.')); };
    document.head.appendChild(s);
  });
  return tessLoading;
}
let pdfLoading: Promise<any> | null = null;
function loadPdf(): Promise<any> {
  pdfLoading ??= (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PDF_URL) as Promise<any>).then((m) => { m.GlobalWorkerOptions.workerSrc = PDF_WORKER; return m; })
    .catch((e) => { pdfLoading = null; throw new Error(`The PDF reader could not be loaded (${e?.message ?? 'no connection'}).`); });
  return pdfLoading;
}

let progressFn: ((msg: string) => void) | undefined;
let progressLabel = '';
let workerP: Promise<any> | null = null;
async function getWorker(): Promise<any> {
  const T = await loadTesseract();
  workerP ??= T.createWorker('eng', 1, {
    workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/', gzip: true,
    logger: (m: any) => { if (m.status === 'recognizing text' && progressFn) progressFn(`Reading ${progressLabel}… ${Math.round((m.progress ?? 0) * 100)}%`); },
  }).catch((e: any) => { workerP = null; throw new Error(`The text reader could not start (${e?.message ?? e}).`); });
  return workerP;
}
type Read = { text: string; clear: number };
const clearCount = (words: any[]) => (words ?? []).filter((x) => Number(x.confidence) >= 60 && String(x.text ?? '').replace(/[^a-z0-9]/gi, '').length > 2).length;
async function ocrRead(image: HTMLCanvasElement, psm: '6' | '11', onProgress?: (msg: string) => void, label = ''): Promise<{ data: any; clear: number }> {
  const w = await getWorker();
  progressFn = onProgress; progressLabel = label;
  try { await w.setParameters({ tessedit_pageseg_mode: psm }); const r = await w.recognize(image); return { data: r?.data ?? {}, clear: clearCount(r?.data?.words) }; }
  finally { progressFn = undefined; }
}
// Build 120: read as one block of rows (PSM 6) — supplier DRs and lists are tables; the automatic
// layout mode split their columns apart and lost the quantities.
async function ocr(image: HTMLCanvasElement, onProgress?: (msg: string) => void, label = ''): Promise<Read> {
  const r = await ocrRead(image, '6', onProgress, label);
  return { text: String(r.data.text ?? ''), clear: r.clear };
}

// -------------------------------------------- Build 120: faint prints (worn ribbon, carbon copies) --
// When the plain read is mostly noise, the picture is cleaned up and read again: the colour channel where the
// print is darkest, the lighting evened out (divided by a blurred copy of the page), the contrast stretched,
// enlarged 2× and softened so dot-matrix dots join up. That copy is read word by word (sparse mode) and the
// rows are rebuilt from where each word sits, following a slanted / bent page from left to right.
function cleaned(src: HTMLCanvasElement): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const big = document.createElement('canvas');
  const k = Math.min(2, 3600 / Math.max(W, H));
  big.width = Math.round(W * k); big.height = Math.round(H * k);
  const g = big.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, big.width, big.height);
  const img = g.getImageData(0, 0, big.width, big.height); const d = img.data;
  // the channel with the most contrast between print and paper (sampled)
  const spread = [0, 1, 2].map((c) => { const v: number[] = []; for (let i = c; i < d.length; i += 4 * 97) v.push(d[i]); v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.8)] - v[Math.floor(v.length * 0.03)]; });
  const ch = spread.indexOf(Math.max(...spread));
  // background: the page shrunk to 1/40 and stretched back (a cheap wide blur)
  const sw = Math.max(1, Math.round(big.width / 40)), sh = Math.max(1, Math.round(big.height / 40));
  const small = document.createElement('canvas'); small.width = sw; small.height = sh;
  const sg = small.getContext('2d')!; sg.imageSmoothingQuality = 'high'; sg.drawImage(big, 0, 0, sw, sh);
  const bgc = document.createElement('canvas'); bgc.width = big.width; bgc.height = big.height;
  const bg2 = bgc.getContext('2d', { willReadFrequently: true })!; bg2.imageSmoothingQuality = 'high'; bg2.drawImage(small, 0, 0, big.width, big.height);
  const bd = bg2.getImageData(0, 0, big.width, big.height).data;
  const out = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = Math.min(255, (d[i + ch] / Math.max(1, bd[i + ch])) * 255);
  // stretch: 1st percentile → black, 99th → white
  const hist = new Array(256).fill(0); for (const v of out) hist[v]++;
  const n = out.length; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = Math.max(0, Math.min(255, ((out[j] - lo) / span) * 255)); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const res = document.createElement('canvas'); res.width = big.width; res.height = big.height;
  const rg = res.getContext('2d')!; rg.filter = 'blur(1px)'; rg.drawImage(big, 0, 0);
  return res;
}
/** words → lines: each word joins the row whose last word is just to its left at nearly the same height */
function rowsFromWords(words: any[]): string {
  const W = (words ?? []).filter((x) => String(x.text ?? '').trim() && Number(x.confidence) >= 20 && x.bbox)
    .map((x) => ({ t: String(x.text).trim(), x: x.bbox.x0, r: x.bbox.x1, y: (x.bbox.y0 + x.bbox.y1) / 2, h: x.bbox.y1 - x.bbox.y0 }));
  if (!W.length) return '';
  const hs = W.map((w) => w.h).sort((a, b) => a - b); const H = hs[Math.floor(hs.length / 2)] || 20;
  W.sort((a, b) => a.x - b.x);
  const rows: (typeof W)[] = [];
  for (const w of W) {
    let best: (typeof W) | null = null, bd = Infinity;
    for (const row of rows) {
      const last = row[row.length - 1];
      if (last.r > w.x + H || w.x - last.r > H * 25) continue;
      const dy = Math.abs(last.y - w.y);
      if (dy < H * 0.6 && dy < bd) { best = row; bd = dy; }
    }
    if (best) best.push(w); else rows.push([w]);
  }
  rows.sort((a, b) => a[0].y - b[0].y);
  // keep the item name: drop the row number in front and cut at the first price / smudge after it
  // (model numbers such as "Vios 14", "City 09" stay)
  const tidy = (ts: string[]) => {
    let i = 0; while (i < ts.length && !/[a-z]{2,}/i.test(ts[i])) i++;
    const out: string[] = [];
    for (const t of ts.slice(i)) { if (/\d{3,}[.,]\d*$|^[^a-z0-9]+$/i.test(t)) break; out.push(t); }   // a price (1200.00 / 1100.) or a smudge ends the name
    return out.join(' ');
  };
  return rows.map((r) => tidy(r.map((w) => w.t))).filter((l) => /[a-z]{3,}/i.test(l)).join('\n');
}
async function readFaint(page: HTMLCanvasElement, onProgress?: (msg: string) => void, label = ''): Promise<Read> {
  onProgress?.('The print is faint — cleaning up the picture and reading again…');
  const r = await ocrRead(cleaned(page), '11', onProgress, label);
  return { text: rowsFromWords(r.data.words), clear: r.clear };
}

// ---------------------------------------------------------------- Build 120: photos taken sideways --
// The text reader only reads upright text; a DR photographed sideways came out as noise. The picture is
// turned upright from its camera orientation, made grey, kept to a readable size, and then — unless the
// person turned it themselves — read small in all four directions; the direction with the most clear
// words is used.
type Turn = 0 | 90 | 180 | 270;
function draw(src: CanvasImageSource, w: number, h: number, turn: Turn, maxSide: number, colour = false): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const sw = Math.round(w * k), sh = Math.round(h * k);
  const c = document.createElement('canvas');
  const side = turn === 90 || turn === 270;
  c.width = side ? sh : sw; c.height = side ? sw : sh;
  const g = c.getContext('2d')!;
  if (!colour) g.filter = 'grayscale(1) contrast(1.15)';
  g.translate(c.width / 2, c.height / 2); g.rotate((turn * Math.PI) / 180);
  g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  return c;
}
async function clearWords(c: HTMLCanvasElement): Promise<number> {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  const r = await w.recognize(c);
  return ((r?.data?.words ?? []) as any[]).filter((x) => Number(x.confidence) >= 60 && String(x.text ?? '').replace(/[^a-z0-9]/gi, '').length > 2).length;
}
async function upright(src: CanvasImageSource, w: number, h: number, onProgress?: (msg: string) => void): Promise<Turn> {
  onProgress?.('Finding which way is up…');
  let best: Turn = 0, bestN = -1;
  for (const t of [0, 90, 270, 180] as Turn[]) {
    const n = await clearWords(draw(src, w, h, t, 900));
    if (n > bestN) { best = t; bestN = n; }
  }
  return best;
}
async function readPicture(src: CanvasImageSource, w: number, h: number, turn: Turn | 'auto', onProgress?: (msg: string) => void, label = 'the picture') {
  const t = turn === 'auto' ? await upright(src, w, h, onProgress) : turn;
  const page = draw(src, w, h, t, 2600);
  let best: Read & { faint?: boolean } = await ocr(page, onProgress, label);
  // mostly noise (few clear words for the amount of text): try the cleaned-up read and keep the better one
  const tokens = best.text.split(/\s+/).filter(Boolean).length;
  if (best.clear < 25 || best.clear < tokens * 0.4) {
    const faint = await readFaint(draw(src, w, h, t, 2000, true), onProgress, label);
    if (faint.clear > best.clear) best = { ...faint, faint: true };
  }
  return { text: best.text, turn: t, faint: !!best.faint };
}

/** text of one PDF page, line by line (items grouped by their height on the page) */
async function pageText(page: any): Promise<string> {
  const tc = await page.getTextContent();
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of tc.items as any[]) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5] / 3) * 3;
    const row = rows.get(y) ?? []; row.push({ x: it.transform[4], s: it.str }); rows.set(y, row);
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')).join('\n');
}

/** Reads a picture or PDF into text. `turn`: 'auto' finds which way is up; a number forces that turn (clockwise). */
/** `faint`: the print was faint and only item names could be read — quantities are not on the text. */
export async function readFileTextTurned(file: File, onProgress?: (msg: string) => void, turn: Turn | 'auto' = 'auto'): Promise<{ text: string; turn: Turn | null; faint?: boolean }> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(name)) {
    onProgress?.('Loading the text reader…');
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);   // camera orientation applied
    try { return await readPicture(bmp, bmp.width, bmp.height, turn, onProgress); } finally { bmp.close?.(); }
  }
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    onProgress?.('Opening the PDF…');
    const pdfjs = await loadPdf();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    let used: Turn | null = null; let faint = false;
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      let t = await pageText(page);
      if (t.replace(/\s/g, '').length < 20) {   // no real text on the page: a scan → read the picture
        onProgress?.(`Page ${p} is a scan — reading the picture…`);
        const vp = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        const r = await readPicture(canvas, canvas.width, canvas.height, used ?? turn, onProgress, `page ${p}`);   // later pages keep page 1's direction
        t = r.text; used = r.turn; faint = faint || r.faint;
      }
      parts.push(t);
    }
    if (doc.numPages > MAX_PAGES) parts.push(`(only the first ${MAX_PAGES} pages were read)`);
    return { text: parts.join('\n'), turn: used, faint };
  }
  throw new Error('Choose a JPG, PNG or PDF file.');
}

export async function readFileText(file: File, onProgress?: (msg: string) => void): Promise<string> {
  return (await readFileTextTurned(file, onProgress)).text;
}
