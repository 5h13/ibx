-- ============================================================================
-- RLS write-policy gaps, surfaced while switching server actions off the
-- service-role client (Option A of the A001 follow-up) onto the session-
-- scoped client so RLS is actually in the enforcement path.
--
-- These three tables have ONLY ever had a SELECT policy. Under service-role
-- access this was invisible (service_role bypasses RLS for every command),
-- but under a real user session it means every INSERT/UPDATE the app
-- performs on them would be silently rejected by Postgres — a genuine
-- functional regression, not a business-isolation gap. Each policy below
-- mirrors the existing application-layer guard exactly (see the action file
-- named in each comment), so the database now enforces the same rule the
-- app already enforces in code — neither more nor less permissive.
-- ============================================================================

-- admin_policies / admin_announcements — src/modules/admin/policies/actions.ts
-- guard: role==='super_admin' OR section_code==='admin' OR holds ANY
-- workflow grant in the admin section. (createPolicyAction,
-- updatePolicyAction, publishPolicyAction, archivePolicyAction,
-- createAnnouncementAction, publishAnnouncementAction, archiveAnnouncementAction)
drop policy if exists "admin_policies_write" on public.admin_policies;
create policy "admin_policies_write" on public.admin_policies for all using (
  public.is_super_admin()
  or exists (select 1 from public.users where id = auth.uid() and section_id = (select id from public.sections where code = 'admin'))
  or exists (
    select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
    where ua.user_id = auth.uid() and s.code = 'admin'
  )
) with check (
  public.is_super_admin()
  or exists (select 1 from public.users where id = auth.uid() and section_id = (select id from public.sections where code = 'admin'))
  or exists (
    select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
    where ua.user_id = auth.uid() and s.code = 'admin'
  )
);

drop policy if exists "admin_announcements_write" on public.admin_announcements;
create policy "admin_announcements_write" on public.admin_announcements for all using (
  public.is_super_admin()
  or exists (select 1 from public.users where id = auth.uid() and section_id = (select id from public.sections where code = 'admin'))
  or exists (
    select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
    where ua.user_id = auth.uid() and s.code = 'admin'
  )
) with check (
  public.is_super_admin()
  or exists (select 1 from public.users where id = auth.uid() and section_id = (select id from public.sections where code = 'admin'))
  or exists (
    select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
    where ua.user_id = auth.uid() and s.code = 'admin'
  )
);

-- approval_decisions — src/modules/approvals/actions.ts (decideApprovalAction
-- writes via writeDecision(); insert-only, never updated or deleted).
-- guard: role==='super_admin' OR holds reviewer/approver workflow role in
-- the row's own section (approval_decisions.section_code).
drop policy if exists "approval_decisions_write" on public.approval_decisions;
create policy "approval_decisions_write" on public.approval_decisions for insert with check (
  public.is_super_admin()
  or public.has_workflow_role((select id from public.sections where code = approval_decisions.section_code), 'reviewer')
  or public.has_workflow_role((select id from public.sections where code = approval_decisions.section_code), 'approver')
);
