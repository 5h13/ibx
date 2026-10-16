# Build 120 — My Profile as the staff home (time and leave)

Deploy: `supabase db push` (`20270120_paste_match_sizes.sql`, matching only), `git add -A`, commit, push.
(The My Profile part was already committed by the owner as "my profile update"; this adds the Paste list fixes below.)

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

## Paste list fixes (owner's test with a supplier DR photo, 2026-10-16)
- **Sideways photos**: the picture is turned upright first (camera orientation, then the direction with the most
  clear words); a "Turn ↻ and read again" link if it still reads wrong. Tables are read row by row.
- **Only products are read from a supplier document**: when the text has several item rows carrying amounts or stock
  codes, the letterhead, address, phone, e-mail, Bill To, names and totals are dropped. Each row keeps its
  description and quantity; the supplier's stock code, location code, rate and amount are taken off
  (common misreads handled: "pe"/"pec" for pc, "SO" for 50, "4(" / "13]" / "60|").
  Tested on the Winterpine DR photo: 13 of 13 rows, right quantities. A plain client list is read as before.
- **Matching** (migration 20270120): sizes stay whole (1/4, 3/8, 0.71), so the four Soft Drawn sizes are told apart;
  joined / split words match ("Soft Drawn" ↔ SOFTDRAWN). A match on the size plus a word is taken even when the
  supplier's wording has extra words. proof120 (9 checks).
- **Goods receipt**: "Read supplier DR" is on **ad-hoc receipts only** (no PO), matched against the whole catalog
  and then the item's stock record. Quantities fill the delivered quantity; for users who may see costs the DR's rate
  fills the unit cost, shown "from DR" and not editable. A PO receipt fills itself from the PO (quantities only).

## Tests
- typecheck, production build; tests/db-harness/runall120.sh: proofs 78–120, 650 checks, 0 failed.

## Faint prints (owner's JYQL DR photo, 2026-10-16) — no migration
- When the plain read is mostly noise, the picture is cleaned up and read again automatically: the colour channel
  where the print is darkest, lighting evened out, contrast stretched, enlarged and softened (dot-matrix dots
  join), read word by word with the rows rebuilt from where each word sits (bent / slanted pages).
- From such a print only the **item names** are taken: row numbers and prices are dropped and quantities are not
  guessed — every line starts at 1, marked to check against the paper (a note says so in the Paste list box).
- JYQL photo: 14 of 17 item names readable (before: nothing). The clear Winterpine DR still reads 13 of 13 with
  quantities. Very faint prints may still need some lines typed by hand.

## Paste list on the counter New Sale — no migration
- Storefront → New sale: **Paste list** button next to the item search. Same box as on quotations (text, screenshot,
  photo or PDF). Each picked line is priced by the counter's own pricing (store price, current stock / lot), exactly as
  if picked one by one; the same item already on the sale gets its quantity added.
