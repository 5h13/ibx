'use client';
import { errorText } from '@/core/errors/appError';
import { useMemo, useState, useTransition } from 'react';
import { createCostCenterAction, updateCostCenterAction } from './actions';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';

type PeriodMode = 'month' | 'quarter' | 'ytd';

function monthLabel(m: number) { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] ?? String(m); }
function quarterOf(m: number) { return Math.ceil(m / 3); }

export function CostCenterManagement({centers,actuals,recovery=[]}:{centers:any[];actuals:any[];recovery?:any[]}){
  const [pending,start]=useTransition();const [msg,setMsg]=useState('');
  const run=(f:()=>Promise<any>)=>start(async()=>{try{setMsg('');await f();setMsg('Saved successfully.')}catch(e:any){setMsg(errorText(e)||'Operation failed.')}});

  // CC-04: monthly/quarterly/YTD OPEX reporting by cost center. Every row in
  // `actuals` carries its month's {year,month} (joined server-side), which
  // is what makes period bucketing possible at all — previously the page
  // only ever showed an unqualified all-time total.
  const years = useMemo(() => {
    const s = new Set<number>(actuals.map((a: any) => a.month?.year).filter((y: any) => typeof y === 'number'));
    if (!s.size) s.add(new Date().getFullYear());
    return [...s].sort((a, b) => b - a);
  }, [actuals]);
  const now = new Date();
  const [mode, setMode] = useState<PeriodMode>('month');
  const [year, setYear] = useState<number>(years[0] ?? now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const quarter = quarterOf(month);

  const inPeriod = (a: any) => {
    const y = a.month?.year, m = a.month?.month;
    if (typeof y !== 'number' || typeof m !== 'number') return false;
    if (y !== year) return false;
    if (mode === 'ytd') return m <= month;
    if (mode === 'quarter') return quarterOf(m) === quarter;
    return m === month;
  };
  const periodActuals = actuals.filter(inPeriod);
  const totals = centers.map(c => ({
    ...c,
    total: periodActuals.filter((x: any) => x.cost_center_id === c.id).reduce((s: number, x: any) => s + Number(x.amount || 0), 0),
    allTimeTotal: actuals.filter((x: any) => x.cost_center_id === c.id).reduce((s: number, x: any) => s + Number(x.amount || 0), 0),
  }));
  const periodOpexTotal = totals.reduce((s, c) => s + c.total, 0);

  // CC-05: compare OPEX recovery (the markup/add-on margin already tracked
  // per catalog category in finance_catalog_pricing_recovery) against the
  // actual OPEX incurred for the same period. There is no per-cost-center
  // link into catalog categories anywhere in the schema, so this is a
  // company-wide comparison, not broken out per cost center — an honest
  // reading of what the data actually supports rather than a fabricated
  // per-center mapping.
  const periodRecoveryTotal = recovery
    .filter((r: any) => {
      const d = r.period_start ? new Date(r.period_start) : null;
      if (!d) return false;
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
      if (y !== year) return false;
      if (mode === 'ytd') return m <= month;
      if (mode === 'quarter') return quarterOf(m) === quarter;
      return m === month;
    })
    .reduce((s: number, r: any) => s + Number(r.gross_pricing_recovery || 0), 0);
  const variance = periodRecoveryTotal - periodOpexTotal;

  const periodLabel = mode === 'month' ? `${monthLabel(month)} ${year}` : mode === 'quarter' ? `Q${quarter} ${year}` : `${year} YTD (through ${monthLabel(month)})`;

  return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Cost Centers</h1><p className="text-sm text-slate-500 mt-1">Finance-owned master for assigning and reporting actual operating expenses. Cost centers are separate from expense categories.</p></div><ActionBar><PopupAction label="+ Add cost center" title="Create cost center" notice={msg}>{(close)=><form action={fd=>run(async()=>{await createCostCenterAction(fd);close()})} className="grid md:grid-cols-4 gap-3"><F l="Code"><input className="input" name="code" required placeholder="WAREHOUSE"/></F><F l="Name"><input className="input" name="name" required/></F><F l="Description"><input className="input" name="description"/></F><button className="button self-end" disabled={pending}>Add</button></form>}</PopupAction></ActionBar>{msg&&<div className="rounded-lg bg-slate-100 px-4 py-2 text-sm">{msg}</div>}

  <section className="rounded-xl border bg-white p-4 space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 className="font-semibold">OPEX by cost center — {periodLabel}</h2>
      <div className="flex flex-wrap gap-2 items-end">
        <F l="View"><select className="input" value={mode} onChange={e=>setMode(e.target.value as PeriodMode)}><option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="ytd">Year-to-date</option></select></F>
        <F l="Year"><select className="input" value={year} onChange={e=>setYear(Number(e.target.value))}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></F>
        {mode!=='ytd' && <F l={mode==='quarter'?'Quarter':'Month'}>
          {mode==='quarter'
            ? <select className="input" value={quarter} onChange={e=>setMonth((Number(e.target.value)-1)*3+1)}>{[1,2,3,4].map(q=><option key={q} value={q}>Q{q}</option>)}</select>
            : <select className="input" value={month} onChange={e=>setMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select>}
        </F>}
        {mode==='ytd' && <F l="Through month"><select className="input" value={month} onChange={e=>setMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></F>}
      </div>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="p-3">Code</th><th className="p-3">Cost center</th><th className="p-3">Description</th><th className="p-3">{periodLabel} actual</th><th className="p-3">All-time actual</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>{totals.map(c=><tr key={c.id} className="border-b last:border-0"><td className="p-3 font-medium">{c.code}</td><td className="p-3">{c.name}</td><td className="p-3">{c.description||'—'}</td><td className="p-3">₱{c.total.toLocaleString(undefined,{minimumFractionDigits:2})}</td><td className="p-3 text-slate-400">₱{c.allTimeTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</td><td className="p-3">{c.active?'Active':'Inactive'}</td><td className="p-3"><form action={fd=>run(()=>updateCostCenterAction(fd))} className="flex gap-2 items-center"><input type="hidden" name="id" value={c.id}/><input className="input w-36" name="name" defaultValue={c.name}/><input className="input w-44" name="description" defaultValue={c.description||''}/><label className="text-xs flex gap-1 items-center"><input type="checkbox" name="active" defaultChecked={c.active}/> active</label><button className="button-secondary" disabled={pending}>Save</button></form></td></tr>)}
    <tr className="border-t-2 font-semibold"><td className="p-3" colSpan={3}>Total</td><td className="p-3">₱{periodOpexTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</td><td colSpan={3}/></tr>
    </tbody></table></div>
  </section>

  <section className="rounded-xl border bg-white p-4 space-y-2">
    <h2 className="font-semibold">OPEX recovery vs. actual — {periodLabel}</h2>
    <p className="text-xs text-slate-500">Company-wide comparison: gross margin recovered through category/service pricing add-ons (from the catalog pricing recovery view) against total actual OPEX across all cost centers for the same period. The catalog does not carry a per-cost-center breakdown, so this comparison is not split by cost center.</p>
    <div className="grid sm:grid-cols-3 gap-3">
      <div className="rounded-lg border p-3"><div className="text-xs text-slate-500">Pricing recovery</div><div className="text-lg font-semibold">₱{periodRecoveryTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</div></div>
      <div className="rounded-lg border p-3"><div className="text-xs text-slate-500">Actual OPEX</div><div className="text-lg font-semibold">₱{periodOpexTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</div></div>
      <div className="rounded-lg border p-3"><div className="text-xs text-slate-500">Variance (recovery − actual)</div><div className={`text-lg font-semibold ${variance>=0?'text-emerald-700':'text-red-600'}`}>₱{variance.toLocaleString(undefined,{minimumFractionDigits:2})}</div></div>
    </div>
  </section>
  </div>;
}
function F({l,children}:{l:string;children:React.ReactNode}){return <div><label className="label">{l}</label>{children}</div>}
