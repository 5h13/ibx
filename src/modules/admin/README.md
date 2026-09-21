This module follows the shared expenses pattern in `src/shared/expenses`
(service + table + form + actions), wired to the `admin` section via
`app/admin/expenses/page.tsx`. There's nothing admin-specific yet, so this
folder has no separate components/services — add them here once admin needs
something beyond the standard Prepare/Review/Approve expenses flow.
