# Build 134 — Text next to Call (ready message, edited on the phone before sending)

Deploy: commit and push (no database change). Checks: TypeScript clean, `next build` passes.

The Text button opens the phone's messaging app with the number and a short message filled in; nothing is sent
until the user presses Send there. Shown only where a phone number is saved.

| Where | Text message prepared |
|---|---|
| Needs attention — agent behind pace / no sale / missed target | A check-in with his figures, asking what he needs |
| Needs attention — payment promise | Friendly reminder of the promised payment |
| Needs attention — order for a client with overdue balances | Reminder to settle the overdue invoices so the order can be processed |
| Needs attention — top client gone quiet | "It's been a while — anything you need?", offering a quotation |
| Needs attention — quote follow-up / expiring / order not delivered | Follow-up on the quotation number / delivery update |
| Collections and client page | Balance reminder (balance and overdue), or an offer to quote when nothing is owed |
| Team list and the agent's page | "Hi …" / target check-in with his figures |
| Agent's page and agent Home — quiet clients | "It's been a while" offer to quote |
| Agent app — My Clients | Text link beside the phone number |

Messages start "Good day! This is (your name) of (store)". Phone numbers are cleaned (spaces and dashes removed).
