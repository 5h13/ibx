-- ============================================================================
-- Build 53 — U058/U060: the shared product catalog must be readable by the
-- modules that consume it.
--
-- finance_procurement_items (the ONE shared product master — CAT-12) and its
-- controlled category/unit masters were readable only by Finance and the
-- Global Super Admin. But Sales builds quotations from it (/sales/revenue)
-- and Logistics links inventory to it (/logistics/inventory — "Logistics does
-- not create a second product master"), both through the session client, so
-- for an ordinary Sales or Logistics user those pickers came back EMPTY; a
-- Business Super Admin could not read it either. Adds a read-only grant for
-- those audiences. Writes stay exactly as before (Finance / Super Admin;
-- catalog schema masters Super-Admin-only per CAT-14). Cost-sensitive fields
-- are not newly exposed beyond what those users already see on the
-- quotation pricing preview.
-- ============================================================================

create or replace function public.can_read_shared_catalog()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or public.is_business_admin()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role in ('finance','sales','logistics'))
      or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                 where ua.user_id = auth.uid() and s.code in ('finance','sales','logistics'));
$$;
revoke all on function public.can_read_shared_catalog() from public;
grant execute on function public.can_read_shared_catalog() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['finance_procurement_items','finance_catalog_categories','finance_catalog_units'] loop
    execute format('drop policy if exists %I on public.%I', t || '_shared_read', t);
    execute format('create policy %I on public.%I for select using (public.can_read_shared_catalog())', t || '_shared_read', t);
  end loop;
end $$;
