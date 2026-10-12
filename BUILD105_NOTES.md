# Build 105: store logo watermark on "Share as image"

Deploy after 104a: unzip into desktop\ipa (folder paths are kept), then git add -A → commit → push → wait for Vercel to show "Ready".
No database change. No files to delete. One file changes: src/modules/agent/ShareCard.tsx.

## What changed
Every shared product image now carries the store's logo as a faint watermark across the middle of the photo.
- **Size and strength:** about 62% of the photo area, at 18%.
- **Visible on any photo:** a light layer also lightens the dark parts of the product, so the logo shows on dark items too.
- **Background removed automatically:** the logo's own background (the flat colour around its edges) is taken out, so only the artwork shows:
  - PILI: the swirl, without its light-blue square.
  - ISHABELLA: the three waves, without the navy square. The white wave is tinted slate so it shows on a white photo.
  - ATON: the maroon H shape, without its gold frame.
  - A logo uploaded with a transparent background is used as it is.
- **No photo:** no watermark is drawn.
- **Which logo:** each store's own logo from Settings → Branding. Change the logo there and the watermark follows.

## To check live
Share one item from each store in the agent app and check the watermark. The check image in the zip shows the real card code run on the three uploaded logos.
