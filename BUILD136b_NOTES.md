# Build 136b — shop link previews show the product photo; products grouped by category

Deploy: `supabase db push` (migration `20270137_shop_by_category.sql`), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall137.sh` all passed (proof137 new).
Front page rendered with sample data at phone width.

## Link previews (Messenger, Viber, Facebook)
- An item link now previews with **the product photo**, the item name and store ("ADAPTOR, POKKA R134A RED — PILI-AIRE")
  and the price / brand / category — no more 5H13 logo. The photo is served at `/shop/<store>/item/<id>/photo`
  (only for items the open shop shows; cached for a day).
- The store page previews with the store's logo; the browser tab shows the store logo too.
- Messenger / Facebook remember a link's preview: a link already sent before this update may keep the old picture.
  New messages get the new preview (Facebook's Sharing Debugger can refresh an old one).

## Grouped by category
- Front page (no search or filter): category chips to jump to, then each category with its first 4 products and
  **See all (n)**, which opens the whole category.
- Search / filter results are listed under category headings ("Show more" as before).
