# Build 114 — Order DR window: why it can't deliver yet, and switch to stock

**Deploy:** `supabase db push` (`20270115_order_dr_waiting.sql`; Build 113's `20270114` first if not pushed yet), then commit, push, wait for Vercel "Ready".

## Storefront → Orders → Issue DR
- A summary line on top: **Order total**, **Delivered so far**, **Still to deliver**, and the order's PR / PO.
- Each "order from supplier" line says what it is waiting for:
  - "Waiting for a PO — ATON-PR-… has no PO for this line yet (Finance → Procurement → Create PO, Source PR)"
  - "Waiting for PO … to be approved" / "… to be issued to the supplier"
  - "Waiting for the goods — PO … is issued; Logistics posts the goods receipt when they arrive"
- When **Issue DR** is greyed out, the reason is shown under it.

## Goods already on hand? Switch to stock
- On a line that is "order from supplier", has **no PO yet** and **nothing delivered**, a Sales approver, Business Admin or Super Admin sees **"Goods on hand? Switch to stock"** (a reason is required).
- The line becomes "from stock" (reserved for the order like any stock line); it is taken off the PR and the PR estimate is recomputed. A PR left with no lines is marked **cancelled** and no longer appears in Create PO → Source PR.
- Refused once a PO exists for the line, after any delivery, or for a cashier. Written to the audit log with the reason.
- After switching, open **Issue DR** again to deliver it.

## Checks
- typecheck and production build pass.
- Database: full replay, proofs 78–113 and the new proof 114 (13 checks) all pass — `tests/db-harness/runall114.sh`.
