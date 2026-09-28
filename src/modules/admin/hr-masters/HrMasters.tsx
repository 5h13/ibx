'use client';
import { errorText } from '@/core/errors/appError';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { createHrMasterAction, renameHrMasterAction, setHrMasterActiveAction } from './actions';

type Master = { id: string; name: string; active: boolean };
type Table = 'hr_departments' | 'hr_positions' | 'work_locations';

const SECTIONS: { table: Table; label: string; hint: string }[] = [
  { table: 'hr_departments', label: 'Departments', hint: 'Assigned to employees via the Department field on their profile.' },
  { table: 'hr_positions', label: 'Positions', hint: 'Assigned to employees via the Position field on their profile.' },
  { table: 'work_locations', label: 'Work Locations', hint: 'Assigned to employees via the Work Location field on their profile.' },
];

export default function HrMasters({ departments, positions, workLocations }: { departments: Master[]; positions: Master[]; workLocations: Master[] }) {
  const data: Record<Table, Master[]> = { hr_departments: departments, hr_positions: positions, work_locations: workLocations };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">HR Master Data</h2>
        <p className="text-sm text-slate-500">Standardized Departments, Positions, and Work Locations (U013) — shared across all businesses.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <MasterList key={s.table} table={s.table} label={s.label} hint={s.hint} rows={data[s.table]} />
        ))}
      </div>
    </div>
  );
}

function MasterList({ table, label, hint, rows }: { table: Table; label: string; hint: string; rows: Master[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  async function run(fn: () => Promise<any>) {
    setBusy(true); setError('');
    try { await fn(); router.refresh(); } catch (e) { setError(e instanceof Error ? errorText(e) : 'Operation failed.'); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold">{label}</h3>
        <ActionBar>
          <PopupAction label={`+ Add ${label.toLowerCase().replace(/s$/, '')}`} title={`Add ${label.toLowerCase().replace(/s$/, '')}`} notice={error || null} disabled={busy}>
            {(close) => (
              <form
                onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set('table', table); run(async () => { await createHrMasterAction(fd); close(); }); }}
                className="flex gap-2"
              >
                <input name="name" required autoFocus placeholder={`New ${label.toLowerCase().replace(/s$/, '')} name`} className="flex-1 rounded border px-2 py-1 text-sm" />
                <button disabled={busy} className="rounded bg-slate-900 px-3 py-1 text-sm text-white">Save</button>
                <button type="button" onClick={close} className="rounded border px-3 py-1 text-sm">Cancel</button>
              </form>
            )}
          </PopupAction>
        </ActionBar>
      </div>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-slate-50">
            {editingId === r.id ? (
              <form
                onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set('table', table); fd.set('id', r.id); run(() => renameHrMasterAction(fd)).then(() => setEditingId(null)); }}
                className="flex flex-1 gap-2"
              >
                <input name="name" defaultValue={r.name} required autoFocus className="flex-1 rounded border px-2 py-1 text-sm" />
                <button disabled={busy} className="rounded bg-slate-900 px-2 py-1 text-xs text-white">Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="rounded border px-2 py-1 text-xs">Cancel</button>
              </form>
            ) : (
              <>
                <span className={r.active ? '' : 'text-slate-400 line-through'}>{r.name}</span>
                <span className="flex gap-2">
                  <button disabled={busy} onClick={() => setEditingId(r.id)} className="text-blue-700 hover:underline">Rename</button>
                  <button
                    disabled={busy}
                    onClick={() => { const fd = new FormData(); fd.set('table', table); fd.set('id', r.id); fd.set('active', String(!r.active)); run(() => setHrMasterActiveAction(fd)); }}
                    className={r.active ? 'text-amber-700 hover:underline' : 'text-green-700 hover:underline'}
                  >
                    {r.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-2 py-3 text-center text-slate-400">No {label.toLowerCase()} yet.</li>}
      </ul>
    </div>
  );
}
