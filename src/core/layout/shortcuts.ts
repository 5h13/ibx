// Build 82 — 5H13 Shortcuts: what a user may pin at the top of the sidebar.
// Pages come from the sidebar menu (only the departments the user can open);
// actions open a page with its "add / create" pop-up already showing
// (PopupAction openParam, triggered by ?new=<key>).
import { isAdminTier, type SessionProfile } from '@/core/auth/types';
import { canViewProductSearch } from '@/modules/catalog/productSearchAccess';
import { NAV_GROUPS, groupIsAccessible } from './navConfig';

export type Shortcut = { key: string; label: string; href: string; group: string; action?: boolean };

const SECTION_LABEL: Record<string, string> = { admin: 'Admin', finance: 'Finance', logistics: 'Logistics', marketing: 'Marketing', sales: 'Sales' };

export function availableShortcuts(profile: SessionProfile): Shortcut[] {
  const out: Shortcut[] = [];
  const general: Shortcut[] = [
    { key: '/dashboard', label: 'Dashboard', href: '/dashboard', group: 'General' },
    { key: '/profile', label: 'My Employee Profile', href: '/profile', group: 'General' },
    { key: '/admin/policies', label: 'Policies & Announcements', href: '/admin/policies', group: 'General' },
    ...(canViewProductSearch(profile) ? [{ key: '/catalog', label: 'Product Search', href: '/catalog', group: 'General' }] : []),
    { key: '/approvals', label: 'Approvals', href: '/approvals', group: 'General' },
  ];
  out.push(...general);
  const can = (code: string) => { const g = NAV_GROUPS.find((x) => x.code === code); return !!g && groupIsAccessible(g, profile); };
  // actions first within each department
  const actions: Shortcut[] = [
    { key: 'new:quote', label: 'New quotation', href: '/sales/revenue?tab=quotations&new=quote', group: 'Sales', action: true },
    { key: 'new:sale', label: 'New sale (Storefront)', href: '/sales/storefront?new=sale', group: 'Sales', action: true },
    { key: 'new:arpay', label: 'Receive AR payment', href: '/sales/storefront?new=arpay', group: 'Sales', action: true },
    { key: 'new:po', label: 'New purchase order', href: '/finance/procurement?tab=po&new=po', group: 'Finance', action: true },
    { key: 'new:apinv', label: 'Record supplier invoice', href: '/finance/accounts-payable?tab=invoices&new=apinv', group: 'Finance', action: true },
  ];
  for (const a of actions) if (can(a.group.toLowerCase())) out.push(a);
  for (const sec of ['admin', 'finance', 'logistics', 'marketing', 'sales']) {
    if (can(sec)) out.push({ key: `new:expense:${sec}`, label: `Add expense (${SECTION_LABEL[sec]})`, href: `/${sec}/expenses?new=expense`, group: SECTION_LABEL[sec], action: true });
  }
  for (const g of NAV_GROUPS) {
    if (!groupIsAccessible(g, profile)) continue;
    for (const it of g.items) {
      if (it.show && !it.show(profile)) continue;
      if (out.some((x) => x.key === it.href)) continue;
      out.push({ key: it.href, label: it.label, href: it.href, group: g.label });
    }
  }
  if (isAdminTier(profile)) out.push({ key: '/settings/users', label: 'Users', href: '/settings/users', group: 'System' });
  return out;
}
