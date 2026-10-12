# Build 106 — one login for staff who also sell as agents

Deploy after 105: unzip into desktop\ipa (paths kept) → `supabase db push` (one migration: 20270111_staff_agent_link.sql)
→ git add -A → commit → push → wait for Vercel "Ready". Files to delete: none.

## How to set it up
Settings → Users → edit the staff user → **Also an agent?** → pick their agent record (Sales → Agents, freelance) → Save.
In the upload file: a `both` row with a staff login_role does the same.

## How they switch
- Office screens → **Agent app** button in the header → their agent app (clients, catalogue, orders, payments, commission).
- Agent app → menu → **← Back to office**.
- One login, one password. Rights do not mix: in the agent app they act only as that agent; on the office screens
  only their staff access applies. A Super Admin account cannot be linked.
- Printing their own agent quotations and their clients' statements from the agent app works too.

## Tested
proof106 (7 checks); full replay 78–106: 0 failures (proof91's old "Agent role only" check updated to the new rule);
tsc and next build pass.
