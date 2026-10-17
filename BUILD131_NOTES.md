# Build 131 — PILI history margins (cost per DR from the DR sales record)

Deploy: `supabase db push` (migration `20270131_pili_history_costs.sql`, after 130), then commit and push.
The push prints: `PILI sales history: N of 2153 DRs matched to the DR sales record` — expect 2153 of 2153.
Checks: DB harness `runall131.sh` 769 checks passed (proof131 new). No screen code changed.

## What it does
- Each PILI history sale (one per DR, no item lines) gets, from the "Sales Record" sheet of the PILI feed data:
  **cost** (Total Cost), **capital** (cost + add-on) and **agent commission**. Matched by DR number and total;
  a DR whose total differs is left alone.
- Sales Manager app: PILI's history now has margins — month, category "Sales history", channel, client and the
  client's year. Margin = (sales − cost) / sales, the same as the record's Gross Margin.
- 39 DRs in the record have no cost; their cost stays unknown and they are left out of the margin (still counted
  in sales).
- Nothing posts to Finance; the Dashboard and the monthly history journals are unchanged.
- ATON and Ishabella history keep showing sales without margin until their DR records (cost per DR) are given.
