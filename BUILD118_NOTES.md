# Build 118 — VAT choice and Issue SI on the counter sale

**Deploy:** `supabase db push` (`20270118_counter_sale_vat.sql`), then commit, push, wait for Vercel "Ready".

## New counter sale
- **VAT:** "With VAT (12% included in the price)" or "Without VAT" on every sale. It starts on With VAT when the store's main booklet is VAT-registered, otherwise Without VAT. With VAT shows the VAT and VATable amounts at once.
  - Prices stay VAT-inclusive (VAT = price × 12/112), as before; the customer pays the store price either way.
  - The choice also applies to a **DR-only** sale (before, a DR-only sale never had VAT).
- **Issue SI** is now its own tick box next to Issue DR; the SI number box appears when ticked.
- The same Issue SI tick box is on "Take payment" (approved sales) and the order DR window.

## Two SI booklets per store (Storefront → Store settings)
- **Second SI booklet (optional):** the other kind from the main booklet. Example for ATON: main = ISHABELLA's VAT booklet, second = ATON's own non-VAT booklet.
- With VAT + SI → the SI is from the store's VAT-registered booklet; Without VAT + SI → from the non-VAT one. SI numbers are checked per booklet.
- If the store has no booklet of the chosen kind, the SI is refused with a message — issue the DR only, or add the booklet.
- A second booklet of the same kind as the main one is refused.

## Unchanged
- Sales-order DRs follow their quotation's VAT (the SI comes from the matching booklet).
- Sales made before this build keep their VAT.
- VAT reaches AR and the books through the daily closing, as before.

## Checks
- typecheck and production build pass.
- Database: full replay, proofs 78–116 and the new proof 118 (11 checks) all pass — `tests/db-harness/runall118.sh`.
