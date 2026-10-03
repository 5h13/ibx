# Database test harness

Replays the whole migration chain on a plain local PostgreSQL 16 and runs the
proof scripts against it. Nothing here touches the live Supabase project.

- `stubs.sql` — stand-ins for what Supabase provides (`auth.uid()` from the
  `request.jwt.uid` setting, `auth.role()`, `auth.users`, `storage.buckets`,
  the `anon` / `authenticated` / `service_role` roles).
- `replay.sh [db] [last-migration]` — fresh database, then `schema.sql` and
  every migration in order, each as one transaction (as `supabase db push`
  does). With a second argument it stops after that migration.
- `seed78.sql` — two stores' users (PILI, ATON: business admins, cashier,
  sales approver, finance, logistics), locations, suppliers, three items and
  pricing rules, with fixed ids.
- `lib.sql` — proof helpers: `proof.as_user(id)` (RLS on, as that user),
  `proof.as_owner()`, `proof.ok(condition, label)`,
  `proof.fails(sql, expected message, label)`, `proof.set/get` for ids.
- `proof81.sql` — Build 81 (AR-01 / AP-01): DR / SI references on AR invoices and the statement of account, AP references (supplier SI / DR, PO), supplier statement, access (after proof80). `runall81.sh` runs replay + seed + proofs 78–81.
- `proof80.sql` — Build 80 (EXP-01): expense categories, Finance posting / paying into the ledger, prepaid spread, accruals, 13th month from payroll, isolation (after proof79). `runall80.sh` runs replay + seed + proofs 78–80.
- `proof79.sql` — Build 79: price and cost by lot, order-only items, delete unused items (after proof78).
- `proof78.sql` — Build 78: lots, reservation, hardcopy DR no., price review,
  isolation, plus a regression section (AR, returns, closing, count rejection).
- `proof78_backfill_before.sql` / `_after.sql` — stock recorded on a Build 77
  database gets its lots when the Build 78 migrations are applied.
- `run.sh <db> <file>` — runs a proof and prints only headers, PASS lines and
  errors. `runall79.sh` runs everything above.

Usage (Ubuntu with PostgreSQL 16, from the project root):

    service postgresql start
    su postgres -c "bash tests/db-harness/runall79.sh"

Note: the proofs of Builds 67–77 lived only in earlier working containers and
were not shipped; from Build 78 on the harness is part of the project.
