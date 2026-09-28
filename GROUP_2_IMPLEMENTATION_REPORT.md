# IBX Admin — Group 2 Implementation Report

**Group scope:** U010 (Employee Profile), U012 (Change History UI), and
completion of the U009 confidentiality item Group 1 deliberately deferred
(`fleet_drivers.license_no`). Group 1 is not re-implemented; its report
remains the authoritative record of that work.

---

## 1. Files Added
- `supabase/migrations/20260924_admin_driver_license_confidentiality.sql`
- `app/admin/employees/[id]/page.tsx`
- `src/modules/admin/employees/EmployeeProfile.tsx`

## 2. Files Modified
- `src/modules/admin/employees/confidentialActions.ts` — added `listEmployeeChangeHistoryAction`
- `src/modules/admin/employees/EmployeeManagement.tsx` — added a "Profile" link per row
- `src/modules/admin/fleet/actions.ts` — gated `license_no` writes behind the approver check
- `src/modules/admin/fleet/FleetManagement.tsx` — redacted `license_no` in the drivers table and registration form for non-approvers
- `app/admin/fleet/page.tsx` — split the drivers fetch into general + approver-gated confidential read, mirroring Group 1's employees list pattern

## 3. Files Deleted
None.

## 4. Database Migrations
One: `20260924_admin_driver_license_confidentiality.sql`. Additive only —
one new trigger function (`guard_fleet_drivers_license_no`) and one new
trigger on the existing `fleet_drivers` table. No new tables. No change to
any existing RLS policy. Reuses `is_admin_approver_or_super()` from Group
1's migration — no new role/permission primitive introduced.

U010 and U012 required **no migration** — both are presentation-layer work
over Group 1's existing structures, per the authorized boundary.

## 5. Tables/Functions/Policies/Triggers Changed
- New function: `public.guard_fleet_drivers_license_no()`
- New trigger: `fleet_drivers_guard_license_no` (before insert/update on `fleet_drivers`)
- No RLS policy was added, dropped, or modified anywhere in this group.

