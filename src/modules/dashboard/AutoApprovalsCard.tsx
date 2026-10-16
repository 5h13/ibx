// Build 113 — MODE-01: what the system (or one approver in one step) approved this week, for the
// Business Admin and Super Admin. Under a mode without a second person these are the documents to look over.
type Row = { at: string; action: string; table: string; id: string; point: string; mode_label: string; by: string | null; number: string | null };
const KIND: Record<string, string> = {
  sales_quotations: 'Quotation', sales_orders: 'Sales order', purchase_requisitions: 'PR', purchase_orders: 'PO',
  finance_supplier_payments: 'Supplier payment', logistics_receipts: 'Goods receipt', expenses: 'Expense',
};
export function AutoApprovalsCard({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <section className="mt-6 rounded-xl border bg-white p-4">
      <h3 className="font-semibold">Approved without a second person — last 7 days</h3>
      <p className="mb-2 text-xs text-slate-500">Auto-approved by the store&apos;s operating mode, or reviewed and approved in one step. Each document&apos;s record shows the mode that allowed it.</p>
      <table className="m-cards w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">When</th><th className="p-2">Document</th><th className="p-2">How</th><th className="p-2">By</th></tr></thead>
        <tbody>
          {rows.slice(0, 50).map((r) => (
            <tr key={`${r.table}-${r.id}-${r.at}`} className="border-b">
              <td className="p-2 whitespace-nowrap">{new Date(r.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td className="p-2">{KIND[r.table] ?? r.table} {r.number ? <span className="font-mono text-xs">{r.number}</span> : null}</td>
              <td className="p-2">{r.action === 'auto_approved' ? `Auto-approved · ${r.mode_label}` : `One-step approval · ${r.mode_label}`}</td>
              <td className="p-2">{r.by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <p className="mt-1 text-xs text-slate-500">Showing the latest 50 of {rows.length}.</p>}
    </section>
  );
}

// Build 116 — MODE-01 part 2: exceptions that went through without a second person (warned on the record).
type Warn = { at: string; kind: string; table: string; id: string; document: string | null; detail: any; mode_label: string; store: string; by: string | null };
const REASON: Record<string, string> = { below_floor: 'below the 7% floor', no_cost: 'no cost on record', late_entry: 'late entry', reserved_stock: 'took reserved stock' };
const peso = (n: any) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function warnText(w: Warn) {
  const d = w.detail ?? {};
  if (w.kind === 'counter_sale') return `Counter sale ${peso(d.total)}: ${(d.reasons ?? []).map((r: string) => REASON[r] ?? r).join(', ')}${d.late_reason ? ` (late: ${d.late_reason})` : ''}`;
  if (w.kind === 'closing_variance') return `Daily closing ${d.date}: counted ${peso(d.counted_cash)} vs expected ${peso(d.expected_cash)} — ${Number(d.variance) < 0 ? 'short' : 'over'} ${peso(Math.abs(Number(d.variance)))}`;
  if (w.kind === 'closing_not_posted') return `Daily closing ${d.date} could not be approved automatically: ${d.error}`;
  if (w.kind === 'quote_below_floor') return `Quotation approved with ${d.lines_below_floor} line(s) below the floor`;
  return w.kind;
}
export function WarningsCard({ rows }: { rows: Warn[] }) {
  if (!rows.length) return null;
  return (
    <section className="mt-6 rounded-xl border border-amber-300 bg-white p-4">
      <h3 className="font-semibold">Exceptions to review — last 7 days</h3>
      <p className="mb-2 text-xs text-slate-500">Allowed by the store&apos;s operating mode without a second person, and kept on each document&apos;s record.</p>
      <table className="m-cards w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">When</th><th className="p-2">Store</th><th className="p-2">Document</th><th className="p-2">What</th><th className="p-2">By</th></tr></thead>
        <tbody>
          {rows.slice(0, 50).map((w) => (
            <tr key={`${w.table}-${w.id}-${w.at}`} className="border-b">
              <td className="p-2 whitespace-nowrap">{new Date(w.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td className="p-2">{w.store}</td>
              <td className="p-2 font-mono text-xs">{w.document ?? '—'}</td>
              <td className="p-2">{warnText(w)} <span className="text-xs text-slate-500">· {w.mode_label}</span></td>
              <td className="p-2">{w.by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
