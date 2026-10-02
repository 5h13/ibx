'use client';
// PROC-01 (Build 77) — Procurement dashboard (Finance → Procurement overview).
// Every figure comes from procurement_dashboard() in the database, scoped to
// the viewer's store (the Super Admin: the "Acting as" store, or all stores),
// so nothing is computed over capped client lists. Each figure drills down:
// PR/PO counts and values open the PR or PO list filtered to exactly the
// records behind the figure; action-queue rows open the record itself.

import { useEffect, useState } from 'react';
import { errorText } from '@/core/errors/appError';
import { getProcurementDashboardAction } from './actions';

export type DrillFilter = { tab: 'pr' | 'po'; label: string; ids?: string[]; status?: string };
type Period = 'month' | 'quarter' | 'ytd';
type Bucket = { status?: string; issuance_status?: string; count: number; value: number; ids: string[] };
type Dashboard = {
  period: { key: string; start: string; end: string };
  scope: { business_code: string | null; all_businesses: boolean };
  roles: { preparer: boolean; reviewer: boolean; approver: boolean };
  totals: { active_suppliers: number; pr_count: number; pr_value: number; pr_ids: string[]; po_count: number; po_value: number; po_ids: string[]; committed_value: number; committed_ids: string[] };
  pr_pipeline: Bucket[]; po_pipeline: Bucket[]; po_issuance: Bucket[];
  cycle: { pr_to_po_days: number | null; pr_to_po_count: number; pr_to_po_ids: string[]; po_to_receipt_days: number | null; po_to_receipt_count: number; po_to_receipt_ids: string[] };
  spend_by_supplier: { supplier_id: string; supplier_code: string; legal_name: string; count: number; amount: number; ids: string[] }[];
  spend_by_category: { category: string; lines: number; amount: number; ids: string[] }[];
  action_queue: { total: number; items: { kind: 'pr' | 'po'; id: string; ref: string; status: string; step: string; label: string; amount: number | null; created_at: string }[] };
};

