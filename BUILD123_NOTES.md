# Build 123 — marketing tools follow the app's store; Banner Studio fits the screen (no migration)

Deploy: `git add -A`, commit, push.

- **Store from the app**: both tools use the store you are acting as ("Acting as" in the header). Their own store
  choices are removed while a store is set: Specs Card's theme button (Pili / Aton / Ishabella); Banner Studio's
  store card, "Click to switch brand", "+ Add New Brand" / "Delete Brand", the phone "Store:" button, clicking the
  logo to cycle stores, and the remembered store. Brand texts, colours, typography and contacts stay editable.
  Switch "Acting as" to work on another store.
- **Fits the screen**: inside the app each tool gets a desktop-sized page scaled to the space below the header
  (Banner Studio 1180 × 680, Specs Card 1000 × 760), so Banner Studio keeps its side-by-side layout (it stacked
  below 981 px wide) and the Specs Card shows the whole card (the first spec row was hidden). Exports stay full size.
- **Banner Studio compact**: smaller header, layout tiles (4 across, no sub-labels) and menu, set in
  public/marketing-tools/lib/banner-ibx.css on top of the studio's own styles; the owner's file is unchanged.
- The page heading is one slim line; "Open in a new tab ↗" still gives the tool the whole window.

Files: tools/marketing/build.mjs, public/marketing-tools/{banner-studio.html, banner-studio.app.js, ibx-bridge.js,
lib/banner-ibx.css}, app/api/marketing/brands/route.ts, src/modules/marketing/MarketingToolFrame.tsx,
app/marketing/specs-card/page.tsx, app/marketing/banner-studio/page.tsx

Tested in a 975 × 530 frame acting as ATON: Banner Studio opens on ATON AIRE, no store pickers, preview fully on
screen; Specs Card in the Aton theme, theme button gone, all six spec rows and the whole card visible; no errors.
