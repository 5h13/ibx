export type IntegrationModule = {
  code: string;
  label: string;
  section: string;
  href: string;
  description: string;
};

export const INTEGRATION_MODULES: IntegrationModule[] = [
  { code: 'admin', label: 'Admin / Operations', section: 'admin', href: '/admin/employees', description: 'People, timekeeping, leave, assets, supplies, fleet and policies.' },
  { code: 'finance', label: 'Finance / Procurement', section: 'finance', href: '/finance/accounting', description: 'Procurement, AP, AR, payroll, cash, budgets and accounting.' },
  { code: 'logistics', label: 'Logistics', section: 'logistics', href: '/logistics/reports', description: 'Inventory, receiving, warehouse, delivery and fleet operations.' },
  { code: 'marketing', label: 'Marketing', section: 'marketing', href: '/marketing', description: 'Campaigns, leads, activities and marketing spend.' },
  { code: 'sales', label: 'Sales / Revenue', section: 'sales', href: '/sales/revenue', description: 'Pipeline, quotations, orders, revenue and commissions.' },
  { code: 'approvals', label: 'Approvals / Decision Engine', section: 'shared', href: '/approvals', description: 'Central review, approval, return and supported posting decisions.' },
];
