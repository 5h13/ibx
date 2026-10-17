# Build 138 — Add store and Copy pricing (Super Admin)

## Deploy
1. `supabase db push` (migration `20270140_add_store.sql`)
2. commit and push (Vercel deploys)

## What changed
**System → Businesses** (menu renamed from "Business Branding"; Super Admin only)
- **+ Add store**: code (2–12 letters/digits, can't change later), legal name, store name, VAT, address / phone / email,
  and "copy prices from" another store. In one step the store gets:
  - main stock location (MAIN, set as the Storefront's location) and a walk-in customer
  - operating mode Full, agent / back-office commission settings, HR settings, standard commission brackets
  - the full chart of accounts (same codes as the template store — the one prices are copied from, else the oldest store;
    names only, no balances) and the counter's cash drawer / card / check accounts
  - the current month, its own house agent, and its online shop at /shop/<code> (switched off)
  - category add-ons and item markups copied from the chosen store
- **Ready to sell** column: what each store still lacks — Business Admin, pricing, bank / e-wallet account, logo,
  address & phone.
- **Copy pricing** on every store: from another store, either "only fill in what's missing" or "replace".
  Logged in the audit log.

## After adding a store
1. Edit → logo, colours, tagline
2. System → Users → add its Business Admin and staff
3. Finance → Bank & Cash → its bank / GCash accounts
4. Stock: receive or load its opening stock into MAIN
5. Sales → Online Shop → open the shop when ready

## Not changed (decisions still open)
- The new store sells from the shared catalog (CAT-40 own catalog not built).
- Agents still see every active store, so they can sell for the new store right away.

## Tests
`su postgres -c "bash tests/db-harness/runall140.sh"` — proof140 (29 checks) plus all earlier proofs pass.
