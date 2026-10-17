# Build 132 — sales targets per person, the agent's page (Manager app), and the agent app's Home

Deploy: `supabase db push` (migration `20270132_manager_agent_page.sql`, after 130–131), then commit and push.
Checks: TypeScript clean, `next build` passes, DB harness `runall132.sh` all passed (proof132 new; proof127 updated
for the target note). Agent Home rendered with sample data at phone width.

## Targets
- **Default target** for each agent / counter person = their average monthly sales + 20% (rounded up to ₱100).
  Average = sales over the 12 months before the month ÷ the months since their first sale in that window
  (a new agent is not averaged over months before he started). No sales history = no default.
- The Sales Manager (or Business Admin) can **change it to any amount with a note** (Team → Change target,
  or on the person's page). The person is **notified** with the new target, the previous one and the note
  (agents in the agent app's notices, counter staff in the office notices). Every change is in the audit log.
- With no store target set, the store's target adds up the people's targets (set or default).

## Sales Manager app — tap a person on Team
Their page, with month switch: month's sales against the target (pace mark, month-end projection, who set it
and the note, or the default), sales count, average DR, margin, rank in the team; last 12 months with each
month's target; year to date with margin; open quotes and orders to deliver; what his clients owe / overdue;
his clients this year (tap → client page); **quiet clients** (his clients with no purchase in 60 days, Call);
what he sells this month by category; recent sales.

## Agent app — new Home (start page)
- My sales this month against my target, the "where I should be today" mark, ahead/behind, how much is left
  and about how much a day, the month-end projection; the manager's note (or how the default was set).
- Today / sales / clients bought; last 6 months with targets; open quotes and orders (tap through);
  overdue balances to collect (Report a payment); clients to call (quiet 60+ days); recent sales.
- No costs or margins on the agent's screens. Figures follow the store picked at the top.
- **My Clients moved to its own tab** (`/agent/clients`). Bottom bar: Home · Catalogue · Clients · Orders · Payments · More.

## Not in this build
- Commission on the agent's page in the Manager app (the agent's own My Commission page is unchanged).
