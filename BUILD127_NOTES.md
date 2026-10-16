# Build 127 — Sales Manager phone app

Deploy: `supabase db push` (migration `20270127_sales_manager_app.sql`, after 125 and 126), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall127.sh` 748 checks passed (proof127 new). Screens rendered with sample data and checked at phone width.

## Who and where
- **Sales approvers and the Business Admin** (the Super Admin while "Acting as" a store). Same rights as in the office app: every decision goes through the office app's own actions and checks.
- Open it from the **"Manager app"** button in the office header (phone: account menu → Sales Manager app), or go to `/manager`. "Office" at the top goes back. Add it to the home screen like the agent app.

## Screens
| Screen | What it shows / does |
|---|---|
| **Today** | Sales today (vs the same weekday over the last 4 weeks), collected today, month to date vs target; "Needs your OK" with the most pressing quote and counts per kind; team today; daily-closing reminder; overdue receivables |
| **Approvals** | Quotations, sales orders (go-signal), counter price exceptions, cancel/refund requests, daily closings — filter by kind; Approve / Return (reason) / Reject. A quote or order waiting for review is reviewed and approved in one tap when the role allows; if the workflow needs another approver it stays reviewed and says so |
| **Quote review** | Total, margin, lines below the floor; per line: margin, store price, last price sold to this client; client's balance; Return (note required) / Approve below floor |
| **Team** | Each agent and counter person: month's sales vs their target (with the "where we should be today" mark), sales count, clients; set the store's and each person's monthly target; previous months |
| **Sales** | Month total vs target with month-end pace, daily chart, **breakdown by Category / Client / Channel** (sales, share, margin), open quotes, orders to deliver; previous months |
| **Client** | This month (vs last), this year with margin, what they owe; purchases by month; what they buy; "stopped buying" warning; open quotations; recent purchases; promises; Call / Send statement / Log promise |
| **Collections** | Owed, overdue, checks dated this week; overdue clients oldest first, then not yet due; Call / **Send statement** (image of the open invoices in the store's colours, shared from the phone) / **Log promise** (date, amount, note) |

## How the figures are counted
- Sales = completed counter and agent sales, less returns, by date; margin on sales without VAT.
- Channel: **Counter** (incl. sales under the store's own house agent), **Agents**, **Online** (agents marked online).
- Category = the catalog item's category ("Uncategorised" when blank; returns as their own line).
- Targets: one per store per month plus one per agent / counter person. With no store target, the people's targets are added up.

## Not in this build
- Agent commission on the Team screen (the commission pages stay as they are).
- Switching stores inside the app (use "Acting as" in the office app).
