-- U040: Expense Accounting Classification.
--
-- public.expenses.category_id already references admin_expense_categories
-- for EVERY section (finance/logistics/marketing/sales/admin), not just
-- admin -- it's the general expense classification master, named after
-- the module that happens to own its CRUD screen. But its RLS policy
-- (admin_expense_categories_admin) only ever granted access -- including
-- SELECT -- to the admin section (or super_admin), so a finance/logistics/
-- marketing/sales user could never even read the category list to assign
-- one to their own expenses. That's the actual reason the generic
-- NewExpenseForm/ExpensesTable never had a category dropdown: fetching it
-- would have silently returned zero rows under RLS.
--
-- Fix: keep admin's existing full-control policy (create/rename/deactivate
-- categories stays admin-only) and add a separate, read-only policy for
-- every other authenticated user, mirroring the same shared-classification
-- pattern already used for e.g. finance_cost_centers.

drop policy if exists admin_expense_categories_read_all on public.admin_expense_categories;
create policy admin_expense_categories_read_all on public.admin_expense_categories
for select using (auth.role() = 'authenticated');
