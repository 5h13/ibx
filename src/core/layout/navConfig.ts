// Sidebar menu definition, shared by the Sidebar and 5H13 Shortcuts (Build 82).
import { hasSectionWorkflowRole, isAdminTier, type SessionProfile } from '@/core/auth/types';

export type NavItem = { label: string; href: string; show?: (p: SessionProfile) => boolean };
// Build 78: the price review is for the Sales approver, Finance and admins (the page checks again)
const canReviewPrices = (p: SessionProfile) => isAdminTier(p) || hasSectionWorkflowRole(p, 'sales', 'approver') || p.user.role === 'finance' || p.access.some((a) => a.section_code === 'finance');

export type NavGroup = { code: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
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

export function groupIsAccessible(group: NavGroup, profile: SessionProfile) {
  if (isAdminTier(profile)) return true;

  const accessibleCodes = new Set(profile.access.map((a) => a.section_code).filter(Boolean));
  return accessibleCodes.has(group.code) || profile.user.section_code === group.code || profile.user.role === group.code;
}

