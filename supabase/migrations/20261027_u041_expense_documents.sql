-- U041: Expense Documents/References.
--
-- Expenses only ever had plain-text reference fields (receipt_reference,
-- document_reference, reference_no) -- no actual file attachment existed
-- anywhere for a receipt, unlike the supplier-document pattern already
-- built for Procurement (finance_supplier_documents +
-- 'supplier-documents' storage bucket). This adds the same pattern for
-- expenses.

create table if not exists public.finance_expense_documents (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  document_name text not null,
  storage_path text not null unique,
  notes text,
  uploaded_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_documents_expense on public.finance_expense_documents(expense_id);

alter table public.finance_expense_documents enable row level security;

-- Anyone who can see the underlying expense (same section, or admin tier)
-- can see its attached receipts; only the expense's own preparer, while it
-- is still in draft (matching the expenses_insert_preparer/update_preparer
-- window), can attach or remove one -- mirrors who is allowed to edit the
-- expense itself, so a document can't be added/removed once the expense
-- has left the preparer's hands.
drop policy if exists finance_expense_documents_select on public.finance_expense_documents;
create policy finance_expense_documents_select on public.finance_expense_documents
for select using (
  exists (
    select 1 from public.expenses e
    where e.id = finance_expense_documents.expense_id
      and (public.is_super_admin() or public.in_section(e.section_id))
  )
);

drop policy if exists finance_expense_documents_write on public.finance_expense_documents;
create policy finance_expense_documents_write on public.finance_expense_documents
for all using (
  exists (
    select 1 from public.expenses e
    where e.id = finance_expense_documents.expense_id
      and e.status = 'draft'
      and e.prepared_by = auth.uid()
      and public.has_workflow_role(e.section_id, 'preparer')
  )
) with check (
  exists (
    select 1 from public.expenses e
    where e.id = finance_expense_documents.expense_id
      and e.status = 'draft'
      and e.prepared_by = auth.uid()
      and public.has_workflow_role(e.section_id, 'preparer')
  )
);

insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', false)
on conflict (id) do nothing;
