'use client';
// Build 90 — Catalog Photos screen: search the catalog, see each item's three
// photo slots, add / replace / remove a photo, or upload many at once.
// Build 141 — Touch up (from 5h13Shops Build 12): a new photo opens the photo editor first (background removed on
// the phone, studio backdrop, size and turn, square 1080 × 1080), or "Use the photo as it is"; a saved photo can be
// touched up too. No store logo is stamped (catalog photos are shared by every store).
import { useState } from 'react';
import { PhotoEditor } from '@/modules/studio/PhotoEditor';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { CatalogPhotoUpload, shrink } from './CatalogPhotoUpload';
import { photoUploadDoneAction, removeCatalogPhotoAction, uploadCatalogPhotoAction } from './catalogItemActions';

type Item = { id: string; item_code: string; item_name: string; category: string | null; generic_item: string | null; brand: string | null; unit: string | null;
  photo_url: string | null; photo_url_2: string | null; photo_url_3: string | null };

export function CatalogPhotosManagement({ items, categories, filters, page, pages, total }: {
  items: Item[]; categories: string[]; filters: { q: string; category: string; missing: boolean }; page: number; pages: number; total: number;
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ item: Item; slot: number; source: File | string } | null>(null);
  const link = (p: number) => `?${new URLSearchParams({ ...(filters.q ? { q: filters.q } : {}), ...(filters.category ? { category: filters.category } : {}), ...(filters.missing ? { missing: '1' } : {}), page: String(p) })}`;

  async function put(item: Item, slot: number, file: File | undefined) {
    if (!file) return;
    setBusy(`${item.id}:${slot}`); setMessage('');
    try {
      const fd = new FormData();
      fd.set('item_id', item.id); fd.set('slot', String(slot)); fd.set('replace', 'true'); fd.set('file', await shrink(file));
      await uploadCatalogPhotoAction(fd);
      await photoUploadDoneAction();
      setMessage(`Photo ${slot} saved for ${item.item_code}.`);
      router.refresh();
    } catch (e) { setMessage(errorText(e) || 'Upload failed.'); }
    setBusy('');
  }
  async function remove(item: Item, slot: number) {
    if (!(await dialog.confirm(`Remove photo ${slot} of ${item.item_code}?`, { tone: 'danger' }))) return;
    setBusy(`${item.id}:${slot}`); setMessage('');
    try { await removeCatalogPhotoAction(item.id, slot); setMessage(`Photo ${slot} removed from ${item.item_code}.`); router.refresh(); }
    catch (e) { setMessage(errorText(e) || 'Unable to remove the photo.'); }
    setBusy('');
  }

  return (
    <div className="space-y-5">
      {editing && (
        <PhotoEditor source={editing.source} title={`${editing.item.item_code} · photo ${editing.slot}`}
          onCancel={() => setEditing(null)}
          onAsIs={typeof editing.source === 'string' ? undefined : () => { const e = editing; setEditing(null); put(e.item, e.slot, e.source as File); }}
          onDone={(f) => { const e = editing; setEditing(null); put(e.item, e.slot, f); }} />
      )}
      <div>
        <h2 className="text-xl font-semibold">Catalog Photos</h2>
        <p className="mt-1 text-sm text-slate-500">Up to three photos per item. Photo 1 is the main photo shown in Product Search. Large photos are shrunk before upload.</p>
      </div>
      {message && <div className="rounded border bg-white p-3 text-sm">{message}</div>}
      <ActionBar>
        <PopupAction label="Upload many photos…" title="Upload product photos" wide><CatalogPhotoUpload /></PopupAction>
      </ActionBar>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3 text-sm">
        <label className="block">Search<input name="q" defaultValue={filters.q} placeholder="Item code, name, brand" className="input mt-1 w-64" /></label>
        <label className="block">Category
          <select name="category" defaultValue={filters.category} className="input mt-1">
            <option value="">All</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="missing" value="1" defaultChecked={filters.missing} /> Missing a photo</label>
        <button className="button">Show</button>
        <span className="pb-2 text-xs text-slate-500">{total.toLocaleString()} item(s)</span>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="p-2">Item code</th><th className="p-2">Item</th><th className="p-2">Category / brand</th>{[1, 2, 3].map((n) => <th key={n} className="p-2">Photo {n}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t align-top">
                <td className="p-2 font-mono text-xs">{it.item_code}</td>
                <td className="p-2">{it.item_name}<div className="text-xs text-slate-500">{it.unit}</div></td>
                <td className="p-2 text-xs text-slate-600">{[it.category, it.generic_item, it.brand].filter(Boolean).join(' · ')}</td>
                {[it.photo_url, it.photo_url_2, it.photo_url_3].map((url, k) => {
                  const slot = k + 1; const working = busy === `${it.id}:${slot}`;
                  return (
                    <td key={slot} className="p-2">
                      <div className="w-28 space-y-1">
                        {url
                          ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${it.item_code} photo ${slot}`} className="h-20 w-28 rounded border object-contain" /></a>
                          : <div className="flex h-20 w-28 items-center justify-center rounded border border-dashed text-xs text-slate-400">No photo</div>}
                        <div className="flex gap-2 text-xs">
                          <label className={`cursor-pointer text-blue-700 underline ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                            {working ? 'Saving…' : url ? 'Replace' : 'Add'}
                            <input type="file" accept="image/*" className="hidden" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) setEditing({ item: it, slot, source: f }); e.target.value = ''; }} />
                          </label>
                          {url && <button type="button" className="text-blue-700 underline disabled:opacity-50" disabled={!!busy} onClick={() => setEditing({ item: it, slot, source: url })}>Touch up</button>}
                          {url && <button type="button" className="text-red-700 underline disabled:opacity-50" disabled={!!busy} onClick={() => remove(it, slot)}>Remove</button>}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No items match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && <a className="button-secondary" href={link(page - 1)}>← Previous</a>}
          <span>Page {page} of {pages}</span>
          {page < pages && <a className="button-secondary" href={link(page + 1)}>Next →</a>}
        </div>
      )}
    </div>
  );
}
