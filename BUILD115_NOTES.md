# Build 115 — Quotation prices (UIA-18 to UIA-21)

**Deploy:** `supabase db push` (`20270116_quote_prices_history.sql`), then commit, push, wait for Vercel "Ready".

## Prices shown = prices saved (UIA-20)
- Each quotation line now gets its price from the same pricing engine the save uses (this store's add-on and markup, the item's cost basis, the customer's item discount). The form, the preview and the saved quotation show the same price. (The ₱1,575 vs ₱2,757 gap came from the form working the price out in the browser.)
- The price is re-fetched when the customer is changed (customer discounts).
- Under each line: **Store price (SRP)**, customer discount if any, **cost**, **floor**.

## Change a line's price (UIA-19)
- The unit price box can be typed on catalog lines.
- At or above the **floor** (7% over acquisition cost, never above the SRP) → accepted, marked "Price changed from ₱…".
- Below the floor → the line turns red: "Below the floor — the quotation needs the Sales approver". Only a Sales approver, Business Admin or Super Admin can approve that quotation (refused in the database for anyone else).
- An item with no cost on record: any price below the SRP is flagged the same way.
- **Use the store price** puts the engine price back.
- Under Single-operator mode (auto-approve), a below-floor quotation is approved with a warning kept on its record ("price_exception_warned").
- Revise ("new revision at current prices") re-prices every line at the current store price, as before — typed prices are not carried over.

## Whole-number quantities (UIA-18)
- Quantity box steps by 1; decimals are refused on screen, on the server and in the database (new or changed lines only).

## Price history (UIA-21)
- **Price history** under each line opens a panel with four tabs:
  1. **Store price (SRP)** — every cost, category add-on or markup change for this store, with the SRP it gave and who made it.
  2. **Cost** — every cost change: from → to, supplier, source, who.
  3. **Purchases** — every purchase per supplier: date, supplier code, PO, quantity, PO price, invoice price.
  4. **This customer** — the customer's earlier quoted and sold prices for the item.
- Sales (preparers included), Finance and admins can open it; others are refused.

## Quotation view
- Lines show "Below the floor … needs the Sales approver" or "Price changed from ₱…".
- Without VAT it now says "Prices are not subject to VAT."

## Checks
- typecheck and production build pass.
- Database: full replay, proofs 78–114 and the new proof 115 (13 checks) all pass — `tests/db-harness/runall115.sh`.
