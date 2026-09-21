# IBX — Ishabella Commission & Sales Management System

Department-partitioned web app: Prepare → Review → Approve workflow, per the
build plan (full_build_plan.docx). Stack: Next.js 14 (App Router) + Supabase
(Postgres, Auth, RLS).

## What's in here

```
supabase/
  schema.sql        # tables, enums, RLS policies, section + month seed
  seed-users.mjs     # creates the 4 test auth accounts (Admin API)
  .env.example
app/
  login/              admin/expenses/        finance/expenses/
  dashboard/          logistics/expenses/    marketing/expenses/
  sales/expenses/     sales/monthly-sales/   approvals/  settings/users/
  api/                # thin GET wrappers over the same services, per module
src/
  core/auth/          # supabase clients, session profile, role guard
  core/layout/         # Header, Sidebar, AuthedShell
  core/utils/           # StatusBadge, current-month helper
  shared/expenses/      # generic Prepare/Review/Approve module (admin/finance/logistics/marketing/sales)
  shared/sales/          # sales-specific monthly agent sales (Ikot-style)
  modules/<dept>/        # per-module notes — currently thin wrappers over shared/
```

## Setup

1. **Create a Supabase project**, then in the SQL editor run `supabase/schema.sql`.
2. **Seed test users:**
   ```bash
   npm install @supabase/supabase-js   # if not already installed
   cp supabase/.env.example supabase/.env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
   node supabase/seed-users.mjs
   ```
   This creates 4 accounts, all sharing the password `5h13`:
   - `super.admin@ibx.test` — bypasses RLS, sees every module
   - `preparer.sales@ibx.test` — can create/submit Sales entries
   - `reviewer.sales@ibx.test` — can move Sales entries prepared → reviewed
   - `approver.sales@ibx.test` — can move Sales entries reviewed → approved
3. **Run the app:**
   ```bash
   npm install
   cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
   npm run dev
   ```
4. Sign in at `/login` with any of the test accounts above.

## What's deliberately not built yet

- **Real users / roles for the other four sections** (admin, finance, logistics,
  marketing) — only Sales has test workflow grants seeded, since that's what
  was asked for. Add rows to `user_access` (or extend `seed-users.mjs`) to
  test the other modules the same way.
- **`financial_summary` population** — the table and RLS exist, but nothing
  computes it yet. Wire a Postgres trigger/function or a scheduled Edge
  Function that recalculates it when entries hit `approved`.
- **Staff-minimal view distinction** — right now anyone with *any* workflow
  role in a section sees full section detail (`isStaffMinimalView` in
  `src/core/auth/types.ts`). If a true "staff, no workflow role" tier is
  needed later (build plan section 4: totals + own entries only), that
  function is where to add it.
- **Real user provisioning UI** — `/settings/users` is read-only for now;
  creating auth users still requires the Admin API (a route calling
  `supabase.auth.admin.createUser`, same as the seed script), not a raw
  insert.

## Build order this follows

Framework (schema + auth + layout + workflow engine) → functional modules
(expenses pattern reused across all 5 departments, sales gets its own
monthly-sales module) → user/role definitions last (currently just the 4
test accounts; real users are a `user_access` seeding exercise once the
modules are validated).
