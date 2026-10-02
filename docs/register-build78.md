# Register update — Build 78 (2026-10-02)

Status changes to `final-consolidated-punchlist.md` made by Build 78. Read together with that register (its item text is unchanged).

| Item | Was | Now |
|---|---|---|
| U062 Inventory Lots / Cost Layers / Product Aging | Confirmed/Open (decided 2026-10-02) | **Build 78: Closed** — every receipt line is a lot (supplier, purchase price, date); opening count = first lot; movements, transfers, counter sales, order DRs and returns record the lot; lot balances per location, aging buckets, trace to customers; purchase-price history per item from receipts. Cost of sales stays at the weighted average (owner, 2026-10-02): no cost layers by design. |
| LOG-23 Lot / batch and expiry at movement level | Confirmed/Open | **Build 78: Closed** — with U062 (supplier batch and expiry kept on the lot). |
| U063 Flexible Inventory Allocation / DR Traceability | Confirmed/Open (decided 2026-10-02) | **Build 78: Closed** — "from stock" lines of approved orders reserve stock (ordered − released, live); on hand / reserved / available on the counter, Orders tab, Product Search and product page; a counter sale dipping into reserved stock needs an approver; reservation released on DR release or order cancellation (new Cancel order); each DR line carries its lot and can be split across lots; the Warehouse sees the lot to pick. Negative stock stays a warning. |
| CAT-36 Quick price review | Confirmed/Open — scope to confirm | **Build 78: Closed** — Sales → Price Review (also under Finance): filter by category / brand / supplier, markup or store price inline, category add-on, change log with who / when / old / new; no approval. |
| CAT-19 / CAT-29 | Replaced by CAT-36 | Closed with CAT-36. |
| SF-29 Hardcopy DR no. on Storefront sales | Confirmed/Open | **Build 78: Closed** — optional on counter sales and order DRs, unique per store (spaces / case ignored), searchable (register, return lookup), on the DR print and lot traces. |

Other Build 78 changes
- Found while proving: the weighted-average entry was keyed by the receipt, so a second line of the same item on one receipt would have been left out of the average; now keyed by the lot.
- The catalog pricing history now records who made a change (it recorded the rule's creator).
- The database test harness ships in `tests/db-harness/` from this build.

Still open (unchanged): CP-01 Customer Portal (delivery coverage and fees to supply); Next.js 14.2.35 security update before outside users log in; owner's catalog clean-up upload with opening stock (LOG-46 at go-live); live checks of a goods receipt and a stock transfer.
