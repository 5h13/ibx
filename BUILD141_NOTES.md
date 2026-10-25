# Build 141 — Studio, photo touch-up, pictures on the shop, SPEC 1–10 in the catalog file

25 October 2026. From 5h13Shops Builds 11–14 (OCR left out), adapted to the ERP. Build 140 (Make quotation, email,
Share, Other versions, filters) is skipped for now.

## Deploy (you)
1. `npm install` (adds the `qrcode` package, for the QR code on printed price lists)
2. `npx supabase db push` → **Y** (migration `20270142_studio.sql`)
3. `git add .` → `git commit -m "Build 141: Studio, photo touch-up, SPEC 1-10"` → `git push`
About 16 MB of new files (`public/ai`, the photo touch-up's background remover) and 17 font files go into the
repository; that is expected.

## What's new

**Studio** (Marketing → Studio, and Sales → Studio)
- **Who can use it:** the store's Business Admin, Sales Manager, Sales staff and Marketing staff.
- **What it is:** pictures made from this store's catalog (items with a photo), at the store's **shop prices**, marked
  Available / By order. Cost and agent tiers never appear. Everything is drawn on your own phone or computer.
- **Specs card:** Portrait 4:5, Square, Landscape or Story 9:16. Options:
  - On sale (old price crossed out, % badge)
  - Promo ribbon
  - Announcement strip
  - "Ask for price"
- **Price lists:** with photos (up to 8 items), or a printable A4 with an optional QR code to the shop. Print / Save
  as PDF.
- **Banners:** with product photos, a big number (discount), or an announcement (text only). Square or wide.
- **New arrivals / Back in stock:** 4 or 6 products.
- **Look:** 5 colour sets, 5 headline fonts (the chosen font is saved for the store), and editable store name,
  tagline and contacts line.
- **Saving:**
  - **Download**, **Share…**
  - **Post on my shop as the promotion**, or **as an announcement**
  - **Post to Facebook**: a ready caption you can edit. On a phone, the caption is copied and the share menu
    opens. On a computer, the picture downloads, the caption is copied and Facebook opens.
- **Use my own photo** (camera or gallery) and **Touch up** in the Studio. A touched-up photo is used in that
  picture only.
- The old Banner Studio and Specs Card stay under Marketing, marked "(old)", until you're happy with the new Studio.

**Photo touch-up** (Finance → Catalog Photos)
- **Add / Replace** opens the editor first:
  - The background is removed on the phone or computer by a small AI model (about 16 MB, downloaded the first time
    only). A simple remover is kept for when there's no internet.
  - Backdrops (white, warm stone, dark podium…), shadow, size and turn.
  - The result is a square 1080 × 1080 photo.
  - **Use the photo as it is** skips the editor.
- **Touch up** on a saved photo, too.
- No store logo is stamped on catalog photos (they're shared by every store); Studio pictures carry the store's own
  logo.

**Pictures on the shop**
- A Studio picture posted as the **promotion** replaces the promo card in every layout. Tapping it opens its item.
- A picture posted as an **announcement** shows in the announcements; in layout C it shows in the sliding banner.
- Sales → Online Shop → Posts shows the picture ("Picture from the Studio"). Removing the post deletes the picture.

**Catalog file: SPEC 1 … SPEC 10**
- **New columns:** the import template and the export have **SPEC 1 … SPEC 10** in place of SPECIFICATION. Each cell
  is one spec written **Label: Value**, e.g. `Voltage: 12V`.
- **Import errors:** a cell that isn't `Label: Value` stops the import with its row and column, e.g. "Row 5: SPEC 3
  "with resistor" — write it as Label: Value".
- **Older files** with one SPECIFICATION column still import as before.
- **Specs past 10 lines** are kept together in SPEC 10 (one per line in the cell), so an export → import round trip
  loses nothing.
- **The item form** still has one Specification box (one spec per line, Label: Value).

## Checks run (all passed)
- **Database:** proof142, 15 checks:
  - sales staff see the catalog items with photos; no cost
  - logistics refused
  - the font is saved
  - posting is allowed only into the store's own folder
  - an end date in the past is refused
  - sections are switched on
  - visitors see the promotion and announcement pictures
- **Regression:** all earlier test files pass (51).
- **SPEC conversion:** 12 specs → SPEC 1–10 → back is identical; a plain-text cell is flagged with its column.
- **Code:** type check and production build (`next build`).
- **Phone-size render (390 px):** specs card, price list, banner and new arrivals draw, with no page errors and no
  sideways scrolling.
- **Not checked here:** the AI background remover on a real phone (it was tested in 5h13Shops Build 12.1 on your
  parts photos).
