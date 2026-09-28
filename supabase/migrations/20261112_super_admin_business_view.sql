-- ============================================================================
-- Build 59 — the Super Admin's "Acting as" business now filters what they see.
--
-- User report (2026-09-27): with "Acting as: Aton" selected, lists (e.g.
-- Employees) still showed Ishabella and Pili rows. Cause: the selector was a
-- browser cookie that only decided which business the Super Admin's NEW rows
-- were saved under; every restrictive isolation policy reads
--   is_super_admin() OR business_id = current_business_id()
-- so the Super Admin always saw every business.
--
-- Now:
--   * The selection is stored on the Super Admin's own users row
--     (users.acting_business_id), set only through set_acting_business().
--   * Every restrictive business-isolation policy (all share the expression
--     above) is rewritten to
--       (is_super_admin() AND (super_admin_view_business() IS NULL
--                              OR business_id IS NULL
--                              OR business_id = super_admin_view_business()))
--       OR business_id = current_business_id()
--     - Super Admin, "5H13 (all businesses)" selected: sees everything (as before).
--     - Super Admin, one business selected: sees that business only (plus
--       rows with no business, e.g. their own users row), and can only
--       write rows for that business.
--     - Everyone else: unchanged (own business only).
--   * Security-invoker views follow automatically. SECURITY DEFINER
--     functions are unaffected (they never relied on this policy).
--
-- NOTE for future migrations: a new business-scoped table must use the new
-- expression (or public.business_row_visible(business_id)), not the old one.
-- ============================================================================

alter table public.users
  add column if not exists acting_business_id uuid references public.businesses(id) on delete set null;

-- The business the (real) Super Admin has chosen to view; null = all.
create or replace function public.super_admin_view_business()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select u.acting_business_id
    from public.users u
    join public.businesses b on b.id = u.acting_business_id and b.is_active
   where u.id = auth.uid() and u.role = 'super_admin';
$$;

-- Same test as the rewritten policies, for use in new policies / code.
create or replace function public.business_row_visible(p_business_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select (public.is_super_admin()
          and (public.super_admin_view_business() is null
               or p_business_id is null
               or p_business_id = public.super_admin_view_business()))
      or p_business_id = public.current_business_id();
$$;

create or replace function public.set_acting_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Only the Global Super Admin can select an acting business.';
  end if;
  if p_business_id is not null
     and not exists (select 1 from public.businesses where id = p_business_id and is_active) then
    raise exception 'Select a valid, active business.';
  end if;
  update public.users set acting_business_id = p_business_id where id = auth.uid();
end;
$$;

revoke all on function public.set_acting_business(uuid) from public;
grant execute on function public.set_acting_business(uuid) to authenticated;
grant execute on function public.super_admin_view_business() to authenticated;
grant execute on function public.business_row_visible(uuid) to authenticated;

-- Rewrite every restrictive isolation policy that uses the old expression.
do $$
declare
  p record;
  v_old text := '(is_super_admin() OR (business_id = current_business_id()))';
  v_new text := '((public.is_super_admin() and (public.super_admin_view_business() is null or business_id is null or business_id = public.super_admin_view_business())) or business_id = public.current_business_id())';
  n int := 0;
begin
  for p in
    select c.relname, n.nspname, pol.polname,
           pg_get_expr(pol.polqual, pol.polrelid) as q,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as wc
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not pol.polpermissive
       and (pg_get_expr(pol.polqual, pol.polrelid) = v_old
            or pg_get_expr(pol.polwithcheck, pol.polrelid) = v_old)
  loop
    if p.q = v_old and p.wc = v_old then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', p.polname, p.nspname, p.relname, v_new, v_new);
    elsif p.q = v_old and p.wc is null then
      execute format('alter policy %I on %I.%I using (%s)', p.polname, p.nspname, p.relname, v_new);
    elsif p.q = v_old then
      execute format('alter policy %I on %I.%I using (%s)', p.polname, p.nspname, p.relname, v_new);
    else
      execute format('alter policy %I on %I.%I with check (%s)', p.polname, p.nspname, p.relname, v_new);
    end if;
    n := n + 1;
  end loop;
  raise notice 'Business-view: rewrote % isolation policies', n;
end;
$$;
