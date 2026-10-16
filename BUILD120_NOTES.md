# Build 120 — My Profile as the staff home (time and leave)

No migration. Deploy: `git add -A`, commit, push.

## What changed
- **My Profile opens on "Time and leave"** (second tab: "My details" — sign-in, nickname, email, employee record).
  - Today: live clock, today's schedule, **Clock in → Start break → End break → Clock out** (one break a day),
    times so far, late minutes. Server time is used, not the device's.
  - **My leave**: balance per leave type for this year (left / used / pending), **Request leave** (type, dates,
    whole / half day, reason; overlap refused, over-balance warned), my requests with status, Cancel while waiting.
  - **My timekeeping**: pay period (or month) picker; days worked, regular / OT hours, late, undertime,
    absent / leave; each day's in / break / out; missing clock-outs flagged; **Correct** per day or
    **Request correction** for a missed day (creates the day record); my correction requests and status.
  - HR (Admin section reviewers / approvers) and the store's Business Admins are notified of each leave / correction.
- **Opening view**: sign-in and opening the installed app go to `/start` → My Profile until the person has
  clocked in today; after that (or on leave / holiday / rest day, or no employee record) → Dashboard as before.
- **Fix: "new row violates row-level security policy attendance_records_business_isolation"** on clock-in.
  The old clock-in saved no store, so the row took the ISHABELLA default and was refused for PILI / ATON.
  Admin → Timekeeping clock in / out now use the same path as My Profile (stamps the employee's own store);
  the admin "save attendance" form also stamps the store.

## Files
- src/modules/profile/myTime.ts (new) — self-service clock / leave / correction actions and the panel's data
- src/modules/profile/MyTimePanel.tsx (new)
- app/profile/page.tsx, app/start/page.tsx (new), app/login/page.tsx, app/page.tsx
- src/modules/admin/timekeeping/actions.ts

## Check after deploy
1. Sign in as a PILI or ATON staff member → lands on My Profile → Clock in (no error) → Start / End break → Clock out.
2. Sign out and in again the same day → Dashboard.
3. Request a half-day leave → shows "waiting for review"; HR sees it in Admin → Leave.
4. Correct a day → HR sees it in Admin → Timekeeping.
