// Build 12.1: background removal with a small AI model on the seller's phone — U²-Net small ("u2netp", Apache-2.0),
// run by ONNX Runtime Web (MIT), both self-hosted in /public/ai (about 15 MB, downloaded the first time it is used,
// then kept by the browser). No server work, no cost per photo. Pre- / post-processing as in rembg.
type Ort = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create: (model: ArrayBuffer, opts: object) => Promise<{ inputNames: string[]; outputNames: string[]; run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>> }> };
};
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
// the engine is loaded from /ai at run time (kept out of the app's bundle; only the photo editor needs it)
const importUrl = new Function('u', 'return import(u)') as (u: string) => Promise<Ort>;
let ready: Promise<{ ort: Ort; s: Session }> | null = null;
export let aiLoaded = false;

function load() {
  if (!ready) {
    ready = (async () => {
      const ort = await importUrl('/ai/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = '/ai/';
      ort.env.wasm.numThreads = 1; // works without special page headers
      const res = await fetch('/ai/u2netp.onnx');
      if (!res.ok) throw new Error('model');
      const s = await ort.InferenceSession.create(await res.arrayBuffer(), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      aiLoaded = true;
      return { ort, s };
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** How solid each pixel of the photo is (0 = background, 255 = product), at the photo's own size. */
export async function aiMask(photo: HTMLCanvasElement): Promise<Uint8ClampedArray> {
  const { ort, s } = await load();
  // 320 × 320 input, scaled by the brightest value, then the usual mean / std
  const small = document.createElement('canvas'); small.width = SIZE; small.height = SIZE;
  const sg = small.getContext('2d', { willReadFrequently: true })!;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(photo, 0, 0, SIZE, SIZE);
  const px = sg.getImageData(0, 0, SIZE, SIZE).data;
  let max = 1e-6;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const n = SIZE * SIZE, input = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) input[c * n + p] = (px[p * 4 + c] / max - MEAN[c]) / STD[c];
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const pred = out[s.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (pred[i] < lo) lo = pred[i]; if (pred[i] > hi) hi = pred[i]; }
  // back to the photo's size (smooth), as an alpha channel
  const m = sg.createImageData(SIZE, SIZE);
  for (let i = 0; i < n; i++) { const v = Math.round(((pred[i] - lo) / Math.max(1e-6, hi - lo)) * 255); m.data[i * 4 + 3] = v; }
  sg.clearRect(0, 0, SIZE, SIZE); sg.putImageData(m, 0, 0);
  const big = document.createElement('canvas'); big.width = photo.width; big.height = photo.height;
  const bg = big.getContext('2d', { willReadFrequently: true })!;
  bg.imageSmoothingQuality = 'high';
  bg.drawImage(small, 0, 0, photo.width, photo.height);
  const a = bg.getImageData(0, 0, photo.width, photo.height).data;
  const w = photo.width, h = photo.height, alpha = new Uint8ClampedArray(w * h);
  // firmer: faint thin parts (brass fittings, wires) become solid, faint background haze goes
  for (let p = 0; p < w * h; p++) {
    const t = Math.min(1, Math.max(0, (a[p * 4 + 3] / 255 - 0.1) / 0.4));
    alpha[p] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  dropSpecks(alpha, w, h);
  return alpha;
}

/** Pieces much smaller than the biggest one (leftover haze) are removed. */
function dropSpecks(alpha: Uint8ClampedArray, w: number, h: number) {
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n), sizes: number[] = [0];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (alpha[s] < 128 || lab[s]) continue;
    next++; let top = 0, count = 0; stack[top++] = s; lab[s] = next;
    while (top) {
      const p = stack[--top]; count++;
      const x = p % w;
      const push = (q: number) => { if (!lab[q] && alpha[q] >= 128) { lab[q] = next; stack[top++] = q; } };
      if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (p >= w) push(p - w); if (p < n - w) push(p + w);
    }
    sizes.push(count);
  }
  if (next < 2) return;
  const biggest = Math.max(...sizes), min = Math.max(40, biggest * 0.02);
  for (let p = 0; p < n; p++) if (lab[p] && sizes[lab[p]] < min) alpha[p] = 0;
  // faint pixels away from any kept piece: gone
  for (let p = 0; p < n; p++) if (!lab[p] && alpha[p] < 128) {
    const x = p % w; let near = false;
    for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < n && (q !== p - 1 || x > 0) && (q !== p + 1 || x < w - 1) && lab[q] && sizes[lab[q]] >= min) { near = true; break; }
    if (!near && alpha[p] < 64) alpha[p] = 0;
  }
}
