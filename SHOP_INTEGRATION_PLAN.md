# Plan — bring the 5h13Shops features into the ERP shop (Builds 139–141)

*25 October 2026. Source: `Desktop\Shops` at Build 12.2 (HANDOFF_TO_ERP.md, HANDOFF_TO_ERP_STUDIO.md,
BUILD11/12 notes). Target: `Desktop\ipa` at Build 138. Nothing is built until you say go.*

## Decided
- Logo and colours stay in **System → Businesses** (they theme the whole app). The shop header preview only shows them.
- Shop contacts (phone, email, address) **always come from the store** (Businesses). Messenger, Viber and the new
  WhatsApp stay in **Sales → Online Shop**, with the other chat links.
- Options / sizes (5h13Shops Build 4) are **not** copied: in the ERP a different model, size or voltage is its own
  stock item. The shop shows **"Other versions"** (same generic item) instead.
- Store categories (food, properties, resorts, services) are **not** copied.
- Photo touch-up comes **without OCR** (the ERP already has its own on-device reader for documents).

## Build 139 — shop look, controls, requests and Inbox
1. **Clickjacking guard** (`proxy.ts`): every page except `/shop/...` refuses to load inside another website.
2. **Banner photo** behind the shop header in all three layouts and on every shop page, darkened at the bottom;
   **Keep in view** Top / Middle / Bottom. Stored in the store's own folder of the logo bucket.
3. **Sales → Online Shop:**
   - an Open / Not open card at the top
   - a **Shop header** section with a live preview (store logo, colours and name from Businesses, plus banner and
     tagline)
   - **WhatsApp number**
4. **Shop page extras:**
   - initials when a store has no logo
   - a **Manage shop** button for the store's own staff only
   - a **Preview** strip while the shop is off
5. **Ask about this item:** Messenger / Viber / WhatsApp / Text / Call. Each carries the item name, code, price and
   link. WhatsApp fills the message in; Messenger and Viber copy it to paste.
6. **Send request to the store:**
   - The buyer gives name and mobile and picks how to be contacted (Viber / WhatsApp / Text / Call / Messenger).
   - They get "Request #1001 sent ✓" with a private **Track request** page.
   - Spam limits: 5 per mobile per store in 10 minutes, 60 per store per hour.
7. **Inbox in the Sales Manager app:**
   - New-request count on the bell and in Needs attention. Tabs: To answer / Answered / All.
   - Ready replies: Available, Ask for deposit, Ready for pickup, Not available.
   - Answers: Confirmed / Not available / Done, with a note the buyer sees.
8. **Buyer's request status page** `/shop/<store>/r/<private link>`: Sent → Seen → Confirmed / Not available /
   Done, plus the store's note.
9. **Privacy line** on the request form and the shop footer: what is kept, why, and how to ask for deletion.
- Database: one migration (`shop_requests`, `shop_send_request`, `shop_request_status`, banner columns,
  WhatsApp column, Inbox functions). Tests: a new proof plus all earlier ones; phone-size browser checks.
- Deploy: `npx supabase db push` → Y, then commit and push.

## Build 140 — quotations, email, sharing, versions, filters
1. **Make quotation** from a request: finds the customer by mobile, or creates one, then opens a draft quotation
   with the item, quantity and code filled in. Staff review it before sending.
2. **Email alerts** for new requests, to the store's email (Businesses), else its Business Admins. Gmail through
   nodemailer. The request still reaches the Inbox without email.
3. **Share to Facebook** per item: a preview, an editable caption, "Copy caption & open Facebook", other apps,
   copy link.
4. **Other versions** on the item page: items with the same generic item (other model, size, voltage), each with
   its own stock and price.
5. **Aircon / HVACR search filters:** brand and category now. Refrigerant, capacity, voltage and vehicle model
   once items carry them consistently in their specification ("Label: Value" lines).
6. Optional: **"Also on"** links (Shopee, Lazada, TikTok, Facebook) on the shop's front page.
- Deploy: `npm install` (nodemailer), `npx supabase db push` → Y, Vercel → Environment Variables `SMTP_USER`,
  `SMTP_PASS` (Gmail App Password), then commit and push.

## Build 141 — Studio and photo touch-up
1. **Studio** (phone-first; everything drawn on the phone, no cost per picture):
   - **Specs card:** 4 sizes, with On sale, promo ribbon, announcement strip, and "Ask for price".
   - **Price lists:** with photos (up to 8 items), or printable A4 with an optional QR code.
   - **Banners:** product photos, big number, or announcement (text only).
   - **New arrivals / Back in stock.**
   - **Look:** 5 colour sets and 5 headline fonts; the chosen font is saved per store.
   - **Save:** Download / Share, **Post on my shop as the promotion** or **as an announcement**, and **Post to
     Facebook** with a ready caption.
2. **Photo touch-up** on catalog photo uploads and in the Studio:
   - AI background remover on the phone (about 16 MB, downloaded once). The simple offline remover is kept.
   - Backdrops, shadow, size and turn, a square 1080 × 1080 result.
3. **Pictures in Posts:** promotions and announcements can carry a Studio picture, shown in every layout.
- Data: each store's own selling price, live stock, specification lines, up to 3 photos.
- Deploy: `npm install` (qrcode), `npx supabase db push` → Y, then commit and push. About 16 MB of files
  (`public/ai`) go into the repository.

## Still to decide (I'll use the suggestion unless you say otherwise)
| # | Question | Suggestion |
|---|---|---|
| 1 | Who answers shop requests? | Sales Manager, Business Admin, and staff with Sales access. Not agents. |
| 2 | Make quotation: automatic or a button? | A button on the request (Build 140). |
| 3 | Studio replaces the old Banner Studio and Specs Card (made for computers)? | Yes. Keep the old ones reachable until you're happy, then remove them. |
| 4 | **Logo stamped on product photos** at upload? | **No.** The catalog photos are shared by all stores, so a PILI logo would show in ATON's and ISHABELLA's shops. Studio pictures already carry the store's own logo. |
| 5 | Which price on Studio pictures? | The store's shop price (the same one the shop shows). Never cost or agent tiers. |
| 6 | Who may use the Studio and post to the shop? | Business Admin, Sales Manager, and Marketing / Sales staff. |
| 7 | HVACR filters to start with? | Brand, category, in stock only. More once the specification lines are tidy. |
