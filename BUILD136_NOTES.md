# Build 136 — PILI-AIRE online catalog (CP-01 stage 1, per-store shop engine)

Deploy: `supabase db push` (migration `20270136_online_shop.sql`), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall136.sh` all passed (proof136 new: 18 checks).
Catalog and item pages rendered with sample data at phone width.

## Turn it on (after deploying)
1. As the Business Admin of PILI (or the Super Admin acting as PILI): **Sales → Online Shop** — paste the Facebook
   page's Messenger link (`https://m.me/…`), the Viber number and a tagline. Phone, email and address come from
   System → Businesses.
2. As the **Super Admin** (acting as PILI): **Open the shop to the public**.
3. Visit **https://5h13.vercel.app/shop/pili** (no login). ATON (`/shop/aton`) and ISHABELLA (`/shop/ishabella`) are
   ready but stay off until switched on.

## What visitors see
- The store's logo and colours (System → Businesses → branding), name, tagline; Messenger / Viber in the header.
- Search (same word matching as the counter) and Category / Item / Brand filters; product cards with photo,
  name, brand and price; "Show more".
- **Only active items with at least one photo.** Price = the store's price; "Ask for price" when it has none.
- Item page: up to 3 photos (swipe), category · item · brand, price per unit, specification, description;
  **Ask about this item** on Messenger / Viber / Text (the message names the item, its price and the link) or Call;
  **Share this item** (phone share sheet, or copies the link).
- Never shown: stock, cost, markup, suppliers, item codes. Photos are served through 1-hour links.
- `/shop` lists the open store shops for now (the 5H13 all-stores shop with delivery areas comes next).

## Security
Visitors read only through `shop_store`, `shop_list`, `shop_catalog`, `shop_filters`, `shop_item`, which return only
public fields and nothing when the shop is off. The tables themselves return no rows to a visitor (row security,
checked in proof136). Nothing a visitor does writes to the database. The Business Admin edits contacts; only the
Super Admin opens or closes a shop; every change is in the audit log.