const peso = (v: unknown) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERIOD_LABEL: Record<Period, string> = { month: 'this month', quarter: 'this quarter', ytd: 'year to date' };
const ISSUANCE_LABEL: Record<string, string> = { not_approved: 'Not yet approved', awaiting_issue: 'Approved — awaiting issue', issued: 'Issued to supplier', acknowledged: 'Acknowledged by supplier', closed: 'Closed', cancelled: 'Cancelled' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const days = (v: number | null) => (v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} day${Number(v) === 1 ? '' : 's'}`);

export function ProcurementDashboard({ pricingRecovery, onDrill, onOpen, onSupplier, onTab }: {
  pricingRecovery: any[];
  onDrill: (f: DrillFilter) => void;
  onOpen: (type: 'pr' | 'po', id: string) => void;
  onSupplier: (supplierId: string) => void;
  onTab?: (tab: string) => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    getProcurementDashboardAction(period)
      .then((d) => { if (alive) { setData(d as Dashboard); setLoading(false); } })
      .catch((e) => { if (alive) { setError(errorText(e) || 'Unable to load the procurement dashboard.'); setLoading(false); } });
    return () => { alive = false; };
  }, [period]);

  const when = PERIOD_LABEL[period];
  const start = data ? new Date(data.period.start) : null;
  const now = new Date();
  const recovery = start ? pricingRecovery.filter((x: any) => { const d = new Date(x.period_start); return d >= start && d <= now; }) : [];
  const roleText = data ? (['preparer', 'reviewer', 'approver'] as const).filter((r) => data.roles[r]).join(', ') || 'none' : '';

  const Tile = ({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) => {
    const body = <><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div>{sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}</>;
    return onClick
      ? <button type="button" onClick={onClick} className="rounded-xl border bg-white p-5 text-left transition hover:border-blue-400 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{body}<div className="mt-2 text-xs text-blue-700">View records →</div></button>
      : <div className="rounded-xl border bg-white p-5">{body}</div>;
  };
  const Row = ({ label, count, value, onClick }: { label: string; count: number; value?: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <span>{label}</span><span className="whitespace-nowrap"><span className="font-medium">{count}</span>{value && <span className="ml-2 text-xs text-slate-500">{value}</span>}</span>
    </button>
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Procurement Dashboard</h3>
          <p className="text-sm text-slate-500">
            {data ? (data.scope.all_businesses ? 'All stores' : data.scope.business_code ?? 'No store selected') : '…'} · {when}. Live PR/PO records; click any figure to see the records behind it.
          </p>
        </div>
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Dashboard period">
          <option value="month">Monthly</option><option value="quarter">Quarterly</option><option value="ytd">Year to date</option>
        </select>
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!data && loading && <div className="text-sm text-slate-400">Loading dashboard…</div>}
      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={`PRs ${when}`} value={data.totals.pr_count} sub={`${peso(data.totals.pr_value)} estimated`} onClick={() => onDrill({ tab: 'pr', label: `PRs raised ${when}`, ids: data.totals.pr_ids })} />
            <Tile label={`POs ${when}`} value={data.totals.po_count} sub={`${peso(data.totals.po_value)} order value`} onClick={() => onDrill({ tab: 'po', label: `POs raised ${when}`, ids: data.totals.po_ids })} />
            <Tile label={`Committed spend ${when}`} value={peso(data.totals.committed_value)} sub={`${data.totals.committed_ids.length} approved PO(s)`} onClick={() => onDrill({ tab: 'po', label: `approved POs dated ${when}`, ids: data.totals.committed_ids })} />
            <Tile label="Active suppliers" value={data.totals.active_suppliers} sub="active for this store" onClick={onTab ? () => onTab('suppliers') : undefined} />
            <Tile label="Avg PR → PO" value={days(data.cycle.pr_to_po_days)} sub={`PR raised to PO raised · ${data.cycle.pr_to_po_count} PR(s) converted ${when}`} onClick={data.cycle.pr_to_po_count ? () => onDrill({ tab: 'pr', label: `PRs converted to a PO ${when}`, ids: data.cycle.pr_to_po_ids }) : undefined} />
            <Tile label="Avg PO → receipt" value={days(data.cycle.po_to_receipt_days)} sub={`PO issued to first goods receipt · ${data.cycle.po_to_receipt_count} PO(s) received ${when}`} onClick={data.cycle.po_to_receipt_count ? () => onDrill({ tab: 'po', label: `POs received ${when}`, ids: data.cycle.po_to_receipt_ids }) : undefined} />
            <Tile label="Awaiting your action" value={data.action_queue.total} sub={`your Finance role: ${roleText}`} />
            <Tile label={`Pricing OPEX recovery ${when}`} value={peso(recovery.reduce((n: number, x: any) => n + Number(x.gross_pricing_recovery || 0), 0))} sub="from quotation pricing snapshots" onClick={onTab ? () => onTab('items') : undefined} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border bg-white p-5">
              <h4 className="font-semibold">PR pipeline</h4>
              <div className="mt-3 space-y-1 text-sm">
                {data.pr_pipeline.length ? data.pr_pipeline.map((b) => <Row key={b.status} label={cap(String(b.status))} count={b.count} value={peso(b.value)} onClick={() => onDrill({ tab: 'pr', label: `${b.status} PRs raised ${when}`, ids: b.ids })} />) : <div className="text-slate-500">No PRs {when}.</div>}
                <div className="flex justify-between border-t px-1 pt-2"><span>Estimated value</span><span className="font-medium">{peso(data.totals.pr_value)}</span></div>
              </div>
            </div>
            <div className="rounded-xl border bg-white p-5">
              <h4 className="font-semibold">PO pipeline</h4>
              <div className="mt-3 space-y-1 text-sm">
                {data.po_pipeline.length ? data.po_pipeline.map((b) => <Row key={b.status} label={cap(String(b.status))} count={b.count} value={peso(b.value)} onClick={() => onDrill({ tab: 'po', label: `${b.status} POs raised ${when}`, ids: b.ids })} />) : <div className="text-slate-500">No POs {when}.</div>}
                <div className="flex justify-between border-t px-1 pt-2"><span>Order value</span><span className="font-medium">{peso(data.totals.po_value)}</span></div>
              </div>
              <h5 className="mt-4 text-xs font-semibold uppercase text-slate-500">Issuance</h5>
              <div className="mt-1 space-y-1 text-sm">
                {data.po_issuance.map((b) => <Row key={b.issuance_status} label={ISSUANCE_LABEL[String(b.issuance_status)] ?? cap(String(b.issuance_status))} count={b.count} value={peso(b.value)} onClick={() => onDrill({ tab: 'po', label: `POs ${when}: ${(ISSUANCE_LABEL[String(b.issuance_status)] ?? String(b.issuance_status)).toLowerCase()}`, ids: b.ids })} />)}
                {!data.po_issuance.length && <div className="text-slate-500">—</div>}
              </div>
            </div>
            <div className="rounded-xl border bg-white p-5">
              <h4 className="font-semibold">Action queue</h4>
              <p className="text-xs text-slate-500">Steps your Finance role ({roleText}) can take now, oldest first.</p>
              <div className="mt-3 max-h-72 space-y-1 overflow-auto text-sm">
                {data.action_queue.items.length ? data.action_queue.items.map((q) => (
                  <button key={`${q.kind}-${q.id}`} type="button" onClick={() => onOpen(q.kind, q.id)} className="block w-full rounded border-b px-1 py-1.5 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                    <div className="flex justify-between gap-2"><span className="font-medium">{q.ref}</span><span className="whitespace-nowrap text-xs font-medium text-blue-700">{q.step}</span></div>
                    <div className="flex justify-between gap-2 text-xs text-slate-500"><span className="truncate">{q.label}</span><span className="whitespace-nowrap">{q.amount != null ? peso(q.amount) : ''}</span></div>
                  </button>
                )) : <div className="text-slate-500">Nothing is waiting for your role.</div>}
                {data.action_queue.total > data.action_queue.items.length && <div className="pt-1 text-xs text-slate-500">Showing the oldest {data.action_queue.items.length} of {data.action_queue.total}.</div>}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-5">
              <h4 className="font-semibold">Spend by supplier</h4>
              <p className="text-xs text-slate-500">Approved POs dated {when} (order totals), top 10.</p>
              <SpendBars rows={data.spend_by_supplier.map((x) => ({ key: x.supplier_id, label: `${x.legal_name}`, sub: `${x.supplier_code} · ${x.count} PO(s)`, amount: Number(x.amount),
                onClick: () => onDrill({ tab: 'po', label: `approved POs ${when} — ${x.legal_name}`, ids: x.ids }), extra: <button type="button" className="text-xs text-blue-700 underline" onClick={() => onSupplier(x.supplier_id)}>History</button> }))} />
            </div>
            <div className="rounded-xl border bg-white p-5">
              <h4 className="font-semibold">Spend by category</h4>
              <p className="text-xs text-slate-500">Approved PO lines dated {when}, by catalog category (before tax and other charges).</p>
              <SpendBars rows={data.spend_by_category.map((x) => ({ key: x.category, label: x.category, sub: `${x.lines} line(s)`, amount: Number(x.amount),
                onClick: () => onDrill({ tab: 'po', label: `approved POs ${when} with ${x.category} lines`, ids: x.ids }) }))} />
            </div>
          </div>

          <div className="mt-4 rounded-xl border bg-white p-5">
            <h4 className="font-semibold">Pricing / OPEX recovery</h4>
            <p className="mt-2 text-sm text-slate-500">Configured catalog pricing recovery is shown separately from actual Finance OPEX. Values are derived from approved/sent/accepted quotations carrying pricing snapshots.</p>
            <div className="mt-3 space-y-1 text-sm">
              {recovery.slice(0, 8).map((x: any, i: number) => <div key={i} className="flex justify-between"><span>{x.category}</span><span className="font-medium">{peso(x.gross_pricing_recovery)}</span></div>)}
              {!recovery.length && <span className="text-slate-500">No pricing recovery snapshots {when}.</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SpendBars({ rows }: { rows: { key: string; label: string; sub: string; amount: number; onClick: () => void; extra?: any }[] }) {
  if (!rows.length) return <div className="mt-3 text-sm text-slate-500">No approved purchases in this period.</div>;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <div className="mt-3 space-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <button type="button" onClick={r.onClick} className="min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <div className="flex justify-between gap-2"><span className="truncate font-medium">{r.label}</span><span className="whitespace-nowrap">{peso(r.amount)}</span></div>
            <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-blue-600" style={{ width: `${Math.max(2, (r.amount / max) * 100)}%` }} /></div>
            <div className="mt-0.5 text-xs text-slate-500">{r.sub}</div>
          </button>
          {r.extra}
        </div>
      ))}
    </div>
  );
}
