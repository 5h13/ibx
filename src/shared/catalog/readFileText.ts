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
async function ocr(image: Blob | HTMLCanvasElement, onProgress?: (msg: string) => void, label = ''): Promise<string> {
  const w = await getWorker();
  progressFn = onProgress; progressLabel = label;
  // Build 120: read as one block of rows (PSM 6) — supplier DRs and lists are tables; the automatic
  // layout mode split their columns apart and lost the quantities.
  try { await w.setParameters({ tessedit_pageseg_mode: '6' }); const r = await w.recognize(image); return String(r?.data?.text ?? ''); }
  finally { progressFn = undefined; }
}

// ---------------------------------------------------------------- Build 120: photos taken sideways --
// The text reader only reads upright text; a DR photographed sideways came out as noise. The picture is
// turned upright from its camera orientation, made grey, kept to a readable size, and then — unless the
// person turned it themselves — read small in all four directions; the direction with the most clear
// words is used.
type Turn = 0 | 90 | 180 | 270;
function draw(src: CanvasImageSource, w: number, h: number, turn: Turn, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const sw = Math.round(w * k), sh = Math.round(h * k);
  const c = document.createElement('canvas');
  const side = turn === 90 || turn === 270;
  c.width = side ? sh : sw; c.height = side ? sw : sh;
  const g = c.getContext('2d')!;
  g.filter = 'grayscale(1) contrast(1.15)';
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
  const text = await ocr(draw(src, w, h, t, 2600), onProgress, label);
  return { text, turn: t };
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
export async function readFileTextTurned(file: File, onProgress?: (msg: string) => void, turn: Turn | 'auto' = 'auto'): Promise<{ text: string; turn: Turn | null }> {
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
    let used: Turn | null = null;
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
        t = r.text; used = r.turn;
      }
      parts.push(t);
    }
    if (doc.numPages > MAX_PAGES) parts.push(`(only the first ${MAX_PAGES} pages were read)`);
    return { text: parts.join('\n'), turn: used };
  }
  throw new Error('Choose a JPG, PNG or PDF file.');
}

export async function readFileText(file: File, onProgress?: (msg: string) => void): Promise<string> {
  return (await readFileTextTurned(file, onProgress)).text;
}
