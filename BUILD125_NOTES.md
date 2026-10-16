# Build 125 — Admin / HR set-up

Deploy: `supabase db push` (migration `20270125_admin_hr_setup.sql`), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall125.sh` 698 checks passed (proof125 new; proof91 updated for UIA-45).

## What changed

| # | Change |
|---|---|
| UIA-37 | **HR Master Data filled**: Departments from the names already used on employees and in the Back Office commission plans; Positions from the employees' titles; each employee linked. Choosing a department / position keeps the typed text in step. |
| UIA-40 | **Work schedule on Add / Edit Employee**: a "Work schedule" picker (empty = the store default) with a start date; past days keep the schedule they had. The employee list shows each person's schedule, or "No work schedule". **Store default schedule**: Timekeeping → Schedules → Store settings. Schedules can now be **edited** (days already calculated keep their hours until Recalculate). |
| UIA-38 | **No more silent 0h**: with no schedule the hours actually worked (less the break) count as regular hours, with no late or overtime, and the row shows "no schedule". The Attendance tab lists employees with no schedule. Hours worked on a scheduled day off count as overtime. |
| UIA-43 | **Attendance periods are automatic**: the pay cycle per store (semi-monthly 1–15 / 16–end by default, or monthly) creates the periods; every attendance day joins its period. **Lock** after the period ends (refused while a correction is pending); a locked day cannot be changed or added. **Reopen** (Business Admin, with a reason) only while no payroll run beyond draft uses it. **Payroll**: a payroll period is picked from a locked attendance period, and a run is refused unless every day of the period is locked. |
| UIA-42 | **Leave types: Edit and Deactivate** (name, paid, approval, default days, description). Cards read "No set entitlement" when no days are set. The "Requires approval" box now saves when unticked. |
| UIA-41 | **Leave balances**: "Grant leave for {year}" gives every current employee each leave type's default days, pro-rated by hire month, with optional carry-over (capped if wanted); granting again keeps days used and adjustments. **Adjust a balance** (+/− days with a reason, kept in a log and the audit trail; never below zero). New employees get this year's leave automatically. "Carried over" shown in the table and counted in My Profile. |
| UIA-45 | **Allowances: employees only**. Agent allowances are switched off (kept for history) and cannot be added. Agents still file expenses in the agent app, without an allowance check. |
| UIA-39 | **Business documents: Edit** — name, number, dates, notes, and attach or replace the file. Editing a verified document sends it back to Pending. A document can be verified only once its file is attached. |
| UIA-25 | **Recurring monthly expense**: on the expense form, "Repeats: every month at this amount" for N months (2–60) or until stopped. Approved once; each month after that the expense is created on the same day of the month, already approved, for Finance to post and pay ("month 4 of 12"). **Stop repeating** (department approver, the preparer or the Business Admin; reason kept). |

## After deploying
1. Timekeeping → Schedules → **Store settings**: pick the store's default schedule (pay cycle is already semi-monthly). Do this per store (Acting as).
2. Open Ma. Rochelle's 16 Oct row → **Recalculate**.
3. Leave balances → **Grant leave for 2026** (and adjust anyone who should differ).
4. HR Master Data → add **Work Locations**.

## Notes
- Leave types are shared by the three stores; an edit applies to all.
- Existing attendance days are linked to their periods by the migration; no period is locked until HR locks it.
- Payroll for any store now needs its attendance locked first.
