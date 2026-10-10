// Build 92 — one agent's commission month (shared by the agent page and the staff statement pop-up).
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pts = (v: unknown) => `${Number(v) > 0 ? '+' : ''}${Number(v ?? 0)} pts`;

export function CommissionStatement({ data: d }: { data: any }) {
  const monthLabel = new Date(d.month).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const toNext = d.next_bracket != null ? Math.max(Number(d.next_bracket) - Number(d.paid_sales), 0) : null;
  const pct = d.next_bracket ? Math.min(100, (Number(d.paid_sales) / Number(d.next_bracket)) * 100) : 100;
  return (
    <div className="space-y-4">
      {d.skipped && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{d.note}</div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{monthLabel} · paid sales</div><div className="text-lg font-semibold">{peso(d.paid_sales)}</div>
          {!d.closed && d.next_bracket != null && <><div className="mt-2 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${pct}%` }} /></div>
            <div className="mt-1 text-xs text-slate-500">{peso(toNext)} more to reach {peso(d.next_bracket)} ({pts(d.next_points)})</div></>}</div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Tier this month</div><div className={`text-lg font-semibold ${Number(d.points) < 0 ? 'text-amber-700' : ''}`}>{pts(d.points)}</div>
          <div className="text-xs text-slate-500">on each category&apos;s rate{d.max_rate ? `, max ${Number(d.max_rate)}%` : ''}</div></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Earned</div><div className="text-lg font-semibold">{peso(d.earned)}</div>
          {d.waiting != null && !d.closed && <div className="text-xs text-slate-500">{peso(d.waiting)} more when unpaid DRs are paid</div>}</div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">Adjustments / carried in</div><div className="text-lg font-semibold">{peso(Number(d.adjustments) + Number(d.carried_in))}</div>
          {(d.adjustment_lines ?? []).map((a: any) => <div key={a.id} className="text-xs text-slate-500">{a.note}: {peso(a.amount)}</div>)}
          {Number(d.carried_in) !== 0 && <div className="text-xs text-slate-500">carried from last month: {peso(d.carried_in)}</div>}</div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{d.closed ? 'Payable (closed)' : 'Payable so far'}</div><div className="text-lg font-semibold">{peso(d.payable)}</div>
          <div className="text-xs text-slate-500">{d.closed ? (Number(d.payable) <= 0 ? 'carried to next month' : d.expense_status === 'paid' ? 'paid' : 'approved — Finance pays') : 'closed by the Business Admin after month end'}</div></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Sale / DR</th><th className="p-2">Client</th><th className="p-2">Item</th><th className="p-2 text-right">Markup</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Base this month</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Commission</th></tr></thead>
          <tbody>
            {(d.lines ?? []).map((l: any, i: number) => (
              <tr key={i} className="border-t">
                <td className="p-2 text-xs"><div className="font-mono">{l.dr || l.sale_number}</div><div className="text-slate-500">{l.sale_date}</div></td>
                <td className="p-2">{l.customer}</td>
                <td className="p-2 text-xs">{l.item_code} · {l.description}{l.category ? <div className="text-slate-500">{l.category}</div> : null}</td>
                <td className="p-2 text-right">{l.markup != null ? peso(l.markup) : '—'}</td>
                <td className="p-2 text-right">{l.paid_share != null ? `${Math.round(Number(l.paid_share) * 100)}%` : '—'}</td>
                <td className={`p-2 text-right ${Number(l.base_delta) < 0 ? 'text-red-700' : ''}`}>{peso(l.base_delta)}</td>
                <td className="p-2 text-right">{Number(l.rate)}%</td>
                <td className={`p-2 text-right font-medium ${Number(l.commission) < 0 ? 'text-red-700' : ''}`}>{peso(l.commission)}</td>
              </tr>
            ))}
            {!(d.lines ?? []).length && <tr><td colSpan={8} className="p-4 text-center text-slate-500">No commission movement this month.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Base = the markup earned on the line (price net of VAT − cost) × the share of the DR paid. A payment or a return after a month is closed counts in the next open month.</p>
    </div>
  );
}
