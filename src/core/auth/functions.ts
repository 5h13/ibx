// Build 90 — access by function (mirror of public.app_functions / has_function()).
//
// A section still opens the department. Inside Finance and Sales a user can
// be limited to some functions. No function rows for a section = all of it
// (the old behaviour). Admin tier = everything.
import { isAdminTier, type SessionProfile } from './types';

export type AppFunction = { code: string; section: 'finance' | 'sales'; label: string; hint: string };

export const APP_FUNCTIONS: AppFunction[] = [
  { code: 'catalog.photos', section: 'finance', label: 'Catalog photos', hint: 'See the catalog list and upload / replace product photos. No costs or prices.' },
  { code: 'catalog.edit', section: 'finance', label: 'Catalog items & prices', hint: 'Add / edit items, import / export, markups, price requests and price review. Includes catalog photos.' },
  { code: 'procurement.suppliers', section: 'finance', label: 'Suppliers & supplier quotes', hint: 'Supplier master, documents and supplier quotes.' },
  { code: 'procurement.pr', section: 'finance', label: 'Purchase requisitions', hint: 'Create and process purchase requisitions.' },
  { code: 'procurement.po', section: 'finance', label: 'Purchase orders', hint: 'Create and process purchase orders.' },
  { code: 'finance.ap', section: 'finance', label: 'Accounts payable', hint: 'Supplier invoices, payments, supplier statements.' },
  { code: 'finance.ar', section: 'finance', label: 'Accounts receivable', hint: 'Customer invoices, receipts, statements; storefront (view).' },
  { code: 'finance.expenses', section: 'finance', label: 'Expenses', hint: 'Finance expenses and the all-expenses register.' },
  { code: 'finance.payroll', section: 'finance', label: 'Payroll', hint: 'Payroll runs, periods and pay profiles.' },
  { code: 'finance.cash', section: 'finance', label: 'Bank / cash & reconciliation', hint: 'Cash accounts, check register, reconciliation.' },
  { code: 'finance.budgets', section: 'finance', label: 'Budgets & cost centers', hint: 'Budgets, forecasting and cost centers.' },
  { code: 'finance.accounting', section: 'finance', label: 'Dashboard & accounting', hint: 'Finance dashboard, financial summary, opening stock.' },
  { code: 'sales.counter', section: 'sales', label: 'Counter sales', hint: 'New sale, sales register, orders, returns, approvals at the storefront.' },
  { code: 'sales.ar_collect', section: 'sales', label: 'Receive AR at the counter', hint: 'Receive payments on old invoices at the storefront.' },
  { code: 'sales.closing', section: 'sales', label: 'Cash drawer & day closing', hint: 'Opening float, cash out, daily closing.' },
  { code: 'sales.quotes', section: 'sales', label: 'Quotations & sales orders', hint: 'Sales / revenue pipeline.' },
  { code: 'sales.agents', section: 'sales', label: 'Agents', hint: 'Sales agents list and settings.' },
  { code: 'sales.price_review', section: 'sales', label: 'Price review & supplier quotes', hint: 'Price review and supplier quotes (Sales side).' },
  { code: 'sales.reports', section: 'sales', label: 'Sales & commission reports', hint: 'Monthly sales and commission reporting.' },
  { code: 'sales.expenses', section: 'sales', label: 'Expenses', hint: 'Sales expenses.' },
];

export type FunctionCode = string;
const BY_CODE = new Map(APP_FUNCTIONS.map((f) => [f.code, f]));
/** A function also granted by holding another one. */
const IMPLIED_BY: Record<string, string[]> = { 'catalog.photos': ['catalog.edit'] };

export const functionsOfSection = (section: string) => APP_FUNCTIONS.filter((f) => f.section === section);

/** Same test as hasSectionAccess (kept here so client components can use it). */
export function sectionOpen(p: SessionProfile | null, section: string): boolean {
  if (!p) return false;
  if (isAdminTier(p)) return true;
  return p.user.section_code === section || p.user.role === section || p.access.some((a) => a.section_code === section);
}

/** True when the user is limited to some functions of this section. */
export function isRestricted(p: SessionProfile | null, section: string): boolean {
  if (!p || isAdminTier(p)) return false;
  return (p.functions ?? []).some((c) => BY_CODE.get(c)?.section === section);
}

export function hasFunction(p: SessionProfile | null, code: FunctionCode): boolean {
  if (!p) return false;
  if (isAdminTier(p)) return true;
  const f = BY_CODE.get(code);
  if (!f || !sectionOpen(p, f.section)) return false;
  if (!isRestricted(p, f.section)) return true;
  const mine = p.functions ?? [];
  return mine.includes(code) || (IMPLIED_BY[code] ?? []).some((c) => mine.includes(c));
}

export const hasAnyFunction = (p: SessionProfile | null, codes: FunctionCode[]) => codes.some((c) => hasFunction(p, c));
