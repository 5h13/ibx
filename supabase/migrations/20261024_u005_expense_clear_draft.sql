-- U005: Clear Draft.
--
-- Procurement's PR/PO forms already have an explicit "Clear Draft" action
-- that discards an unsaved draft. No equivalent existed anywhere for
-- expenses: a draft expense could only ever be edited or submitted for
-- review, never discarded -- and there was no RLS DELETE policy on
-- public.expenses at all, so even an app-layer delete attempt would have
-- been silently rejected by RLS regardless.
--
-- This adds the minimal, safe DELETE policy: only the preparer who created
-- the row, only while it is still in 'draft' status (never 'prepared' or
-- later -- once submitted, a return-to-draft cycle already exists via the
-- reviewer/approver "Return" actions and audit trail, and allowing deletion
-- past that point would destroy history the audit trail (U046) depends on).

drop policy if exists expenses_delete_preparer_draft on public.expenses;
create policy expenses_delete_preparer_draft on public.expenses
  for delete using (
    public.has_workflow_role(section_id, 'preparer')
    and prepared_by = auth.uid()
    and status = 'draft'
  );
