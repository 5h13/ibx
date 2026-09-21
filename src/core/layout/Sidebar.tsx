// src/core/layout/Sidebar.tsx
import Link from 'next/link';
import type { SessionProfile } from '@/core/auth/types';

const ALL_MODULES: { code: string; label: string; href: string }[] = [
  { code: 'admin', label: 'Admin', href: '/admin/expenses' },
  { code: 'finance', label: 'Finance', href: '/finance/expenses' },
  { code: 'logistics', label: 'Logistics', href: '/logistics/expenses' },
  { code: 'marketing', label: 'Marketing', href: '/marketing/expenses' },
  { code: 'sales', label: 'Sales', href: '/sales/expenses' },
];

export function Sidebar({ profile }: { profile: SessionProfile }) {
  const isSuperAdmin = profile.user.role === 'super_admin';
  const accessibleSections = new Set(profile.access.map((a) => a.section_id));

  // Super admin sees every module. Everyone else sees only modules they
  // have a workflow grant in, plus their home section.
  const visibleModules = isSuperAdmin
    ? ALL_MODULES
    : ALL_MODULES.filter(
        (m) => m.code === profile.user.role || accessibleSections.has(m.code)
      );

  return (
    <nav className="bg-slate-800 text-slate-200 w-56 min-h-screen p-4 space-y-1">
      <Link href="/dashboard" className="block px-3 py-2 rounded hover:bg-slate-700 text-sm font-medium">
        Dashboard
      </Link>
      {visibleModules.map((m) => (
        <Link key={m.code} href={m.href} className="block px-3 py-2 rounded hover:bg-slate-700 text-sm">
          {m.label}
        </Link>
      ))}
      {profile.user.role === 'sales' || isSuperAdmin ? (
        <Link href="/sales/monthly-sales" className="block px-3 py-2 rounded hover:bg-slate-700 text-sm">
          Monthly Sales
        </Link>
      ) : null}
      <Link href="/approvals" className="block px-3 py-2 rounded hover:bg-slate-700 text-sm">
        Approvals
      </Link>
      {isSuperAdmin ? (
        <Link href="/settings/users" className="block px-3 py-2 rounded hover:bg-slate-700 text-sm">
          Users
        </Link>
      ) : null}
    </nav>
  );
}
