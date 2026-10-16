# Build 111 — ATON UI audit fixes (UIA-06, 08, 09, 10, 11)

No migration. Unzip over the project, then commit, push and wait for Vercel "Ready".

## UIA-11 — Create PO: Source PR list was empty
- Cause: the page filled the list from the query's error value instead of its data, so it was always empty.
- Fixed. Approved PRs not yet on a PO now show (including PRs from approved sales orders).
- Choosing a Source PR fills the PO lines from the PR (quantities and costs can still be changed).
- Those lines keep their link to the PR line, so the sales order → PR → PO chain shows the PO.
- The server refuses a PR that is not approved, is already on a PO, or a line that is not on that PR.
- With none waiting, the form says "No approved PRs waiting for a PO."

## UIA-06 — returned sale still "Completed"
- Storefront register and sale view show **Returned** (everything returned) or **Partly returned**, in colour.
- The stored status stays "completed" (closings, AR and reports are unchanged).
- The Return button is hidden once everything has been returned.

## UIA-08 — no confirmation after "Make sales order"
- A green notice stays on the Agent orders tab with the new order number and an **Open sales order** button.
- "Done this week" links each sales order.
- Sales / Revenue Pipeline opens on the Sales orders tab with that order highlighted (`?tab=orders&order=…`).

## UIA-09 — "Send to warehouse" asked for a DR No
- Removed. Approved / processing orders show **Issue DR at Storefront**, which opens Storefront → Orders,
  where DRs are numbered by the system and the Warehouse confirms release.
- The Prepare → Review → Approve clicks stay as they are; they will follow the store's operating mode (MODE-01).

## UIA-10 — approved order went to Procurement
- Working as designed: only lines marked "Order from supplier" become a PR. With no stock on record yet,
  short lines start as "Order from supplier". The agent-order form now says so and that a line can be
  switched to "From stock" when the goods are on hand.

## Checks
- typecheck and production build pass.
- No database change, so no new database proof.
