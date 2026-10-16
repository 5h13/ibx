# Build 116 — Operating modes at the Storefront (MODE-01, part 2)

**Deploy:** `supabase db push` (`20270117_operating_modes_storefront.sql`), then commit, push, wait for Vercel "Ready".
Stores in **Full** or **Skeletal** mode work exactly as before. The rules below apply where the Storefront points are on **Auto** (Single-operator, or Custom with these set to Auto).

## Locked out (refused — no approver path)
| What | Point | Message |
|---|---|---|
| Counter price below **3% over acquisition cost** | Counter exceptions | "… priced below 3% over its cost (lowest allowed ₱…)" |
| A GCash / Maya / card / bank **reference used twice** | Counter exceptions | Refused even for an approver |
| **Refund by a different method** than the customer paid (e.g. cash for a card payment) | Returns | "Refunds go back the way the customer paid" |
| **Cancelling a completed sale** | Returns | Button hidden; use **Return** for everything instead |

## Automatic
- **DR release:** an order DR releases the goods when it is issued (stock leaves then; the movement says "Released with the DR (Single-operator mode)"; released by the person who issued it).
- **Daily closing:** approved when submitted and sent to Finance as usual. A cash short / over is listed as a warning. If it cannot post (e.g. a receiving account is missing), it stays "submitted" and the reason is listed as a warning.

## Allowed with a warning
- Counter sale **below the 7% floor** (but not below 3%), **late entry**, item with **no cost on record**, or taking **reserved stock**: the sale completes at once; the cashier sees "Warning recorded for the owner: …".
- A quotation with lines below the floor auto-approved (Build 115) is listed too.

## Where the owner sees them
- **Dashboard → "Exceptions to review — last 7 days"** (Business Admin, Super Admin): store, document, what happened (e.g. "Counter sale ₱105.00: below the 7% floor", "Daily closing: short ₱200.00"), mode, who.
- Each warning is also kept in the document's audit trail.
- The Storefront shows a short yellow note of the store's mode rules at the top.

## Settings screen
System → Operating Modes now describes what Auto means for the three Storefront points:
- DR release (Warehouse)
- Returns, refunds and cancellations
- Counter exceptions and daily closing

## Checks
- typecheck and production build pass.
- Database: full replay, proofs 78–115 and the new proof 116 (16 checks) all pass — `tests/db-harness/runall116.sh`.
