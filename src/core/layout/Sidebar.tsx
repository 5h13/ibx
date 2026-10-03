'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { isAdminTier, type SessionProfile } from '@/core/auth/types';
import { NAV_GROUPS, groupIsAccessible, type NavGroup } from './navConfig';
import { ShortcutsPanel } from './ShortcutsPanel';
import { canViewProductSearch } from '@/modules/catalog/productSearchAccess';

function groupContainsPath(group: NavGroup, pathname: string) {
  return group.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export function Sidebar({ profile, shortcuts = [] }: { profile: SessionProfile; shortcuts?: string[] }) {
  const pathname = usePathname();
  const isSuperAdmin = profile.user.role === 'super_admin';
  const adminTier = isAdminTier(profile);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NAV_GROUPS.forEach((group) => {
      initial[group.code] = groupContainsPath(group, pathname);
    });
    return initial;
  });

  const toggleGroup = (code: string) => {
    setOpenGroups((current) => ({ ...current, [code]: !current[code] }));
  };

  return (
    <nav className="bg-slate-800 text-slate-200 w-56 min-h-full p-4 space-y-1" aria-label="Main navigation">
      <ShortcutsPanel profile={profile} saved={shortcuts} />
      <Link
        href="/dashboard"
        className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm font-medium ${pathname === '/dashboard' ? 'bg-slate-700 text-white' : ''}`}
      >
        Dashboard
      </Link>
      <Link
        href="/profile"
        className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname === '/profile' ? 'bg-slate-700 text-white font-medium' : ''}`}
      >
        My Employee Profile
      </Link>
      {/* RA-05: every employee reads and acknowledges policies and announcements,
          so the link sits outside the section groups (the page is open to any
          signed-in user; creating and publishing stay with Admin). */}
      <Link
        href="/admin/policies"
        className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname === '/admin/policies' || pathname.startsWith('/admin/policies/') ? 'bg-slate-700 text-white font-medium' : ''}`}
      >
        Policies & Announcements
      </Link>
      {canViewProductSearch(profile) && (
        <Link
          href="/catalog"
          className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname === '/catalog' ? 'bg-slate-700 text-white font-medium' : ''}`}
        >
          Product Search
        </Link>
      )}

      {NAV_GROUPS.filter((group) => groupIsAccessible(group, profile)).map((group) => {
        const isOpen = openGroups[group.code] ?? false;
        const hasActiveItem = groupContainsPath(group, pathname);

        return (
          <div key={group.code} className="pt-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.code)}
              aria-expanded={isOpen}
              className={`w-full flex items-center justify-between px-3 py-2 rounded hover:bg-slate-700 text-sm text-left ${hasActiveItem ? 'bg-slate-700 text-white font-medium' : ''}`}
            >
              <span>{group.label}</span>
              <span className="text-xs" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && (
              <div className="mt-1 ml-2 border-l border-slate-600 pl-2 space-y-1">
                {group.items.filter((item) => !item.show || item.show(profile)).map((item) => {
                  // Most specific match wins (e.g. Supplier Quotes under /finance/procurement/).
                  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
                  const active = matches(item.href) && !group.items.some((o) => o.href.length > item.href.length && o.href.startsWith(`${item.href}/`) && matches(o.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${active ? 'bg-slate-700 text-white font-medium' : 'text-slate-300'}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="pt-1">
        <Link
          href="/approvals"
          className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname === '/approvals' || pathname.startsWith('/approvals/') ? 'bg-slate-700 text-white font-medium' : ''}`}
        >
          Approvals
        </Link>
      </div>

      {adminTier && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => toggleGroup('settings')}
            aria-expanded={openGroups.settings ?? false}
            className={`w-full flex items-center justify-between px-3 py-2 rounded hover:bg-slate-700 text-sm text-left ${pathname.startsWith('/settings') || pathname.startsWith('/integration') ? 'bg-slate-700 text-white font-medium' : ''}`}
          >
            <span>System</span>
            <span className="text-xs" aria-hidden="true">{openGroups.settings ? '▾' : '▸'}</span>
          </button>
          {openGroups.settings && (
            <div className="mt-1 ml-2 border-l border-slate-600 pl-2 space-y-1">
              <Link href="/settings/users" className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname.startsWith('/settings/users') ? 'bg-slate-700 text-white font-medium' : 'text-slate-300'}`}>Users</Link>
              {/* Integration Control Center configures shared/global integrations — stays Global Super Admin only, never business_admin. */}
              {isSuperAdmin && <Link href="/integration" className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname.startsWith('/integration') ? 'bg-slate-700 text-white font-medium' : 'text-slate-300'}`}>Integration Control Center</Link>}
              {/* U033 — Business Branding. `businesses` write RLS is Global Super Admin only, same reasoning as Integration Control Center. */}
              {isSuperAdmin && <Link href="/admin/businesses" className={`block px-3 py-2 rounded hover:bg-slate-700 text-sm ${pathname.startsWith('/admin/businesses') ? 'bg-slate-700 text-white font-medium' : 'text-slate-300'}`}>Business Branding</Link>}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
