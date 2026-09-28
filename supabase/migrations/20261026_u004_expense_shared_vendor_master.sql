-- U004: Shared Vendor/Payee Master.
--
-- Expense entry (admin/finance/logistics/marketing/sales) only ever had a
-- free-text `vendor` column on `expenses`, disconnected from the
-- `finance_suppliers` master already used by Procurement/AP. This adds an
-- optional link to that existing global master rather than inventing a
-- second vendor/payee table -- `finance_suppliers` already IS the shared
-- vendor/payee master this item asks for, it just wasn't reachable from
-- expense entry.
--
-- The free-text `vendor` column is kept, not replaced: many expenses are
-- paid to a payee that will never be a formal supplier (e.g. an employee
-- reimbursement, a one-off cash purchase), so a mandatory FK would force
-- either fabricated supplier records or blocked expense entry. `supplier_id`
-- is the "this was actually one of our known suppliers" case;
-- free-text `vendor` remains the general/no-supplier case. Where both are
-- present, the UI prefers the linked supplier's name for display.

alter table public.expenses
  add column if not exists supplier_id uuid references public.finance_suppliers(id) on delete set null;

create index if not exists idx_expenses_supplier_id on public.expenses(supplier_id);

-- finance_suppliers access today is finance-only ("finance suppliers
-- access") plus a logistics-specific read carve-out ("logistics can read
-- suppliers"). Expense entry from marketing/sales/admin needs read access
-- too (to populate the vendor dropdown), so add the same shared-read
-- policy used for admin_expense_categories in the U040 migration, rather
-- than adding a third department-specific carve-out.
drop policy if exists finance_suppliers_read_all on public.finance_suppliers;
create policy finance_suppliers_read_all on public.finance_suppliers
for select using (auth.role() = 'authenticated');
