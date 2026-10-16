# Build 124 — catalog photos and texts in the marketing tools (no migration)

Deploy: `git add -A`, commit, push.

- **"＋ From catalog"** (bottom right of Specs Card and Banner Studio): search the catalog (every word typed must
  appear in the name, code, brand, generic name or category), pick an item, then tick **Add photos** and / or
  **Fill the product texts** → "Add to the card / banner".
- **Photos**: the item's catalog photos (up to 3) are added to the tool's own photo list exactly as if uploaded —
  rotate, zoom, reorder, remove and the GIF all work. **Uploading your own photos stays.** Photos are served from
  the app's own address so PNG / GIF exports work.
- **Texts** (every one stays editable; nothing is written back to the catalog):

| Specs Card | from | Banner Studio | from |
| --- | --- | --- | --- |
| Title | item name | Product name | item name |
| Key features | description | Product details | brand · generic name |
| Specifications table | specification, "Label: Value" lines (other lines left out, with a note; the tool's Undo brings back the old rows) | Specifications / model | item code (or the first specification line) |
| | | INFO1 category | category |
| | | INFO1 / INFO2 feature text | description |

- Access: Marketing staff, Business Admin, Super Admin (the same as the Marketing menu).

Files: app/api/marketing/catalog/{search,item,photo}/route.ts, src/modules/marketing/toolAccess.ts,
public/marketing-tools/ibx-bridge.js, public/marketing-tools/banner-studio.app.js, tools/marketing/build.mjs

Tested (headless Chromium, stand-in catalog item with 3 photos and a 4-line specification): Specs Card — title,
key features, 3 spec rows filled (1 free-text line left out with a note), 3 photos in the gallery and on the card,
PNG export; Banner Studio — 3 product images, product name / details / model filled, PNG export; no errors.
