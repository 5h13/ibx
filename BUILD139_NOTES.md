# Build 139 — Shop look, controls, requests and Inbox (from 5h13Shops)

25 October 2026. From 5h13Shops Builds 3, 4.1, 4.2, 9.1 and 10 (checked against its latest, Build 14), adapted to
the ERP. Plan: `SHOP_INTEGRATION_PLAN.md`.

## Deploy (you)
1. `npx supabase db push` → **Y** (migration `20270141_shop_requests.sql`)
2. `git add .` → `git commit -m "Build 139: shop banner, WhatsApp, requests and Inbox"` → `git push`
No `npm install`, nothing to set in Vercel.

## What's new

**The shop (all three layouts)**
- **Banner photo** behind the store's header on every shop page, darkened at the bottom so the name stays readable:
  - **A:** behind the header.
  - **B:** behind the big header and the slim one.
  - **C:** a strip under the header.
- **Initials** (e.g. "PA") instead of a blank circle when a store has no logo yet.
- **WhatsApp** wherever buyers contact the store. WhatsApp fills the message in; Messenger and Viber still copy it to
  paste.
- **Item code** shown on the item page and carried in every message and request.
- **Send your question here / Send request to the store** (item page and Request for quotation):
  - The buyer enters name and mobile and picks how to be contacted: Viber / WhatsApp / Text / Call / Messenger.
  - They get **"Request #1001 sent ✓"** and a **Track request** link: a private page showing Sent → Seen by the
    store → Confirmed / Not available / Done, plus the store's note.
  - Spam limits: 5 requests per mobile per store in 10 minutes, 60 per store per hour.
  - The copy-and-message buttons stay underneath ("Or send it yourself").
- **Privacy line** in the footer and under the request box: the store keeps the buyer's name, number and request to
  reply; to have them deleted, message or call the store.
- **For the store's own staff only** (signed in):
  - While the shop is off, they can open it to check it, with a yellow **Preview** strip.
  - A **Manage shop** button opens Sales → Online Shop.
  - Visitors see nothing until the Super Admin opens the shop.

**Sales → Online Shop**
- **Shop header**: a live preview with the store's logo, colours and name (still set in System → Businesses), plus:
  - **Upload / Change / Remove banner** (made smaller before upload, 3 MB at most)
  - **Keep in view**: Top / Middle / Bottom
- **WhatsApp number** with the other contacts. Phone, email and address stay the store's (System → Businesses).

**Shop Inbox**
- **Where it is:**
  - Sales Manager app: a new **Inbox** tab with a red count, and a "Shop Inbox · N new" card on Today.
  - Office app: **Sales → Shop Inbox**, for the store's sales staff.
- **Who sees it:** the store's Business Admin, Sales approvers and staff with Sales access. Other stores and other
  departments do not.
- New requests also ring the **bell**.
- **Each request shows:** the message, item code, name, mobile and how the buyer wants to be contacted.
- **Reply:**
  - Ready texts: Available / confirmed, Quotation sent, Ask for deposit, Ready for pickup, Not available.
  - WhatsApp and Text fill the reply in; Viber copies it; Call dials. The buyer's choice comes first.
- **Answer:** Confirmed / Not available / Done, with a note the buyer sees on their request page.
- Opening the Inbox marks new requests "seen".

**Security**
- Only shop pages (/shop/…) may be shown inside another website. Every other page refuses to load in another
  site's frame. The app's own Banner Studio and Specs Card frames still work.

## Not in this build (Build 140)
"Make quotation" from a request, email alerts, Share to Facebook, Other versions, aircon/HVACR filters.

## Checks run (all passed)
- **Database:** proof141, 35 checks:
  - preview for the store's sales staff only
  - WhatsApp and banner rules
  - request limits and number formats
  - visitors reach only their own request by its link
  - notifications
  - Inbox seen / answer
  - other stores and logistics refused
- **Database regression:** all earlier proofs, 50 files.
- **Code:** type check and production build (`next build`).
- **Phone-size render (390 px):**
  - item page with Preview and Manage shop
  - send a question → "Request #… sent ✓"
  - layouts A / B / C with a banner
  - Request for quotation
  - Inbox
  - Online Shop settings
  - No sideways scrolling, no page errors.
