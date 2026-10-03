// Build 85 — period picker for statements (customer / supplier). A plain GET
// form; hidden when printing and left out of the PDF (data-doc-actions).
export function StatementPeriod({ from, to }: { from: string; to: string }) {
  const y = to.slice(0, 4);
  const presets: [string, string, string][] = [
    ['This year', `${y}-01-01`, to],
    ['Last 90 days', new Date(new Date(to).getTime() - 89 * 86400000).toISOString().slice(0, 10), to],
    ['This month', `${to.slice(0, 7)}-01`, to],
  ];
  return (
    <form method="get" data-doc-actions className="mb-4 flex flex-wrap items-end gap-2 rounded border bg-slate-50 p-3 text-sm print:hidden">
      <label className="block"><span className="mb-1 block text-xs text-slate-600">From</span><input className="input" type="date" name="from" defaultValue={from} /></label>
      <label className="block"><span className="mb-1 block text-xs text-slate-600">To</span><input className="input" type="date" name="to" defaultValue={to} /></label>
      <button className="button">Show</button>
      {presets.map(([l, f, t]) => <a key={l} className="button-secondary" href={`?from=${f}&to=${t}`}>{l}</a>)}
    </form>
  );
}
