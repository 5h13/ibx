# Build 133 — Sales Manager app: "Needs attention"

Deploy: `supabase db push` (migration `20270133_manager_attention.sql`, after 130–132), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall133.sh` all passed (proof133 new: 17 checks).
The list was rendered with sample data at phone width.

**Background job:** the migration schedules a check every 5 minutes with pg_cron. If the push prints
"Background job not scheduled", enable **pg_cron** in Supabase → Database → Extensions and run:
`select cron.schedule('ibx-attention-scan', '*/5 * * * *', 'select public.attention_scan_all()');`
Until then the check runs whenever someone opens Today in the Manager app.

## The list (Today, top) — tabs All · Approvals · Team · Clients · Pipeline
Each item: what and why, **Open**, **Call** (when there is a phone), **Done**, **Snooze 3 days**.
The Today tab shows the count of urgent + watch items. Bell (notifications) now also in the Manager app.

| Level | Item | Default |
|---|---|---|
| Urgent | Counter price exception waiting | 15 min |
| Urgent | Sales order (go-signal) waiting | 4 h |
| Urgent | Quotation waiting for review / approval | 24 h |
| Urgent | Cancel / refund request | any |
| Urgent | Yesterday's closing not submitted / not approved | by 10:00 |
| Urgent | Order for a client with balances overdue / over the credit limit | 60 days |
| Urgent | Payment promise broken (last 7 days, not paid) | — |
| Watch | Agent behind pace (below % of where he should be today) | 80%, from day 7 |
| Watch | Agent with no sale | 7 days |
| Watch | Agent missed the target months in a row | 2 |
| Watch | Payment promised today; check on hand dated within 7 days | — |
| Watch | Top client (sales this year) gone quiet | top 20, 45 days |
| Watch | Approved order not delivered | 3 days |
| Follow up | Quotation sent with no answer; quotation expiring | 7 days; 2 days |

## Settings (Today → Needs attention → Settings)
Every threshold above, the morning summary hour, and the agent nudge on/off — per store. Sales approvers and
the Business Admin can change them; every change is in the audit log.

## Notifications
- **Urgent:** as soon as an item turns urgent, the store's Sales approvers and Business Admin are notified (once per item).
- **Morning summary** (default 8am Manila): counts and the top items, opening Today.
- **Agent nudge:** an agent behind pace gets a notice in the agent app (at most once a week) pointing to Home.
- Notices appear in the app's bell (office, Manager app, agent app). Phone push notifications are not part of
  this build.
