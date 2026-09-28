# Finance + Procurement

The Finance module now begins with a procurement foundation: supplier master, procurement catalog, purchase requisitions and purchase orders.

Workflow: draft -> prepared -> reviewed -> approved.

The next Finance phases can connect approved POs to Logistics receiving/inventory, then Accounts Payable, payroll, AR, reconciliation, budgeting and financial reporting.

## Accounts Payable
Supplier invoice capture, invoice workflow, supplier payment workflow, posting, outstanding balances and invoice aging foundation.

## Accounts Receivable

The Finance module now includes an Accounts Receivable foundation at `/finance/accounts-receivable` covering customer master data, customer invoices, invoice lines, receipt workflow, posting, balance recalculation, and aging buckets. Migration: `20260921_finance_accounts_receivable.sql`.

## Budgets & Forecasting
The Finance module now includes annual budget/forecast versions, monthly budget and forecast lines, actual-entry tracking, variance visibility, workflow approval, audit logging, and Finance RLS. Migration: `20260921_finance_budgets_forecasting.sql`.
