'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { hasSectionWorkflowRole, isAdminTier, type SessionProfile } from '@/core/auth/types';
import { canViewProductSearch } from '@/modules/catalog/productSearchAccess';

type NavItem = { label: string; href: string; show?: (p: SessionProfile) => boolean };
// Build 78: the price review is for the Sales approver, Finance and admins (the page checks again)
const canReviewPrices = (p: SessionProfile) => isAdminTier(p) || hasSectionWorkflowRole(p, 'sales', 'approver') || p.user.role === 'finance' || p.access.some((a) => a.section_code === 'finance');

type NavGroup = { code: string; label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    code: 'admin',
    label: 'Admin',
    items: [
      { label: 'Expenses', href: '/admin/expenses' },
      { label: 'Employees', href: '/admin/employees' },
      { label: 'HR Master Data', href: '/admin/hr-masters' },
      { label: 'Timekeeping & Leave', href: '/admin/timekeeping' },
      { label: 'Documents & Compliance', href: '/admin/documents' },
      { label: 'Business Documents & Compliance', href: '/admin/business-documents' },
      { label: 'Assets & Equipment', href: '/admin/assets' },
      { label: 'Office Supplies', href: '/admin/supplies' },
      { label: 'Internal Requests', href: '/admin/requests' },
      { label: 'Fleet Management', href: '/admin/fleet' },
    ],
  },
  {
    code: 'finance',
    label: 'Finance',
    items: [
      { label: 'Finance Dashboard', href: '/finance/dashboard' },
      { label: 'Expenses', href: '/finance/expenses' },
      { label: 'All expenses', href: '/finance/expenses/register' },
      { label: 'Procurement', href: '/finance/procurement' },
      { label: 'Supplier Quotes', href: '/finance/procurement/supplier-quotes' },
      { label: 'Price Requests', href: '/finance/price-requests' },
      { label: 'Price Review', href: '/sales/price-review', show: canReviewPrices },
      { label: 'Accounts Payable', href: '/finance/accounts-payable' },
      { label: 'Accounts Receivable', href: '/finance/accounts-receivable' },
      { label: 'Storefront (view)', href: '/sales/storefront' },
      { label: 'Opening Stock', href: '/finance/opening-stock' },
      { label: 'Payroll', href: '/finance/payroll' },
      { label: 'Bank / Cash & Reconciliation', href: '/finance/bank-cash' },
      { label: 'Budgets & Forecasting', href: '/finance/budgets' },
      { label: 'Cost Centers', href: '/finance/cost-centers' },
      { label: 'Financial Summary / Accounting', href: '/finance/accounting' },
    ],
  },
  {
    code: 'logistics',
    label: 'Logistics',
    items: [
      { label: 'Inventory & Receiving', href: '/logistics/inventory' },
      { label: 'Warehouse / Delivery', href: '/logistics/warehouse-delivery' },
      { label: 'Reporting & Operations Dashboard', href: '/logistics/reports' },
      { label: 'Expenses', href: '/logistics/expenses' },
    ],
  },
  {
    code: 'marketing',
    label: 'Marketing',
    items: [
      { label: 'Campaigns & Leads', href: '/marketing' },
      { label: 'Expenses', href: '/marketing/expenses' },
    ],
  },
  {
    code: 'sales',
    label: 'Sales',
    items: [
      { label: 'Storefront', href: '/sales/storefront' },
      { label: 'Sales / Revenue Pipeline', href: '/sales/revenue' },
      { label: 'Supplier Quotes', href: '/finance/procurement/supplier-quotes' },
      { label: 'Price Review', href: '/sales/price-review', show: canReviewPrices },
      { label: 'Monthly Sales', href: '/sales/monthly-sales' },
      { label: 'Commission Operations & Reporting', href: '/sales/commission-report' },
      { label: 'Expenses', href: '/sales/expenses' },
    ],
  },
];

function groupIsAccessible(group: NavGroup, profile: SessionProfile) {
  if (isAdminTier(profile)) return true;

  const accessibleCodes = new Set(profile.access.map((a) => a.section_code).filter(Boolean));
  return accessibleCodes.has(group.code) || profile.user.section_code === group.code || profile.user.role === group.code;
}

function groupContainsPath(group: NavGroup, pathname: string) {
  return group.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export function Sidebar({ profile }: { profile: SessionProfile }) {
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
