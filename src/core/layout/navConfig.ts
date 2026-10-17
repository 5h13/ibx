// Sidebar menu definition, shared by the Sidebar and 5H13 Shortcuts (Build 82).
import { hasSectionWorkflowRole, isAdminTier, isAgent, type SessionProfile } from '@/core/auth/types';

import { hasAnyFunction } from '@/core/auth/functions';

/** Build 90: fn = the function(s) that open this item (any one is enough). */
export type NavItem = { label: string; href: string; show?: (p: SessionProfile) => boolean; fn?: string | string[] };
// Build 78: the price review is for the Sales approver, Finance and admins (the page checks again)
const canReviewPrices = (p: SessionProfile) => isAdminTier(p) || hasSectionWorkflowRole(p, 'sales', 'approver') || p.user.role === 'finance' || p.access.some((a) => a.section_code === 'finance');

export const PROCUREMENT_FNS = ['catalog.edit', 'procurement.suppliers', 'procurement.pr', 'procurement.po'];
export const STOREFRONT_FNS = ['sales.counter', 'sales.ar_collect', 'sales.closing'];

export type NavGroup = { code: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  // Build 91 — the agent portal (Agent logins only)
  {
    code: 'agent',
    label: 'Agent',
    items: [
      { label: 'Home', href: '/agent', show: isAgent },
      { label: 'My Clients', href: '/agent/clients', show: isAgent },
      { label: 'Catalogue & Pricing', href: '/agent/catalog', show: isAgent },
      { label: 'Orders', href: '/agent/orders', show: isAgent },
      { label: 'Quotations', href: '/agent/quotations', show: isAgent },
      { label: 'Payments', href: '/agent/payments', show: isAgent },
      { label: 'Expenses', href: '/agent/expenses', show: isAgent },
      { label: 'My Commission', href: '/agent/commission', show: isAgent },
    ],
  },
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
      { label: 'Expense Allowances', href: '/admin/allowances', show: isAdminTier },
      { label: 'Cash Advances', href: '/admin/cash-advances', show: isAdminTier },
    ],
  },
  {
    code: 'finance',
    label: 'Finance',
    items: [
      { label: 'Finance Dashboard', href: '/finance/dashboard', fn: 'finance.accounting' },
      { label: 'Expenses', href: '/finance/expenses', fn: 'finance.expenses' },
      { label: 'All expenses', href: '/finance/expenses/register', fn: 'finance.expenses' },
      { label: 'Procurement', href: '/finance/procurement', fn: PROCUREMENT_FNS },
      { label: 'Catalog Photos', href: '/finance/catalog-photos', fn: 'catalog.photos' },
      { label: 'Supplier Quotes', href: '/finance/procurement/supplier-quotes', fn: 'procurement.suppliers' },
      { label: 'Price Requests', href: '/finance/price-requests', fn: 'catalog.edit' },
      { label: 'Price Review', href: '/sales/price-review', show: canReviewPrices, fn: 'catalog.edit' },
      { label: 'Accounts Payable', href: '/finance/accounts-payable', fn: 'finance.ap' },
      { label: 'Accounts Receivable', href: '/finance/accounts-receivable', fn: 'finance.ar' },
      { label: 'Clients', href: '/sales/clients', fn: 'finance.ar' },   // Build 96
      { label: 'Storefront (view)', href: '/sales/storefront', fn: 'finance.ar' },
      { label: 'Opening Stock', href: '/finance/opening-stock', fn: 'finance.accounting' },
      { label: 'Payroll', href: '/finance/payroll', fn: 'finance.payroll' },
      { label: 'Cash Advances', href: '/finance/cash-advances', fn: 'finance.payroll' },
      { label: 'Bank / Cash & Reconciliation', href: '/finance/bank-cash', fn: 'finance.cash' },
      { label: 'Agent Commissions', href: '/sales/agent-commissions', fn: 'finance.expenses' },
      { label: 'Back Office Commission', href: '/sales/back-office-commission', fn: 'finance.expenses' },
      { label: 'Budgets & Forecasting', href: '/finance/budgets', fn: 'finance.budgets' },
      { label: 'Cost Centers', href: '/finance/cost-centers', fn: 'finance.budgets' },
      { label: 'Financial Summary / Accounting', href: '/finance/accounting', fn: 'finance.accounting' },
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
      // Build 122: the owner's design tools, inside the app
      { label: 'Specs Card', href: '/marketing/specs-card' },
      { label: 'Banner Studio', href: '/marketing/banner-studio' },
      { label: 'Expenses', href: '/marketing/expenses' },
    ],
  },
  {
    code: 'sales',
    label: 'Sales',
    items: [
      { label: 'Storefront', href: '/sales/storefront', fn: STOREFRONT_FNS },
      { label: 'Sales / Revenue Pipeline', href: '/sales/revenue', fn: 'sales.quotes' },
      { label: 'Clients', href: '/sales/clients' },   // Build 96: the client list with agents (like Suppliers)
      { label: 'Agents', href: '/sales/agents', fn: 'sales.agents' },
      { label: 'Supplier Quotes', href: '/finance/procurement/supplier-quotes', fn: 'sales.price_review' },
      { label: 'Price Review', href: '/sales/price-review', show: canReviewPrices, fn: 'sales.price_review' },
      { label: 'Monthly Sales', href: '/sales/monthly-sales', fn: 'sales.reports' },
      { label: 'Online Shop', href: '/sales/online-shop', show: isAdminTier },   // Build 136
      { label: 'Agent Commissions', href: '/sales/agent-commissions', fn: 'sales.reports' },
      { label: 'Back Office Commission', href: '/sales/back-office-commission', fn: 'sales.reports' },
      { label: 'Commission Operations & Reporting', href: '/sales/commission-report', fn: 'sales.reports' },
      { label: 'Expenses', href: '/sales/expenses', fn: 'sales.expenses' },
    ],
  },
];

export function groupIsAccessible(group: NavGroup, profile: SessionProfile) {
  if (isAdminTier(profile)) return true;

  const accessibleCodes = new Set(profile.access.map((a) => a.section_code).filter(Boolean));
  return accessibleCodes.has(group.code) || profile.user.section_code === group.code || profile.user.role === group.code;
}


/** Build 90: may this user see this menu item? Items with a function code
 * follow the user's function limits; the others follow the section. */
export function itemVisible(group: NavGroup, item: NavItem, profile: SessionProfile) {
  if (item.show && !item.show(profile)) return false;
  if (item.fn) return hasAnyFunction(profile, Array.isArray(item.fn) ? item.fn : [item.fn]);
  return groupIsAccessible(group, profile);
}
