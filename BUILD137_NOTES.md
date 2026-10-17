# Build 137 — online shop: layouts A / B / C, Facebook, Request for quotation, front-page sections

Deploy: `supabase db push` (migration `20270139_shop_layouts.sql`), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall139.sh` all passed (proof139 new: 13 checks).
Layouts A, B, C and the quotation page rendered with sample content at phone width.

## Sales → Online Shop (Business Admin / Super Admin, acting as the store)
- **Layout:** A · Classic storefront, B · Bold hero, C · App style — one click, live at once.
- **Contacts:** Messenger link, Viber number, **Facebook page** (for "Like us on Facebook"), tagline.
- **Front-page sections**, each on / off: Promotion, Product slideshow, Featured product, Announcements
  (a section shows only when on and filled).
- **Featured product:** search and pick an item with a photo.
- **Product slideshow:** Category / Item / Brand, any of them "(any)"; shows how many products it will cycle
  (up to 20 show); optional title (default e.g. "Toyota Blower Motor").
- **Announcements and promotions:** add / edit / hide / remove; optional show-from and until dates.
  A promotion can have a product (its photo shows) and a category for "Shop the promo".
  The shop shows the newest current promotion and up to 5 current announcements.

## The shop
- **A:** branded header (logo, name, tagline, Messenger, search, **Request for quotation**, **Like us**);
  promo card; slideshow (arrows, dots, cycles every ~4.5 s); featured product; announcements; category chips and
  products by category; "Like us on Facebook" card.
- **B:** on the front page an announcement strip and a tall centred header (logo, Like us on Facebook, search,
  Request for quotation, Messenger / Viber / Call); photo promo banner; category tiles; sliding product strip;
  large featured product; "News from the store"; products by category. Other pages: compact header + "Get a quote".
- **C:** compact white header (Facebook, search); promotion and announcements in one rotating banner; quick
  buttons (Get a quote, Messenger, Viber, Call); "Product of the week"; slideshow with a progress bar; categories as a
  list; **Request for quotation** + Messenger fixed at the bottom of every page.
- Slideshows and banners stop while touched / hovered and for visitors who ask for less motion.
- Every footer has the Facebook link.

## Request for quotation (`/shop/<store>/quote`; also "Request a quotation for this item" on item pages)
Parts and quantities, name and mobile (required), location, notes. Sent to the store by **Messenger, Viber or text**
— the request is written out as one message and copied for pasting (Messenger / Viber do not fill it in from a link).
Nothing is stored in the system; the visitor's name / mobile / location are remembered on their own phone only.
