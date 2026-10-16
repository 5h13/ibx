'use client';
// Build 119 — Paste list: paste a client's list, check each line's catalog match, add them all at once.
// Used by Create Quotation and the agent app's order. Each screen decides what "add" does with the lines.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { parsePastedList } from './pasteParse';
import { readFileTextTurned } from './readFileText';
import { pasteMatchAction, pasteRememberAction, type PasteCandidate } from './pasteActions';

export type PastedPick = { item_id: string; item_code: string; item_name: string; unit: string | null; quantity: number; text: string; price?: number | null };
export type PastedMissing = { text: string; quantity: number };
type Row = { key: number; text: string; raw: string; quantity: string; price: number | null; qtyFound: boolean; candidates: PasteCandidate[]; pick: string; status: 'matched' | 'choose' | 'none' };

const SAMPLE = 'innova evaporator old - 2\ncabin innova - 1\nexp valve 9a96 - 2';

export function PasteListPanel({ businessId = null, onAdd, onClose, allowMissing = false, missingLabel = 'Add as "not in catalog"', onlyItems = null, title = 'Paste list', hint }: {
  businessId?: string | null;
  /** Build 119: match only within these catalog items (e.g. the items on a PO when receiving) */
  onlyItems?: string[] | null;
  title?: string;
  hint?: string;
  onAdd: (picks: PastedPick[], missing: PastedMissing[]) => void;
  onClose: () => void;
  /** offer to add unmatched lines (e.g. as "not in catalog" quotation lines) */
  allowMissing?: boolean;
  missingLabel?: string;
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [reading, setReading] = useState('');
  // Build 119: text from a picture (JPG / PNG) or PDF, read on this device, lands in the box to be checked.
  // Build 120: the picture is turned upright automatically; "Turn and read again" if it still reads wrong.
  const [last, setLast] = useState<{ file: File; turn: 0 | 90 | 180 | 270; before: string; got: string } | null>(null);
  const readFile = async (file: File | null | undefined, turn: 0 | 90 | 180 | 270 | 'auto' = 'auto', before?: string) => {
    if (!file) return;
    setError(''); setReading('Starting…');
    try {
      const base = before ?? text;
      const r = await readFileTextTurned(file, setReading, turn);
      const t = r.text.trim();
      if (!t) setError('No text found in that file.');
      const merged = t ? (base.trim() ? `${base.trim()}\n${t}` : t) : base;
      setText(merged);
      setLast(r.turn === null ? null : { file, turn: r.turn, before: base, got: merged });
    } catch (e) { setError(errorText(e)); }
    setReading('');
  };
  const turnAgain = () => { if (last) readFile(last.file, (((last.turn + 90) % 360) as 0 | 90 | 180 | 270), last.before); };
  const onPaste = (e: React.ClipboardEvent) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); readFile(f); }
  };

  const read = () => start(async () => {
    setError('');
    const lines = parsePastedList(text);
    if (!lines.length) { setError('Nothing to read: paste one item per line.'); return; }
    try {
      const got = await pasteMatchAction(lines.map((l) => l.text), businessId, onlyItems);
      setRows(lines.map((l, i) => {
        const c = got[i]?.candidates ?? [];
        const top = c[0];
        // a weak best match (fewer than half of the client's words) is not picked for him: skip until chosen
        // Build 120: a supplier's wording carries extra words ("0.71mm / 0.028\" x 15M (standard)"), so a match on the
        // size plus a word (e.g. "soft drawn 1/4") is also taken as a real match.
        const sized = !!top && top.matched.length >= 2 && top.matched.some((w) => /\d/.test(w));
        // clear: remembered, the only candidate, or clearly ahead of the next one with every word (or the size) matched
        const clear = !!top && (top.remembered || c.length === 1 || ((top.missed.length === 0 || sized) && (c[1]?.score ?? -1) < top.score));
        const weak = !!top && !top.remembered && !sized && top.matched.length * 2 < top.matched.length + top.missed.length;
        return { key: i, text: l.text, raw: l.raw, quantity: String(l.quantity), price: l.price ?? null, qtyFound: l.qtyFound, candidates: c,
                 pick: top && !weak ? top.item_id : allowMissing && !top && (got[i]?.words?.length ?? 0) > 0 ? 'missing' : 'skip', status: !top ? 'none' : clear && !weak ? 'matched' : 'choose' };
      }));
    } catch (e) { setError(errorText(e)); }
  });
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const add = () => start(async () => {
    setError('');
    const rs = rows ?? [];
    const bad = rs.find((r) => r.pick && r.pick !== 'skip' && !(Number(r.quantity) >= 1 && Number.isInteger(Number(r.quantity))));
    if (bad) { setError(`"${bad.text}": the quantity must be a whole number (1 or more).`); return; }
    const picks: PastedPick[] = []; const missing: PastedMissing[] = []; const remember: { phrase: string; item_id: string }[] = [];
    for (const r of rs) {
      if (!r.pick || r.pick === 'skip') continue;
      if (r.pick === 'missing') { missing.push({ text: r.text, quantity: Number(r.quantity) }); continue; }
      const c = r.candidates.find((x) => x.item_id === r.pick);
      if (!c) continue;
      picks.push({ item_id: c.item_id, item_code: c.item_code, item_name: c.item_name, unit: c.unit, quantity: Number(r.quantity), text: r.text, price: r.price });
      remember.push({ phrase: r.text, item_id: c.item_id });
    }
    if (!picks.length && !missing.length) { setError('Nothing chosen to add.'); return; }
    pasteRememberAction(businessId, remember).catch(() => undefined);   // learning the client's words never blocks adding
    onAdd(picks, missing);
  });

  const counts = rows ? { matched: rows.filter((r) => r.status === 'matched').length, choose: rows.filter((r) => r.status === 'choose').length, none: rows.filter((r) => r.status === 'none').length } : null;
  const adding = rows ? rows.filter((r) => r.pick && r.pick !== 'skip').length : 0;

  return (
    <div className="space-y-3 rounded-lg border bg-white p-3 text-sm">
      <div className="flex items-center justify-between"><span className="font-semibold">{title}</span><button type="button" className="text-xs underline" onClick={onClose}>Close</button></div>
      {!rows ? (
        <>
          <p className="text-xs text-slate-500">{hint ?? <>Paste the client&apos;s message — one item per line, with the quantity before or after it (e.g. &quot;cabin innova - 1&quot;, &quot;2pcs blower motor innova&quot;, &quot;fan motor vios x2&quot;) — or upload a screenshot, photo or PDF of the list.</>}</p>
          <textarea className="input min-h-[9rem] w-full font-mono text-xs" placeholder={SAMPLE} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} autoFocus />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="button" disabled={pending || !!reading || !text.trim()} onClick={read}>{pending ? 'Matching…' : 'Read list'}</button>
            <label className={`button-secondary cursor-pointer ${reading ? 'pointer-events-none opacity-60' : ''}`}>
              Upload image / PDF
              <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {reading && <span className="text-xs text-slate-500">{reading}</span>}
            {!reading && last && last.got === text && <button type="button" className="text-xs underline" onClick={turnAgain} title="Use this when the text above is gibberish">Picture read wrong? Turn ↻ and read again</button>}
          </div>
          <p className="text-[11px] text-slate-500">Pictures and PDFs are read on this device (nothing is uploaded). Check the text above — fix any misread word — then Read list. A screenshot can also be pasted straight into the box (Ctrl+V).</p>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-600">{counts!.matched} matched · <span className={counts!.choose ? 'text-amber-700' : ''}>{counts!.choose} to choose</span> · <span className={counts!.none ? 'text-red-700' : ''}>{counts!.none} not found</span>. Check each line, then add.</p>
          <div className="max-h-[50vh] overflow-auto">
            <table className="m-cards w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-1">Client wrote</th><th className="p-1">Catalog item</th><th className="w-20 p-1">Qty</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const c = r.candidates.find((x) => x.item_id === r.pick);
                  return (
                    <tr key={r.key} className="border-b align-top">
                      <td className="p-1"><div>{r.text}</div>
                        <span className={`rounded px-1 text-[11px] ${r.status === 'matched' ? 'bg-emerald-100 text-emerald-800' : r.status === 'choose' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                          {r.status === 'matched' ? (c?.remembered ? 'Matched (remembered)' : 'Matched') : r.status === 'choose' ? 'Choose one' : 'Not found'}</span></td>
                      <td className="p-1">
                        <select className="input w-full" value={r.pick} onChange={(e) => set(r.key, { pick: e.target.value, status: e.target.value === 'skip' || e.target.value === 'missing' ? r.status : 'matched' })}>
                          {r.candidates.map((x) => <option key={x.item_id} value={x.item_id}>{x.item_name} · {x.item_code}{x.remembered ? ' ★' : ''}</option>)}
                          {allowMissing && <option value="missing">{missingLabel}</option>}
                          <option value="skip">— skip this line —</option>
                          {!r.candidates.length && !allowMissing && <option value="">— not found —</option>}
                        </select>
                        {c && c.missed.length > 0 && <div className="text-[11px] text-slate-500">not in this item: {c.missed.join(', ')}</div>}
                      </td>
                      <td className="p-1"><input className={`input ${r.qtyFound ? '' : 'border-amber-400'}`} type="number" min="1" step="1" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} title={r.qtyFound ? undefined : 'No quantity in the message — 1 assumed'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="button" disabled={pending || !adding} onClick={add}>Add {adding} line{adding === 1 ? '' : 's'}</button>
            <button type="button" className="button-secondary" onClick={() => setRows(null)}>Edit the pasted text</button>
          </div>
          <p className="text-[11px] text-slate-500">Your choices are remembered for this store, so the same words match directly next time (★).</p>
        </>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
