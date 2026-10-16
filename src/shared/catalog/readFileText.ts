'use client';
// Build 119 — read a picture (JPG / PNG) or a PDF into plain text, on the device.
//   * PDF with real text (exported from a supplier's system): the text is read directly (pdf.js).
//   * Scanned PDF or picture: read with Tesseract OCR (English). Nothing is uploaded anywhere.
// The libraries and the English language file are served by the app itself (public/ocr, see README.txt)
// and loaded only when a file is chosen — no outside CDN.
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
  try { const r = await w.recognize(image); return String(r?.data?.text ?? ''); } finally { progressFn = undefined; }
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

export async function readFileText(file: File, onProgress?: (msg: string) => void): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/') || /\.(jpe?g|png)$/.test(name)) {
    onProgress?.('Loading the text reader…');
    return ocr(file, onProgress, 'the picture');
  }
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    onProgress?.('Opening the PDF…');
    const pdfjs = await loadPdf();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      let t = await pageText(page);
      if (t.replace(/\s/g, '').length < 20) {   // no real text on the page: a scan → read the picture
        onProgress?.(`Page ${p} is a scan — reading the picture…`);
        const vp = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        t = await ocr(canvas, onProgress, `page ${p}`);
      }
      parts.push(t);
    }
    if (doc.numPages > MAX_PAGES) parts.push(`(only the first ${MAX_PAGES} pages were read)`);
    return parts.join('\n');
  }
  throw new Error('Choose a JPG, PNG or PDF file.');
}
