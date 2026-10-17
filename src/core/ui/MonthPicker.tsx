'use client';
// Build 135 — a month picker that loads the chosen month at once (no "Show" button to press).
// A plain GET form: choosing a month submits it, so the page reloads with ?month=YYYY-MM (and any hidden fields).
export function MonthPicker({ action, value, max, hidden = {}, label = 'Month', className = '' }: {
  action: string; value: string; max?: string; hidden?: Record<string, string | number>; label?: string; className?: string;
}) {
  return (
    <form action={action} className={className}>
      <label className="text-slate-600" htmlFor="month">{label}</label>
      <input id="month" name="month" type="month" defaultValue={value} max={max}
        className="min-w-0 flex-1 border rounded px-2 py-2 sm:flex-none sm:py-1"
        onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.currentTarget.value)) e.currentTarget.form?.requestSubmit(); }} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      <noscript><button className="rounded bg-slate-800 text-white px-3 py-1">Show</button></noscript>
    </form>
  );
}
