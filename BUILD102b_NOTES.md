# Build 102b: switching screens in the agent app no longer reloads

This build includes everything in 102a, so you can deploy it even if you skipped 102a.

## Deploy
1. Unzip into desktop\ipa. Folder paths are kept.
2. Run `git add -A`, then commit and push.
3. Wait for Vercel to show "Ready".

No database change. Files to delete: none.

## What changed
- **Catalogue stays as it was.** It now stays exactly as you left it while the app is open. Going to Clients, Orders or Payments and back shows at once:
  - the same list (including pages loaded with "Load more")
  - your search
  - the chosen client
  - the basket
  - the open product
  - the scroll position

  There's no reload and no basket re-pricing. After 10 minutes away, the list refreshes so prices and stock are current.
- **Screens open instantly.** Any screen visited in the last minute opens from memory when you go back to it, in the whole app. Saving anything (order, payment, approval…) clears this, so you never see your own changes missing.
- **Fixes from 102a:**
  - The shared image now shows the store logo and colours.
  - The catalogue view is remembered for 12 hours, even if the app is closed.
  - The app reopens on the last screen you were on.

## To check live
1. Search for an item in the Catalogue, scroll down and open a product.
2. Tap Clients, then tap Catalogue again. The same product should still be open, at the same spot.
