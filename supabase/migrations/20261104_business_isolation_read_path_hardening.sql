-- ============================================================================
-- Build 52 — CC-01-class business-isolation hardening (read paths).
--
-- Context: Build 51 found that ~15 admin/logistics/finance pages read their
-- data through createAdminClient() (service role, bypasses RLS entirely), so
-- every business's rows were visible to any user who could open the page.
-- Build 52 switches those reads to the session-scoped client. That swap is
-- only half the fix — Build 41's own worklog already recorded the other half:
-- the Business Super Admin (business_admin) tier, designed in A001 as "the
-- reach of a Global Super Admin, scoped to one business", was only ever
-- granted permissive RLS on users/user_access/hr masters. On every other
-- business-scoped table its permissive grants are `is_super_admin() OR
-- in_section(...)`, which a business_admin without section grants does not
-- satisfy — so once pages stop bypassing RLS, a business_admin would see
-- empty pages (and its session-client writes were already failing).
--
-- The audit for this build also found two tables whose business isolation
-- was missing at the DB layer itself (not just at the page):
--   * employee_government_ids — has business_id but no restrictive
--     isolation policy, and business_id is nullable with no default, so an
--     Admin approver of business A could read business B's government IDs.
--   * employee_emergency_contacts — no business_id and no isolation at all;
--     any admin-section user could read every business's contacts.
--
-- Everything here is additive. No permissive grant is widened for any role
-- other than business_admin, and business_admin's new grants are always
-- AND-ed with the existing restrictive <table>_business_isolation policy, so
-- they can never reach another business's rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part A — employee_government_ids: derive business_id from the employee,
-- backfill, enforce NOT NULL, add the standard restrictive isolation policy.
-- The existing permissive policy (is_admin_approver_or_super()) is left
-- exactly as-is: government IDs remain Global Super Admin / Admin approver
-- only, deliberately NOT extended to business_admin (Build 41 decision).
-- ----------------------------------------------------------------------------
create or replace function public.set_business_id_from_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Always authoritative: the employee's business, never a client-supplied
  -- value, so a row can never be filed under a different business than the
  -- employee it belongs to.
  select e.business_id into new.business_id from public.employees e where e.id = new.employee_id;
  if new.business_id is null then
    raise exception 'Employee % not found or has no business.', new.employee_id;
  end if;
  return new;
end;
$$;

update public.employee_government_ids g
   set business_id = e.business_id
  from public.employees e
 where e.id = g.employee_id
   and g.business_id is distinct from e.business_id;

drop trigger if exists employee_government_ids_set_business on public.employee_government_ids;
create trigger employee_government_ids_set_business
before insert or update of employee_id, business_id on public.employee_government_ids
for each row execute function public.set_business_id_from_employee();

alter table public.employee_government_ids alter column business_id set not null;
create index if not exists idx_employee_government_ids_business_id on public.employee_government_ids(business_id);

drop policy if exists employee_government_ids_business_isolation on public.employee_government_ids;
create policy employee_government_ids_business_isolation on public.employee_government_ids
  as restrictive for all
  using (public.is_super_admin() or business_id = public.current_business_id())
  with check (public.is_super_admin() or business_id = public.current_business_id());

-- ----------------------------------------------------------------------------
-- Part B — employee_emergency_contacts: add business_id (derived from the
-- employee, same trigger), backfill, NOT NULL, restrictive isolation.
-- Existing writers (profile/selfServiceActions.ts, admin employee actions)
-- never pass business_id; the trigger fills it.
-- ----------------------------------------------------------------------------
alter table public.employee_emergency_contacts add column if not exists business_id uuid references public.businesses(id) on delete restrict;

update public.employee_emergency_contacts c
   set business_id = e.business_id
  from public.employees e
 where e.id = c.employee_id
   and c.business_id is distinct from e.business_id;

drop trigger if exists employee_emergency_contacts_set_business on public.employee_emergency_contacts;
create trigger employee_emergency_contacts_set_business
before insert or update of employee_id, business_id on public.employee_emergency_contacts
for each row execute function public.set_business_id_from_employee();

alter table public.employee_emergency_contacts alter column business_id set not null;
create index if not exists idx_employee_emergency_contacts_business_id on public.employee_emergency_contacts(business_id);

drop policy if exists employee_emergency_contacts_business_isolation on public.employee_emergency_contacts;
create policy employee_emergency_contacts_business_isolation on public.employee_emergency_contacts
  as restrictive for all
  using (public.is_super_admin() or business_id = public.current_business_id())
  with check (public.is_super_admin() or business_id = public.current_business_id());

-- ----------------------------------------------------------------------------
-- Part C — business_admin: full access within its own business on every
-- business-scoped table. Driven off the presence of the restrictive
-- <table>_business_isolation policy, so the grant is only ever created where
-- that policy already confines it to current_business_id(). Runs after
-- Parts A/B so employee_emergency_contacts is included.
-- Excluded: employee_government_ids (Global-only by design, see Part A).
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select p.tablename
      from pg_policies p
     where p.schemaname = 'public'
       and p.permissive = 'RESTRICTIVE'
       -- both naming styles in use: A001's "<t>_business_isolation" and
       -- SUP-05's "<t> business isolation"
       and p.policyname in (p.tablename || '_business_isolation', p.tablename || ' business isolation')
       -- users/user_access carry their own narrower business_admin policies
       -- (20261018: no admin-tier promotion); government IDs are Global-only.
       and p.tablename not in ('users', 'employee_government_ids')
     order by 1
  loop
    execute format('drop policy if exists %I on public.%I', t || '_business_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_business_admin()) with check (public.is_business_admin())',
      t || '_business_admin_all', t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Part D — global masters that the Admin module manages. These are GLOBAL
-- (locked rule: taxonomy referenced by business-scoped records stays global),
-- and today any admin-section user may read and write them. A business_admin
-- outranks an admin-section preparer within the admin module, so it gets the
-- same access, no more. Finance catalog/supplier masters are NOT touched —
-- those stay Global-Super-Admin/finance-managed per the locked decisions.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'asset_categories','business_document_types','employee_document_types',
    'leave_types','supply_categories','admin_expense_categories'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_business_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_business_admin()) with check (public.is_business_admin())',
      t || '_business_admin_all', t
    );
  end loop;
end $$;
