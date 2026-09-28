'use client';

// Build 74 — one payment (or refund) line, shared by the sale, order DR, AR
// collection and return forms.
//   SF-04: for cash, the amount the customer handed over (tendered); the
//          amount applied is capped at what is due and the change is shown.
//          Tendered and change are recorded on the payment, not printed on the DR.
//   SF-27: for a check, the bank, the check number (reference) and the date
//          on the check (a later date = post-dated), and who issued it.

import { AccountPicker } from './accountsContext';
import { METHODS, num, peso, r2, type Pay } from './storefrontShared';

export function PayRow({ p, set, remove, refund = false, due }: {
  p: Pay; set: (patch: Partial<Pay>) => void; remove: () => void; refund?: boolean;
  /** cash still due before this line — typing the tendered amount fills the amount applied up to this */
  due?: number;
}) {
  const methods = refund ? METHODS.filter((m) => m.v !== 'check') : METHODS;
  const tendered = num(p.tendered ?? '');
  const change = p.method === 'cash' && Number.isFinite(tendered) && Number.isFinite(num(p.amount)) ? r2(tendered - num(p.amount)) : null;
  return (
    <div className="grid grid-cols-12 gap-2 rounded border border-slate-100 p-2">
      <select className="input col-span-3" value={p.method} aria-label="Method"
        onChange={(e) => set({ method: e.target.value as Pay['method'], account: undefined, tendered: '', check_bank: '', check_date: '', issuer: '' })}>
        {methods.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
      </select>
      <input className="input col-span-3" type="number" min="0" step="0.01" placeholder={p.method === 'cash' && !refund ? 'Amount applied' : 'Amount'} aria-label="Amount"
        value={p.amount} onChange={(e) => set({ amount: e.target.value })} />
      <input className="input col-span-5" aria-label="Reference"
        placeholder={p.method === 'cash' ? 'Reference (optional)' : p.method === 'check' ? 'Check number *' : 'Reference no. (required)'}
        value={p.reference} onChange={(e) => set({ reference: e.target.value })} />
      <button type="button" className="button-secondary col-span-1" onClick={remove} aria-label="Remove">✕</button>
      {p.method === 'cash' && !refund && (
        <div className="col-span-12 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <label className="flex items-center gap-2">Cash tendered
            <input className="input w-32" type="number" min="0" step="0.01" value={p.tendered ?? ''}
              onChange={(e) => {
                const t = e.target.value;
                const patch: Partial<Pay> = { tendered: t };
                if (due !== undefined && Number.isFinite(num(t)) && due > 0) patch.amount = String(r2(Math.min(num(t), due)));
                set(patch);
              }} />
          </label>
          {change !== null && change > 0 && <span>Change to give <b className="text-emerald-700">{peso(change)}</b></span>}
          {change !== null && change < 0 && <span className="text-red-700">Tendered is less than the amount applied</span>}
          <span className="text-slate-400">Recorded on the sale, not printed on the DR.</span>
        </div>
      )}
      {p.method === 'check' && (
        <div className="col-span-12 grid grid-cols-12 gap-2">
          <input className="input col-span-4" placeholder="Bank *" aria-label="Bank of the check" value={p.check_bank ?? ''} onChange={(e) => set({ check_bank: e.target.value })} />
          <label className="col-span-3 text-xs text-slate-600">Date on the check *
            <input className="input" type="date" value={p.check_date ?? ''} onChange={(e) => set({ check_date: e.target.value })} /></label>
          <input className="input col-span-5" placeholder="Issued by (name on the check)" aria-label="Issuer" value={p.issuer ?? ''} onChange={(e) => set({ issuer: e.target.value })} />
          {p.check_date && p.check_date > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()) &&
            <p className="col-span-12 text-xs text-amber-700">Post-dated: kept in Checks on hand and deposited on or after {p.check_date}.</p>}
        </div>
      )}
      <AccountPicker method={p.method} value={p.account} onChange={(id) => set({ account: id || undefined })} refund={refund} />
    </div>
  );
}
