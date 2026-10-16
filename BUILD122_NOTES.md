# Build 122 — the owner's marketing tools inside the app (option A; no migration)

Deploy: `git add -A`, commit, push.

## What it adds
- Marketing menu: **Specs Card** and **Banner Studio** (Marketing staff, Business Admin, Super Admin — the same
  access as the rest of Marketing). Each opens inside the app; "Open in a new tab ↗" gives it the whole window.
  Both are behind the app's sign-in.
- The tools work exactly as made (themes, layouts, photos, PNG / GIF export, brands, announcements). Changes:
  - every library is served by the app (public/marketing-tools/lib) — nothing loads from outside sites, so they
    open and export without depending on those sites; Banner Studio uses React's production build and is compiled
    ahead (it no longer compiles itself in the browser on every open); the Inter font is served by the app;
  - store logos come from Admin → Businesses → Branding (/api/marketing/brands), as images the tools can export;
    a store with no logo there keeps the tool's own logo (Banner Studio's pasted logos are now image files in
    public/marketing-tools/img, used only as that fallback; the Specs Card falls back to the 5H13 logo).
- Saved work stays as before: in that browser only (Banner Studio's workspace / brands, the Specs Card in the page).

## Updating a tool later
Put the new version in `tools/marketing/src/` (same file name: specs-card.html / banner-studio.html), then run
`node tools/marketing/build.mjs` (or send it to Claude). The originals there are untouched copies of the owner's files.

## Tested (headless Chromium, the app's files)
- Specs Card: opens with the store logo from the app, styles applied, PNG export, animated GIF export (2 photos).
- Banner Studio: opens (PILI logo from the app; ATON with no app logo uses its own), product images, PNG export,
  GIF generated and previewed.
- Both: no requests to outside sites, no errors. App: typecheck and production build.

## Next (A2, later)
"Pick from catalog" inside each tool (name, specs, photos from the catalog; uploads stay), and "Save to store"
(designs kept in the database, open on any PC).
