'use client';
// Build 113 — MODE-01: each store's operating mode. Full / Skeletal / Single-operator are templates;
// Custom lets the Super Admin set each approval point. A change applies to new documents only.
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { setOperatingModeAction, type ModeKey, type PointSetting } from './actions';

const MODES: { key: ModeKey; label: string; text: string }[] = [
  { key: 'full', label: 'Full multi-department', text: 'Prepare → review → approve, by different people (today\'s flow).' },
  { key: 'skeletal', label: 'Skeletal manning', text: 'Prepare → approve: an approver\'s review also approves. Still a second person.' },
  { key: 'single', label: 'Single-operator', text: 'One person runs the store: documents are approved by the system when prepared, and recorded as auto-approved.' },
  { key: 'custom', label: 'Custom', text: 'Choose for each approval point.' },
];
const POINTS: { key: string; label: string; part2?: boolean }[] = [
  { key: 'quote', label: 'Quotation' },
  { key: 'sales_order', label: 'Sales order / go-signal' },
  { key: 'pr', label: 'Purchase requisition (PR)' },
  { key: 'po', label: 'Purchase order (PO)' },
  { key: 'supplier_payment', label: 'Supplier payment' },
  { key: 'receiving', label: 'Goods receipt (receiving)' },
  { key: 'expense', label: 'Expenses' },
  { key: 'dr_release', label: 'DR release (Warehouse)', part2: true },
  { key: 'returns', label: 'Returns / refunds', part2: true },
  { key: 'price_exception', label: 'Price / discount exceptions', part2: true },
];
const SETTINGS: { key: PointSetting; label: string }[] = [
  { key: 'two_step', label: 'Review + approve' },
  { key: 'one_step', label: 'Approve in one step' },
  { key: 'auto', label: 'Auto-approve' },
];
const TEMPLATE = (m: ModeKey): PointSetting => (m === 'single' ? 'auto' : m === 'skeletal' ? 'one_step' : 'two_step');

type Store = { business_id: string; code: string; name: string; mode: ModeKey; points: Record<string, PointSetting>; updated_at: string | null; updated_by: string | null };

function StoreCard({ store }: { store: Store }) {
  const [mode, setMode] = useState<ModeKey>(store.mode);
  const [points, setPoints] = useState<Record<string, PointSetting>>(() => Object.fromEntries(POINTS.map((p) => [p.key, store.points?.[p.key] ?? 'two_step'])));
  const [saved, setSaved] = useState({ mode: store.mode, points });
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  const shown = (k: string): PointSetting => (mode === 'custom' ? points[k] : TEMPLATE(mode));
  const changed = mode !== saved.mode || (mode === 'custom' && POINTS.some((p) => points[p.key] !== saved.points[p.key]));
  const pick = (m: ModeKey) => {
    setMsg('');
    if (m === 'custom' && mode !== 'custom') setPoints(Object.fromEntries(POINTS.map((p) => [p.key, TEMPLATE(mode)])));
    setMode(m);
  };
  const save = () => start(async () => {
    setMsg('');
    try {
      const r = await setOperatingModeAction(store.business_id, mode, points);
      setSaved({ mode: r.mode, points: r.points });
      setPoints(r.points);
      setMsg(`Saved. ${store.name} now runs in ${MODES.find((x) => x.key === r.mode)?.label} mode for new documents.`);
    } catch (e) { setMsg(errorText(e)); }
  });
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{store.name} <span className="text-sm font-normal text-slate-500">{store.code}</span></h3>
        <span className="text-xs text-slate-500">{store.updated_at ? `Last changed ${new Date(store.updated_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}${store.updated_by ? ` by ${store.updated_by}` : ''}` : 'Never changed (Full)'}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MODES.map((m) => (
          <label key={m.key} className={`cursor-pointer rounded border p-3 text-sm ${mode === m.key ? 'border-blue-600 bg-blue-50' : ''}`}>
            <input type="radio" className="mr-2" name={`mode-${store.business_id}`} checked={mode === m.key} onChange={() => pick(m.key)} />
            <span className="font-medium">{m.label}</span>
            <div className="mt-1 text-xs text-slate-600">{m.text}</div>
          </label>
        ))}
      </div>
      <table className="m-cards w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Approval point</th><th className="p-2">How it is approved</th></tr></thead>
        <tbody>
          {POINTS.map((p) => (
            <tr key={p.key} className="border-b">
              <td className="p-2">{p.label}{p.part2 && <div className="text-xs text-amber-700">Saved now; takes effect with the next build (Storefront)</div>}</td>
              <td className="p-2">
                {mode === 'custom' ? (
                  <select className="input w-auto" value={points[p.key]} onChange={(e) => setPoints({ ...points, [p.key]: e.target.value as PointSetting })}>
                    {SETTINGS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                ) : (
                  <span className={shown(p.key) === 'auto' ? 'font-medium text-amber-800' : ''}>{SETTINGS.find((s) => s.key === shown(p.key))?.label}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="button" disabled={pending || !changed} onClick={save}>{pending ? 'Saving…' : 'Save mode'}</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </section>
  );
}

export default function OperatingModesManagement({ stores }: { stores: Store[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Operating modes</h2>
        <p className="text-sm text-slate-500">How each store&apos;s documents are approved. Every step still creates its document; the audit trail, document numbers, stock movements and AR / AP are never switched off.
          A change applies to <b>new documents only</b> — a document keeps the rule it was created under. Users and roles are not changed.</p>
      </div>
      {stores.map((s) => <StoreCard key={s.business_id} store={s} />)}
    </div>
  );
}
