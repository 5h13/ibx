# Build 102: "Share as image" in the agent app

## Deploy
1. Unzip into desktop\ipa. Folder paths are kept.
2. Run `git add -A`, commit and push.
3. Wait for Vercel to show "Ready".

There is no database change, so `supabase db push` is not needed. No files to delete.

## What it does
In the agent app, go to Catalogue, tap a product, then tap **Share as image**. The phone makes a square product card and opens its share menu (Messenger, Viber, Gallery…). On a computer, the image downloads instead.

What the card shows, top to bottom:
- **Header:** the logo of the store the agent is selling from (from Settings → Branding), the store's name in its header colours, and the item code on the right.
- **Photo:** the product's first photo, as large as the card allows, with the whole product kept in view.
- **Name and specification:** the item name, then its Specification field, with lines joined by " · ". The specification line is left out when empty.
- **Price:** the price picked in the popup (the client's price, a tier, or "My price"), per unit, with "Valid until" 7 days from today.
- **Footer:** the agent's name and phone, from his agent record.

Never on the card: capital, markup, floor price, tiers, stock.

Items without a price can't be shared. A store with no logo shows its name only.

## To check live
- Share one item from a phone into Messenger.
- Check the logo, the photo and the phone number.
- If the phone is blank, fill it in on the agent record (Sales → Agents).
