This module follows the shared expenses pattern in `src/shared/expenses`
(service + table + form + actions), wired to the `logistics` section via
`app/logistics/expenses/page.tsx`. There's nothing logistics-specific yet, so this
folder has no separate components/services — add them here once logistics needs
something beyond the standard Prepare/Review/Approve expenses flow.
