Sales uses the shared expenses pattern (src/shared/expenses) for
/sales/expenses, plus its own module for monthly agent sales
(src/shared/sales) wired to app/sales/monthly-sales/page.tsx, since that
data (agent, collections, commission) doesn't fit the generic expenses shape.
