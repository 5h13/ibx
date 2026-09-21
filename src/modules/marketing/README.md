This module follows the shared expenses pattern in `src/shared/expenses`
(service + table + form + actions), wired to the `marketing` section via
`app/marketing/expenses/page.tsx`. There's nothing marketing-specific yet, so this
folder has no separate components/services — add them here once marketing needs
something beyond the standard Prepare/Review/Approve expenses flow.
