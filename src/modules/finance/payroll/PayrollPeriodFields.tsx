'use client';
// Build 125 (UIA-43): a payroll period is normally made from an attendance period HR has locked,
// so pay always matches reviewed attendance. Picking one fills the name and dates.
import { useState } from 'react';

type AP = { id: string; name: string; start_date: string; end_date: string; status: string };

export function PayrollPeriodFields({ attendancePeriods }: { attendancePeriods: AP[] }) {
  const [v, setV] = useState({ name: '', start: '', end: '', freq: 'semi_monthly' });
  const pick = (id: string) => {
    const p = attendancePeriods.find((x) => x.id === id);
    if (p) setV({ name: p.name, start: p.start_date, end: p.end_date, freq: p.start_date.slice(8) === '01' && p.end_date.slice(8) !== '15' ? 'monthly' : 'semi_monthly' });
  };
  return (
    <>
      <div className="md:col-span-5">
        <label className="label">From attendance period</label>
        <select className="input" defaultValue="" onChange={(e) => pick(e.target.value)}>
          <option value="">Choose a period HR has locked…</option>
          {attendancePeriods.map((p) => <option key={p.id} value={p.id} disabled={p.status !== 'locked'}>{p.name} ({p.start_date} – {p.end_date}){p.status !== 'locked' ? ' — not locked yet' : ''}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">Payroll runs only on dates whose attendance HR has locked.</p>
      </div>
      <div><label className="label">Period name</label><input name="period_name" className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Oct 1–15, 2026" required /></div>
      <div><label className="label">Start</label><input name="start_date" type="date" className="input" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required /></div>
      <div><label className="label">End</label><input name="end_date" type="date" className="input" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} required /></div>
      <div><label className="label">Pay date</label><input name="pay_date" type="date" className="input" /></div>
      <div><label className="label">Frequency</label><select name="frequency" className="input" value={v.freq} onChange={(e) => setV({ ...v, freq: e.target.value })}><option value="semi_monthly">semi_monthly</option><option value="monthly">monthly</option><option value="weekly">weekly</option><option value="daily">daily</option></select></div>
    </>
  );
}
