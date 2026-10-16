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
