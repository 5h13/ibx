'use client';

// Build 74 — SF-01 (f): the Warehouse confirms the physical release of DRs
// issued at the Storefront from sales orders. The stock leaves inventory at
// this point (from the store location, or another location chosen here).
// Build 78: each line shows the lot to pick.

import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { releaseDrAction } from './actions';

type Dr = { sale_id: string; dr_number: string; sale_date: string; order_number: string; customer: string; delivery_address: string | null; location: string; hardcopy_dr_no?: string | null;
  lines: { description: string; quantity: number; unit: string | null; service: boolean; lot_code?: string | null }[] };

export function DrReleasePanel({ drs, locations }: { drs: Dr[]; locations: { id: string; location_code: string; location_name: string }[] }) {
  const [msg, setMsg] = useState('');
  const [loc, setLoc] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div>
        <h3 className="font-semibold">DRs to release (from the Storefront)</h3>
        <p className="text-sm text-slate-500">DRs issued from sales orders. Confirm when the items physically leave; the stock is issued then.</p>
      </div>
      {msg && <div className="rounded bg-slate-100 px-3 py-2 text-sm">{msg}</div>}
      {drs.length === 0 && <p className="text-sm text-slate-500">Nothing waiting for release.</p>}
      {drs.map((d) => (
        <div key={d.sale_id} className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 text-sm">
          <div>
            <div className="font-medium">{d.dr_number}{d.hardcopy_dr_no ? ` (hardcopy ${d.hardcopy_dr_no})` : ''} · {d.order_number} · {d.customer} · {d.sale_date}</div>
            {d.delivery_address && <div className="text-xs text-slate-500">Deliver to: {d.delivery_address}</div>}
            <div className="text-xs text-slate-600">{d.lines.filter((l) => !l.service && Number(l.quantity) > 0).map((l) => `${Number(l.quantity)} ${l.unit ?? ''} ${l.description}${l.lot_code ? ` (lot ${l.lot_code})` : ''}`).join(' · ') || 'Services only'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-56" value={loc[d.sale_id] ?? ''} onChange={(e) => setLoc({ ...loc, [d.sale_id]: e.target.value })} aria-label="Release from">
              <option value="">From the store: {d.location}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.location_code} — {l.location_name}</option>)}
            </select>
            <button className="button" disabled={pending} onClick={() => start(async () => {
              try { const r = await releaseDrAction(d.sale_id, loc[d.sale_id] || null); setMsg(`${r.dr_number} released${r.order_complete ? ' — the order is complete' : ''}.`); }
              catch (e) { setMsg(errorText(e)); }
            })}>Confirm release</button>
            <a className="button-secondary" href={`/sales/storefront/${d.sale_id}/dr`} target="_blank" rel="noreferrer">DR</a>
          </div>
        </div>
      ))}
    </section>
  );
}