## 6. U010 Functionality Implemented
- New route `/admin/employees/[id]` — a full Employee Profile page reading
  exclusively from Group 1's structures: `employees` (general columns),
  `hr_departments`/`hr_positions`/`work_locations` (resolved via the new FK
  columns, falling back to the legacy free-text columns where a master
  hasn't been assigned yet), `employees` self-join for supervisor,
  `employee_emergency_contacts`, `fleet_drivers` (general fields), and the
  confidential structures below.
- Tabs implemented: **Personal, Employment, Contact, Emergency Contacts,
  Driver, Government/Confidential, Documents (placeholder), Change History**
  (Super Admin only — see §9).
- **Documents tab is an explicit placeholder**, not a built feature — it
  states plainly that U021/U022/U024 aren't implemented yet and links to the
  existing `/admin/documents` list. No fake buttons, no invented workflow.
- **Driver license reads from `fleet_drivers`, not duplicated** — confirmed
  no new columns were added to `employees` for this.
- A "Profile" link was added to the employee list (`EmployeeManagement.tsx`)
  alongside the existing Edit/Delete actions.
- **U011/U019 were not touched** — the Profile has no self-edit capability
  anywhere; all fields render as read-only text. No new route was added
  outside `/admin/employees/[id]`.

## 7. U012 Functionality Implemented
- Change History tab renders `audit_log` rows for the viewed employee
  (`entity_table in ('employees','employee_government_ids')`,
  `entity_id = employee.id`), showing actor, action, timestamp, and
  Group 1's `field_changes` where present.
- Records with no `field_changes` (older rows, or rows from other write
  paths) render without it — no error, no fabricated diff.
- **This tab is gated to Super Admin only** — see the audit-authorization
  finding in §13, this was a deliberate stop-and-report decision, not an
  oversight.

## 8. U009 Confidentiality Controls Implemented
- **`fleet_drivers.license_no` (newly completed this group):**
  - Write: DB-enforced via the new trigger, regardless of which Supabase
    client is used to write — same defense-in-depth pattern as Group 1's
    `notes`/`employee_government_ids` guards.
  - Read: application-layer redaction in `app/admin/fleet/page.tsx` (general
    fetch excludes it, approver-gated fetch merges it back in) and in the
    new Profile page's Driver tab (same pattern). This is the **same known
    limitation** already documented for `notes` in Group 1 — RLS cannot
    express a column-level restriction on a table that also carries general
    fields, so the read boundary here is disciplined server-side
    projection, not RLS. Not silently presented as fully DB-enforced.
  - UI: `FleetManagement.tsx`'s drivers table and registration form now show
    "Confidential" / hide the input for non-approvers.
- **Government IDs, `employees.notes`:** unchanged from Group 1, now
  surfaced correctly in the Profile (approver-gated fetch, same
  `confidentialActions.ts` functions, no new access path created).
- **Verified: non-approver props never contain confidential values** — the
  server page (`app/admin/employees/[id]/page.tsx`) only calls the approver-
  gated fetches when `isApprover` is true; a non-approver's `notes`,
  `governmentIds`, and `driver.license_no` are `null`/`[]` at the server
  component level, before any HTML is ever generated — not just hidden by a
  client-side conditional.

## 9. Tests Performed
- `npm run typecheck` — passes for every file touched in this group (same
  one pre-existing, unrelated `app/layout.tsx` CSS-import error as Group 1;
  not introduced by this group).
- Manual trace of the Profile page's data-fetching logic for four viewer
  types (Super Admin, Admin approver, Admin non-approver, ordinary
  employee-with-no-admin-access) confirming which confidential fetches each
  one triggers:
  - Super Admin: all tabs, including Change History.
  - Admin approver: all tabs except Change History.
  - Admin non-approver (preparer/reviewer): Government/Confidential tab
    shows the "not authorized" message, Personal tab's Notes field shows
    the same, Driver tab's license number shows "—", Change History tab
    doesn't render at all (filtered out of `visibleTabs`).
  - Ordinary employee with no admin-section access: redirected to
    `/dashboard` before any data is fetched (`canManage` check) — confirmed
    this matches the existing Fleet/Employees page's own gate pattern, not
    a new one.
- Manual review of the new trigger's SQL against the exact table/column
  names in the existing schema (no invented columns).
- Grep-confirmed no other file in the codebase reads/writes
  `fleet_drivers.license_no` besides the three touched here and the one
  flagged, untouched Logistics file (§13).

**Not executed (no live Supabase instance available in this container):**
running the new migration, an actual RLS/trigger test against a database, or
a live browser-session test of the four viewer types above. This is stated
plainly, consistent with Group 1's report — static/manual review only.

## 10. Tests Passed
All manual/static checks in §9 passed (typecheck clean, data-flow trace
confirms no confidential leakage in server-rendered props for unauthorized
viewers, grep confirms scope of `license_no` usage is fully accounted for).

## 11. Tests Not Executable, and Why
- Live migration execution, live RLS/trigger firing, live multi-role browser
  testing — no live Supabase project is reachable from this container.
  Recommend running the Phase 2 plan's §9 test matrix (now including this
  group's additions) against a staging project before production use.

## 12. Known Deviations
- `fleet_drivers.license_no` read protection is application-layer, not
  RLS/DB-enforced (same class of limitation as `employees.notes` in Group
  1) — documented, not hidden.
- The Profile's Employment tab prefers the new controlled-master name
  (`department_master.name`) but falls back to the legacy free-text
  `department` column when no master is assigned yet — this means two
  employees could display differently (one via master, one via free text)
  until the reconciliation the Phase 2 plan flagged (U013) is done. Not a
  bug, but worth your awareness.

## 13. Security Findings Discovered

**(a) Audit-authorization finding — Change History scope, per your
instruction to stop and report rather than invent a policy:**
`audit_log`'s only SELECT RLS policy in the entire schema is
`audit_select_super_admin` (`is_super_admin()` only) — there is no
section-scoped read policy anywhere, despite a nearby code comment implying
one ("readable within section context"). The one existing consumer of
`audit_log` for display, `app/integration/page.tsx`, is itself gated to
Super Admin only at the JS layer, confirming this is the actual established
system-wide model, not an oversight I'm the first to notice. Given this, I
implemented Change History as **Super Admin only**, using a user-scoped
client so the restriction is genuinely DB-enforced (RLS), rather than
inventing a new "Admin approvers can see their own section's audit trail"
policy on my own authority. **If you want Admin approvers to have Change
History access, that's a deliberate audit-access policy decision for you to
make** — I did not make it for you.

**(b) Discovered out-of-scope dependency — Logistics still reads
`license_no`:**
`app/logistics/warehouse-delivery/page.tsx` actively selects and displays
`fleet_drivers.license_no` (as a fallback label when no employee name is
available) during delivery dispatch. This directly conflicts with the
approved Confidential classification, but the file is Logistics-owned and
outside this group's (and this entire workstream's) authorized boundary.
**I did not modify it.** Per your instruction 12 ("if a dependency is
discovered that requires an out-of-scope change, stop and report it"),
flagging this for your decision: either the audit workstream addresses it
directly, or you authorize a small, explicitly-scoped Admin-side exception
to touch that one file. Left entirely alone in this group.

**(c) Restated from Group 1, still relevant here:** the service-role-client/
RLS-bypass finding continues to apply — this group's new confidential reads
(government IDs, Change History) deliberately use the user-scoped client for
exactly this reason, consistent with Group 1's approach.

## 14. Anything Intentionally Left Untouched
Everything on the Group 2 "OUT OF SCOPE — DO NOT TOUCH" list: A001, U023,
U025 Procurement integration, U029, E002, U004, U026, U002, U003/U005
Finance workflow, U006, U007, U018, U019, U020, U021/U022, U024, U027–U032
beyond Group 1's structures, U036, U034/U035, P001. Also: U011 self-service
(no self-edit, no new self-service RLS/trigger, no employee portal nav — the
Profile is Admin-facing only), and the Logistics file in §13(b).

## 15. Confirmation
A001 and every item on the blocked list remain untouched. No `business_id`
or `businesses` architecture was introduced. No new role/permission system
was created — every access check in this group reuses `is_super_admin()`,
`has_workflow_role()`, and the existing `app_role`/`workflow_role`/
`user_access` primitives exactly as Group 1 established them.

**E001 status is unchanged from Group 1: repaired, pending independent
audit verification — not reported as audit-closed.**
