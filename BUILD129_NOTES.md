# Build 129 — Agent Quotations page loads; agent quotes wait for office approval (UIA-22)

Deploy: `supabase db push` (migration `20270129_agent_quotes_office_approval.sql`), then commit and push (app code changed).
Checks: TypeScript clean, `next build` passes, DB harness `runall129.sh` 755 checks passed (proof129 new).

1. **Agent app → Quotations "couldn't load"** (Vercel log: "Attempted to call peso() from the server"). The page used a money-format helper that lived in a browser-only file, so it failed as soon as the agent had a quotation to list. The helper now lives in a shared file. A scan of the whole app found no other page with the same mistake.
2. **Agent quotations always wait for office approval** (review, then approve), whatever the store's operating mode. In single-operator mode they were auto-approved in the agent's own name. Quotations made in the office still follow the store's mode.

Already auto-approved agent quotes are left as they are; one that should not have gone out can be revised from Sales → Revenue Pipeline.
