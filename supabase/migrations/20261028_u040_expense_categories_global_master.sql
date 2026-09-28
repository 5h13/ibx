-- U040 follow-on correction: admin_expense_categories was made business-
-- scoped by Build 35's original A001 migration, but it is expense
-- classification taxonomy referenced by the business-scoped `expenses`
-- table across EVERY section (finance/logistics/marketing/sales/admin),
-- not admin-specific data itself -- exactly the shape of thing A001's own
-- "locked architecture" rule says stays GLOBAL (see
-- 20261012_a001_multi_business_foundation.sql section 5 and
-- 20261019_hr_department_position_location_masters.sql's restatement of
-- the same rule for hr_departments/hr_positions/work_locations).
--
-- This went unnoticed until now because the only categories ever seeded
-- landed on whichever business was "current" when Build 35 ran (Ishabella)
-- and only the admin section had ever exercised this table -- so the bug
-- was invisible until U040 tried to make categories usable for every
-- section across all three real businesses (Pili and Aton had zero
-- categories of their own and, being correctly business-isolated from
-- Ishabella's, saw an empty list).
--
-- Fix: make admin_expense_categories global, same as its sibling taxonomy
-- masters. Existing rows and every expenses.category_id reference are
-- unaffected -- only the isolation policy and the now-meaningless
-- business_id column are removed.

drop policy if exists admin_expense_categories_business_isolation on public.admin_expense_categories;
alter table public.admin_expense_categories drop column if exists business_id;
