-- ============================================================================
-- A001 completion: wire the Business Super Admin (business_admin) role to
-- real permissions.
--
-- Design: a Business Super Admin has full administrative reach within their
-- own business only — the employee-management equivalent of what the
-- Global Super Admin has across every business. Concretely, within their
-- own business (already enforced automatically by the existing restrictive
-- business-isolation policies — this migration only ADDS permissive grants,
-- it never widens what a restrictive policy already narrows):
--   - can see and manage every user and workflow grant in their business
--   - can NEVER create, promote to, or edit a super_admin or business_admin
--     row — the admin tier itself stays a Global Super Admin decision
--   - can never see or touch another business's users at all (the existing
--     restrictive "users business isolation" policy already guarantees this)
-- ============================================================================

create or replace function public.is_business_admin()
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'business_admin' and is_active
  );
$$;

-- users: business_admin can see every user in their own business...
drop policy if exists "users business_admin select" on public.users;
create policy "users business_admin select" on public.users
  for select using (
    public.is_business_admin() and business_id = public.current_business_id()
  );

-- ...and can insert/update users in their own business, but never an
-- admin-tier (super_admin/business_admin) row — enforced on both sides of
-- the write via the with-check.
drop policy if exists "users business_admin manage" on public.users;
create policy "users business_admin manage" on public.users
  for insert with check (
    public.is_business_admin()
    and business_id = public.current_business_id()
    and role not in ('super_admin','business_admin')
  );

drop policy if exists "users business_admin update" on public.users;
create policy "users business_admin update" on public.users
  for update using (
    public.is_business_admin()
    and business_id = public.current_business_id()
    and role not in ('super_admin','business_admin')
  ) with check (
    public.is_business_admin()
    and business_id = public.current_business_id()
    and role not in ('super_admin','business_admin')
  );

-- user_access has no business_id of its own — scope through the target
-- user's business instead. Same admin-tier exclusion: a business_admin can
-- never grant/revoke workflow roles on an admin-tier user (there should be
-- none of their own creation, but this also protects against someone else's
-- business_admin/super_admin rows that predate this policy).
drop policy if exists "user_access business_admin select" on public.user_access;
create policy "user_access business_admin select" on public.user_access
  for select using (
    public.is_business_admin()
    and exists (
      select 1 from public.users u
      where u.id = user_access.user_id and u.business_id = public.current_business_id()
    )
  );

drop policy if exists "user_access business_admin manage" on public.user_access;
create policy "user_access business_admin manage" on public.user_access
  for all using (
    public.is_business_admin()
    and exists (
      select 1 from public.users u
      where u.id = user_access.user_id
        and u.business_id = public.current_business_id()
        and u.role not in ('super_admin','business_admin')
    )
  ) with check (
    public.is_business_admin()
    and exists (
      select 1 from public.users u
      where u.id = user_access.user_id
        and u.business_id = public.current_business_id()
        and u.role not in ('super_admin','business_admin')
    )
  );
