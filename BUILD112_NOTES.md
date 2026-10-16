# Build 112 — Create Quotation fixes (UIA-13 to UIA-16) and live preview

**Deploy:** `supabase db push` (one migration: `20270113_quote_discount_percent.sql`), then commit, push and wait for Vercel "Ready".

## Customer (UIA-13, UIA-14)
- The customer box takes typing: part of a name, code or phone lists the matches (same box as the counter sale).
- **+ New customer** under the box: name, phone, TIN, address → saved and selected at once, without leaving the quotation. The store is the new customer's agent (change it on the customer record).

## Enter key (UIA-15)
- Enter inside a field no longer saves and closes the quotation. Only **Save quotation** saves.
  (Enter still picks the first match in the customer box.)

## Discount (UIA-16) — whole quotation, ₱ or %
- A ₱ / % switch beside the Discount box.
  - %: the amount is worked out from the lines total ("= ₱1,250.00 off").
  - ₱: shows the percent it equals.
- Refused on screen, on the server and in the database: negative values, more than 2 decimals, more than 100%, more than the lines total.
- A % discount follows the lines total: when Procurement's supplier price changes a line, and on a revision (Revise keeps the %). A ₱ discount stays as entered.
- The quotation view and the printed quotation show "Discount (10%)" when a percent was used.
- Older quotations are not changed; a status change is never blocked by an old discount.

## Live preview
- A **Preview** panel at the bottom of Create Quotation, laid out like the printed quotation: customer, lines, subtotal, discount, other charges, total and the VAT line.
- It updates as each line, the discount, other charges or VAT is changed. **Hide preview** collapses it.
- Catalog prices in the preview are the screen's prices; the pricing engine confirms them when the quotation is saved.

## Checks
- typecheck and production build pass.
- Database: full replay of every migration, then proofs 78–107 and the new proof 112 — all pass
  (`tests/db-harness/runall112.sh`; proof89a was listed in the old script but is not in the project, so it was left out).
