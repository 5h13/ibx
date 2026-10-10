# Build 102a — share-card logo fix; the agent app keeps its place

Deploy after 102: unzip into desktop\ipa (paths kept) → git add -A → commit → push → wait for Vercel "Ready".
No database change. Files to delete: none.

## Fixes
1. **Logo and colours on the shared image.** The card read the store's branding with a wrong column name, so it fell
   back to the plain dark header with no logo. It now uses the store's logo and theme from Settings → Branding
   (PILI-AIRE: blue swirl logo on the sky-blue header).
2. **Catalogue keeps its place.** Search text, category, In stock, the chosen client, the open product and the scroll
   position are remembered per store for 12 hours — going to Clients / Orders / Messenger and back shows the same list.
3. **App reopens on the last screen.** If the phone closes the installed app while the agent is in Messenger or Viber,
   reopening it within 12 hours goes back to the screen he was on (instead of My Clients).

## To check live
Search an item, open it, Share as image → Messenger → come back: the same item is still open and the card shows the logo.
