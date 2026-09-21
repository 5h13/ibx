This module follows the shared expenses pattern in `src/shared/expenses`
(service + table + form + actions), wired to the `finance` section via
`app/finance/expenses/page.tsx`. There's nothing finance-specific yet, so this
folder has no separate components/services — add them here once finance needs
something beyond the standard Prepare/Review/Approve expenses flow.
