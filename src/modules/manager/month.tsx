// Build 127 — month picking for the Sales Manager screens (?m=YYYY-MM, default this month, Manila).
import Link from 'next/link';

export function monthFrom(m?: string) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  let year = now.getFullYear(), month = now.getMonth() + 1;
  const x = /^(\d{4})-(\d{2})$/.exec(m || '');
  if (x && Number(x[2]) >= 1 && Number(x[2]) <= 12) { year = Number(x[1]); month = Number(x[2]); }
  const key = (y: number, mo: number) => `${y}-${String(mo).padStart(2, '0')}`;
  const shift = (by: number) => { const d = new Date(year, month - 1 + by, 1); return key(d.getFullYear(), d.getMonth() + 1); };
  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
  return { year, month, label: new Date(year, month - 1, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }), prev: shift(-1), next: isCurrent ? null : shift(1), isCurrent };
}

export function monthNav(path: string, prev: string, next: string | null, label: string) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white px-2 py-1 shadow-sm">
      <Link href={`${path}?m=${prev}`} className="flex min-h-[44px] items-center px-3 text-sm font-bold" aria-label="Previous month">‹ Prev</Link>
      <span className="text-sm font-extrabold">{label}</span>
      {next ? <Link href={`${path}?m=${next}`} className="flex min-h-[44px] items-center px-3 text-sm font-bold" aria-label="Next month">Next ›</Link> : <span className="px-3 text-sm text-slate-300">Next ›</span>}
    </div>
  );
}
