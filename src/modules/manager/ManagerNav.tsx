'use client';
// Build 127 — the Sales Manager app's bottom bar (phone) / top tabs (wider screens).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/manager', label: 'Today', d: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z' },
  { href: '/manager/approvals', label: 'Approvals', d: 'M5 12l4 4 10-10' },
  { href: '/manager/team', label: 'Team', d: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 11.5a2.5 2.5 0 1 0 0-5M16 15c3 0 5 2 5 5' },
  { href: '/manager/sales', label: 'Sales', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { href: '/manager/collections', label: 'Collect', d: 'M3 6h18v12H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  { href: '/manager/inbox', label: 'Inbox', d: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5' },   // Build 139: shop requests
];

export function ManagerNav({ approvals, attention = 0, inbox = 0 }: { approvals: number; attention?: number; inbox?: number }) {
  const path = usePathname();
  const on = (h: string) => (h === '/manager' ? path === '/manager' : path.startsWith(h) || (h === '/manager/approvals' && path.startsWith('/manager/quotes')) || (h === '/manager/sales' && path.startsWith('/manager/clients')));
  return (
    <nav aria-label="Sales Manager" className="fixed inset-x-0 bottom-0 z-40 border-t bg-white pb-[env(safe-area-inset-bottom)] md:static md:mx-auto md:mt-2 md:max-w-3xl md:rounded-xl md:border">
      <div className="grid grid-cols-6">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={on(n.href) ? 'page' : undefined}
            className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${on(n.href) ? 'font-bold text-[rgb(var(--btn))]' : 'text-slate-500'}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={n.d} /></svg>
            {n.label}
            {n.href === '/manager' && attention > 0 && <span className="absolute left-1/2 top-1.5 ml-2 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white" aria-label={`${attention} need attention`}>{attention}</span>}
            {n.href === '/manager/inbox' && inbox > 0 && <span className="absolute left-1/2 top-1.5 ml-2 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white" aria-label={`${inbox} new shop requests`}>{inbox}</span>}
            {n.href === '/manager/approvals' && approvals > 0 && <span className="absolute left-1/2 top-1.5 ml-2 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{approvals}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
