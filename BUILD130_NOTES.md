# Build 130 — sales history shows in the Sales Manager app and Monthly Sales

Deploy: `supabase db push` (migration `20270130_sales_history_in_manager.sql`), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall130.sh` 763 checks passed (proof130 new).

## Why August showed ₱0
The 2026 history is in the app as one counter sale per DR (DR number, date, client, agent, total, no item lines),
plus one "Sales history (loaded)" journal per store per month that the Dashboard reads. Both agree to the centavo.
The Manager app counted sales through their item lines, so the history DRs were left out.

## What changed
- **Sales Manager app:** a sale without item lines counts at its total under the category **"Sales history"**.
  Today, Sales, Team, Client and the previous months now include the history. Its cost is unknown, so it is left
  out of every margin (margins are worked out on the sales that have items). The client page's
  "stopped buying" warning ignores it.
- **Monthly Sales:** month picker (any month up to this one). History days show "Sales history — posted by Finance"
  and count in "Posted by Finance". New sales entries still go to the current month (button shown there only).

## Matching the Dashboard
Each month, Manager app = Dashboard for history months. A day sold in the app since then reaches the Dashboard only
after its closing is approved and Finance posts it, so until then the Manager app (all completed sales) is ahead by
the open days, e.g. PILI September: one Storefront sale of ₱2,738 not yet closed.
