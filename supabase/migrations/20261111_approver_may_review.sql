-- ============================================================================
-- Build 58 — audit finding A (user-confirmed 2026-09-27): an approver may
-- also perform the review step.
--
-- has_workflow_role() matched the workflow role exactly, so an approver-only
-- user was refused at the review step by every RLS policy that gates the
-- prepared -> reviewed transition (expenses, sales data and the rest in
-- schema.sql, approval_decisions, ...), even when the app let them try. Now a
-- 'reviewer' check is also satisfied by an 'approver' grant for the same
-- section. Nothing else changes: preparer still needs a preparer grant, and
-- approver still needs an approver grant. Same rule as grantSatisfies() in
-- src/core/auth/types.ts.
-- ============================================================================

create or replace function public.has_workflow_role(p_section_id uuid, p_role workflow_role)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid()
      and section_id = p_section_id
      and (workflow_role = p_role
           or (p_role = 'reviewer' and workflow_role = 'approver'))
  );
$$;
