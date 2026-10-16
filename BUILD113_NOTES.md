# Build 113 — Operating modes per store (MODE-01, part 1)

**Deploy:** `supabase db push` (`20270114_operating_modes.sql`; Build 112's `20270113` first if not pushed yet), then commit, push, wait for Vercel "Ready".
Nothing changes until a mode is set: every store starts in **Full** (today's flow).

## Where
System → **Operating Modes** (Super Admin only). One card per store: choose Full, Skeletal, Single-operator or Custom, then **Save mode**.
A Business Admin cannot change it (refused in the database too).

## What each mode does
| Mode | Every approval point |
|---|---|
| Full multi-department | Prepare → Review → Approve, by different people (as today) |
| Skeletal manning | Prepare → Approve: when an approver presses **Review**, the document is approved in the same step. Still a second person; the preparer cannot approve their own |
| Single-operator | **Auto-approve**: when the document is prepared, the system reviews and approves it at once, stamped with the operator and recorded as "auto-approved under Single-operator mode" |
| Custom | Choose per approval point: Review + approve / Approve in one step / Auto-approve |

Working now (part 1): Quotation, Sales order / go-signal, PR, PO, Supplier payment, Goods receipt, Expenses.
Saved but not yet working (part 2, Storefront): DR release, Returns / refunds, Price / discount exceptions — the screen marks them.

## Rules kept in every mode
- Every step still runs and creates its document (Quote → PR → PO → Receiving → Inventory → DR, AP / AR). Posting a receipt, posting / paying an expense and issuing a PO stay separate actions.
- Document numbers, the audit trail, stock movements and business isolation are unchanged.
- **Switching** applies to new documents only: each document records the rule it was created under. Documents made before this build follow the store's current setting.
- Users and roles are not changed by a mode.
- Every mode change is in the audit log (from / to, who, when).

## Dashboard
Business Admin and Super Admin see **"Approved without a second person — last 7 days"**: each auto-approved or one-step-approved document, the mode that allowed it, and who prepared / approved it. (The list of warned exceptions — below-floor price, late entry, cancellation, reused reference — comes with part 2.)

## Not in this build (part 2)
- Storefront: DR release, returns / refunds, below-floor price, late entry, cancellation, reused payment reference, daily closing — with the on-screen warning and the warning kept on the document's record, listed on the dashboard.
- Screens still show the usual buttons; under Skeletal the **Review** button approves, under Single-operator **Prepare** approves.
- Auto-approval does not send the "please review / approve" notifications (there is no one to review).

## Checks
- typecheck and production build pass.
- Database: full replay, proofs 78–112 and the new proof 113 (26 checks) all pass — `tests/db-harness/runall113.sh`.
