'use client';
// Build 79a: bulk product photos. Files are named by Item Code
// (PA-0123.jpg = photo 1, PA-0123_2.jpg = photo 2, PA-0123_3.jpg = photo 3).
// Large photos are shrunk in the browser first, then sent three at a time.
import { useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { matchPhotoCodesAction, photoUploadDoneAction, uploadCatalogPhotoAction, type PhotoMatch } from './catalogItemActions';

type Status = 'ready' | 'has photo' | 'not found' | 'not an image' | 'repeated' | 'saved' | 'skipped' | 'failed';
type Entry = { file: File; code: string; slot: 1 | 2 | 3; item?: PhotoMatch; status: Status; note?: string };

const MAX_SIDE = 1600;
function parseName(name: string): { code: string; slot: 1 | 2 | 3 } {
  const base = name.replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.+?)[_ ]\(?([123])\)?$/);
  return m ? { code: m[1].trim().toUpperCase(), slot: Number(m[2]) as 1 | 2 | 3 } : { code: base.toUpperCase(), slot: 1 };
}

async function shrink(file: File): Promise<File> {
  if (file.size <= 1_500_000 && file.type !== 'image/heic') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

export function CatalogPhotoUpload() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState<'' | 'matching' | 'uploading'>('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const classify = (list: Entry[], rep: boolean) => {
    const seen = new Set<string>();
    return list.map((e) => {
      if (['saved', 'skipped', 'failed'].includes(e.status)) return e;
      if (!/^image\//.test(e.file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(e.file.name)) return { ...e, status: 'not an image' as Status };
      if (!e.item) return { ...e, status: 'not found' as Status };
      const key = `${e.item.id}:${e.slot}`;
      if (seen.has(key)) return { ...e, status: 'repeated' as Status };
      seen.add(key);
      const col = e.slot === 1 ? e.item.photo_path : e.slot === 2 ? e.item.photo_path_2 : e.item.photo_path_3;
      return { ...e, status: (col && !rep ? 'has photo' : 'ready') as Status };
    });
  };

  async function pick(files: FileList | null) {
    setError(''); setDone(false);
    if (!files?.length) return;
    const list: Entry[] = Array.from(files).map((file) => ({ file, ...parseName(file.name), status: 'ready' }));
    setBusy('matching');
    try {
      const matches = await matchPhotoCodesAction(list.map((e) => e.code));
      const byCode = new Map(matches.map((m) => [m.item_code, m]));
      setEntries(classify(list.map((e) => ({ ...e, item: byCode.get(e.code) })), replace));
    } catch (e) { setError(errorText(e) || 'Unable to match the files.'); }
    setBusy('');
  }

  async function upload() {
    setError(''); setBusy('uploading');
    const work = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.status === 'ready');
    const setOne = (i: number, patch: Partial<Entry>) => setEntries((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    let next = 0;
    const worker = async () => {
      while (next < work.length) {
        const { e, i } = work[next++];
        try {
          const fd = new FormData();
          fd.set('item_id', e.item!.id); fd.set('slot', String(e.slot)); fd.set('replace', replace ? 'true' : 'false');
          fd.set('file', await shrink(e.file));
          const r = await uploadCatalogPhotoAction(fd);
          setOne(i, { status: r });
        } catch (err) { setOne(i, { status: 'failed', note: errorText(err) || 'Upload failed.' }); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    try { await photoUploadDoneAction(); } catch { /* the photos are saved; only the page refresh failed */ }
    setBusy(''); setDone(true);
  }

  const count = (s: Status) => entries.filter((e) => e.status === s).length;
  const ready = count('ready');
  const tone: Record<Status, string> = { ready: 'text-slate-700', 'has photo': 'text-amber-700', 'not found': 'text-red-700', 'not an image': 'text-red-700', repeated: 'text-amber-700', saved: 'text-green-700', skipped: 'text-amber-700', failed: 'text-red-700' };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Name each photo after the item&apos;s <b>Item Code</b> (from Export CSV): <code>PA-0123.jpg</code> is photo 1, <code>PA-0123_2.jpg</code> photo 2, <code>PA-0123_3.jpg</code> photo 3. JPG, PNG or WebP; large photos are made smaller automatically before upload.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={!!busy} onChange={(e) => pick(e.target.files)} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={replace} disabled={!!busy} onChange={(e) => { setReplace(e.target.checked); setEntries((cur) => classify(cur.map((x) => (x.status === 'has photo' || x.status === 'ready' ? { ...x, status: 'ready' } : x)), e.target.checked)); }} /> Replace photos the items already have</label>
      </div>
      {busy === 'matching' && <p className="text-xs text-slate-500">Matching file names to Item Codes…</p>}
      {error && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      {entries.length > 0 && (
        <>
          <div className="text-xs text-slate-600">
            {entries.length} file(s): {ready} to upload
            {count('saved') ? `, ${count('saved')} saved` : ''}{count('has photo') ? `, ${count('has photo')} already have a photo (tick Replace to overwrite)` : ''}
            {count('not found') ? `, ${count('not found')} with no matching Item Code` : ''}{count('repeated') ? `, ${count('repeated')} repeated` : ''}
            {count('not an image') ? `, ${count('not an image')} not images` : ''}{count('failed') ? `, ${count('failed')} failed` : ''}
          </div>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left"><tr><th className="p-1">File</th><th className="p-1">Item</th><th className="p-1">Photo</th><th className="p-1">Status</th></tr></thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-1">{e.file.name}</td>
                    <td className="p-1">{e.item ? `${e.item.item_code} — ${e.item.item_name}${e.item.active ? '' : ' (deactivated)'}` : <span className="text-slate-400">{e.code}</span>}</td>
                    <td className="p-1">{e.slot}</td>
                    <td className={`p-1 ${tone[e.status]}`}>{e.status}{e.note ? `: ${e.note}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="button" disabled={!!busy || ready === 0} onClick={upload}>
              {busy === 'uploading' ? `Uploading… ${entries.filter((e) => ['saved', 'skipped', 'failed'].includes(e.status)).length} done` : `Upload ${ready} photo(s)`}
            </button>
            {done && <span className="text-xs text-green-700">Finished. Failed files can be picked again.</span>}
          </div>
          {busy === 'uploading' && <p className="text-xs text-amber-700">Keep this window open until it finishes.</p>}
        </>
      )}
    </div>
  );
}
