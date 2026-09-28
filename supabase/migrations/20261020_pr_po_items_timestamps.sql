-- Schema-drift fix: `purchase_requisition_items` and `purchase_order_items`
-- were created (20260921/20260922 foundation) without created_at/updated_at,
-- unlike every other table in the schema. The app has always queried them
-- with .order('created_at') — app/finance/procurement/page.tsx (PR and PO
-- line items) and app/logistics/inventory/page.tsx (PO line items) — which
-- fails at runtime with "column ... created_at does not exist". This is the
-- PO-08-adjacent bug already logged on the punchlist.
--
-- Fix: add the missing columns, matching the standard convention used
-- everywhere else. Additive only; existing rows backfill to now().

alter table public.purchase_requisition_items add column if not exists created_at timestamptz not null default now();
alter table public.purchase_requisition_items add column if not exists updated_at timestamptz not null default now();
alter table public.purchase_order_items add column if not exists created_at timestamptz not null default now();
alter table public.purchase_order_items add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_pr_items_requisition_created on public.purchase_requisition_items(requisition_id, created_at);
create index if not exists idx_po_items_order_created on public.purchase_order_items(purchase_order_id, created_at);
