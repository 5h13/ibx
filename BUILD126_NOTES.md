# Build 126 — Cash advance and calculator

Deploy: `supabase db push` (migration `20270126_cash_advance.sql`, after Build 125's), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall126.sh` 722 checks passed (proof126 new, 24 checks). Calculator keys and "Use" tested in a browser.

## Cash advance (UIA-44)
| Step | Who | Where |
|---|---|---|
| Request: amount, 1–12 payments, reason | Employee | My Profile → Time and leave → Cash advance |
| Approve / reject (with reason) | Business Admin | Admin → Cash Advances |
| Release the cash (cash on hand or a bank account) | Finance (or Business Admin) | Finance → Cash Advances |
| Repay: each payroll run deducts the instalment | Automatic | Payroll run (Deductions shows "incl. cash advance") |

Rules: at most **half a month's pay** (from the employee's payroll profile: daily × 26, hourly × 8 × 26); **1–12 payments** (6 months, semi-monthly); **one open advance at a time**; **no interest**; **employees only**; the employee cannot approve their own; the pay must be set up in payroll first.

Repayment: the instalment (amount ÷ payments; the last one takes the rounding). A voided payroll run gives its deduction back. An employee marked **Separated** has the whole balance taken from the next (final) pay — never more than the pay left after other deductions; anything still left shows as owed on Cash Advances.

Books: release — Dr 1330 Advances to Employees, Cr cash / bank. Payroll — Cr 1330 for the amounts recovered (net pay due is lower by the same amount). Account 1330 is added to each store's chart of accounts.

Notifications: request → Business Admins; approved → Finance approvers and the employee; rejected / released → the employee.

## Calculator (UIA-26)
- 🧮 button in the office header (and the phone header bar) and in the agent app header.
- Floating panel: drag it aside on a PC; slides up from the bottom on a phone. Keyboard works (digits, + − * /, Enter, Backspace, Esc).
- Business keys: **+VAT / −VAT** (12%, shows the VAT amount), **Disc %** (amount, Disc %, percent, =), **Markup** (cost, Markup, percent, =), **Margin** (price, Margin, cost, = → margin % of price).
- **Use** puts the result into the field you last clicked (e.g. a price or quantity box); **Copy** copies it.
- Tape of the last 30 calculations kept on the device; tap a line to reuse its result.
