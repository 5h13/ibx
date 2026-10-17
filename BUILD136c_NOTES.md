# Build 136c — shop: Available / By order; Messenger on computers opens the page's chat

Deploy: `supabase db push` (migration `20270138_shop_availability.sql`), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall138.sh` all passed (proof138 new).

## Available / By order
- Each product card and item page shows **Available** (green) when the store has it on hand — on hand less what
  approved orders have set aside — otherwise **By order** (amber). Never the quantity. Services show no label.
- Item page: "Available — in stock" / "By order — message us for the lead time". For a by-order item the prepared
  Messenger / Viber / text message asks for the lead time instead of "Is it available?".
- Until a store's opening stock count is loaded, most items show By order (only stock received or counted in the
  app is known).

## Messenger on computers
- The Messenger buttons now open `messenger.com/t/<page>` (e.g. `messenger.com/t/Pili.Aire`) — straight into the
  page's chat (checked by the owner). The item message is copied for pasting. Phones unchanged (Messenger app).
