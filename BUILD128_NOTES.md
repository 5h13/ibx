# Build 128 — Sales Manager: Team and Sales screens load

Deploy: `supabase db push` (migration `20270128_manager_month_fix.sql`). No app code changed — no redeploy needed, but committing keeps the repo in step.
Checks: DB harness `runall128.sh` 751 checks passed (proof128 new: the month, team and client figures load in a read-only request; proof127's figure checks pass on the new version).

Cause: the month figures (Team, Sales) and the client page were worked out in temporary tables. A read-only database request refuses that, so those screens failed while Today, Approvals and Collections loaded. The same figures are now worked out in one read-only query each. The client page (tap a client) had the same problem and is fixed too.
