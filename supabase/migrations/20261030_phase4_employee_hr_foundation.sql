-- ============================================================================
-- Phase 4 (Build 48) -- Employee/HR Master Data: U008, U009, U010, U013,
-- U014, U015, U017, U024.
--
-- Part A reconstructs schema that the frontend (app/profile/page.tsx,
-- app/admin/employees/[id]/page.tsx, EmployeeProfile.tsx,
-- confidentialActions.ts) has assumed since Group 1/2 but that was never
-- actually created -- a genuinely lost migration (the presumed
-- "20260923_admin_employee_master_foundation.sql"), the same class of defect
-- Build 42 already found and fixed once for hr_departments/hr_positions/
-- work_locations. Confirmed missing by direct inspection of every migration
-- file in supabase/migrations and migrations_archive:
--   - employees.address_line1/address_line2/city/province/postal_code
--   - employees.supervisor_employee_id
--   - public.employee_emergency_contacts (table)
--   - public.employee_government_ids (table)
--   - public.is_admin_approver_or_super() (function; referenced by
--     20260924_admin_driver_license_confidentiality.sql's
--     guard_fleet_drivers_license_no() trigger, which has been raising
--     "function does not exist" on every fleet_drivers license write)
-- Additive only; no prior migration is modified.
--
-- Part B is new Phase 4 work: U013/U014 (canonical, immutable employee_no),
-- U015 (status model fix), U017 (sales_commissions dual-FK cleanup).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part A1 -- is_admin_approver_or_super(): the confidential-data gate reused
-- by employee_government_ids (below), fleet_drivers.license_no (existing
-- trigger, previously broken), and employees.notes (app-layer, unchanged).
-- ----------------------------------------------------------------------------
create or replace function public.is_admin_approver_or_super()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.user_access ua
      join public.sections s on s.id = ua.section_id
      where ua.user_id = auth.uid()
        and lower(s.code) = 'admin'
        and ua.workflow_role = 'approver'
    );
$$;

grant execute on function public.is_admin_approver_or_super() to authenticated;

-- ----------------------------------------------------------------------------
-- Part A2 -- employees: missing structured-address and supervisor columns.
-- ----------------------------------------------------------------------------
alter table public.employees add column if not exists address_line1 text;
alter table public.employees add column if not exists address_line2 text;
alter table public.employees add column if not exists city text;
alter table public.employees add column if not exists province text;
alter table public.employees add column if not exists postal_code text;
alter table public.employees add column if not exists supervisor_employee_id uuid references public.employees(id) on delete set null;

create index if not exists idx_employees_supervisor_employee_id on public.employees(supervisor_employee_id);

-- A supervisor can't be the employee's own record.
alter table public.employees drop constraint if exists employees_supervisor_not_self;
alter table public.employees add constraint employees_supervisor_not_self check (supervisor_employee_id is null or supervisor_employee_id <> id);

-- ----------------------------------------------------------------------------
-- Part A3 -- employee_emergency_contacts (plural, structured). The legacy
-- single-pair emergency_contact_name/emergency_contact_phone columns on
-- employees are left in place as a fallback, exactly like department/
-- position_title were left alongside department_id/position_id in Build 42.
-- ----------------------------------------------------------------------------
create table if not exists public.employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null,
  relationship text,
  phone text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employee_emergency_contacts_employee on public.employee_emergency_contacts(employee_id);

create or replace function public.set_employee_emergency_contacts_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists employee_emergency_contacts_set_updated_at on public.employee_emergency_contacts;
create trigger employee_emergency_contacts_set_updated_at
before update on public.employee_emergency_contacts
for each row execute function public.set_employee_emergency_contacts_updated_at();

alter table public.employee_emergency_contacts enable row level security;

drop policy if exists employee_emergency_contacts_admin_all on public.employee_emergency_contacts;
create policy employee_emergency_contacts_admin_all on public.employee_emergency_contacts
  for all using (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')))
  with check (public.is_super_admin() or public.in_section((select id from public.sections where code = 'admin')));

-- U011 self-service (write is added in a later migration once the app layer
-- ships it; the read policy lands now since it's harmless and unblocks
-- app/profile/page.tsx which already reads this table for the signed-in
-- employee's own contacts).
drop policy if exists employee_emergency_contacts_self_select on public.employee_emergency_contacts;
create policy employee_emergency_contacts_self_select on public.employee_emergency_contacts
  for select using (exists (select 1 from public.employees e where e.id = employee_id and e.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- Part A4 -- employee_government_ids (U009). Business-scoped per
-- confidentialActions.ts's existing biz(actor) usage. RLS is the real
-- boundary (confidentialActions.ts deliberately queries this table on the
-- user-scoped client, not the service-role client).
-- ----------------------------------------------------------------------------
create table if not exists public.employee_government_ids (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  id_type text not null,
  id_number text not null,
  issued_date date,
  expiry_date date,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, id_type)
);

create index if not exists idx_employee_government_ids_employee on public.employee_government_ids(employee_id);

create or replace function public.set_employee_government_ids_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists employee_government_ids_set_updated_at on public.employee_government_ids;
create trigger employee_government_ids_set_updated_at
before update on public.employee_government_ids
for each row execute function public.set_employee_government_ids_updated_at();

alter table public.employee_government_ids enable row level security;

drop policy if exists employee_government_ids_approver_all on public.employee_government_ids;
create policy employee_government_ids_approver_all on public.employee_government_ids
  for all using (public.is_admin_approver_or_super())
  with check (public.is_admin_approver_or_super());

-- ----------------------------------------------------------------------------
-- Part A5 -- U024: a confidential tier within the existing generic
-- employee_documents/employee_document_types feature (app/admin/documents),
-- rather than a parallel table. Government ID / medical / police clearance
-- document TYPES are flagged confidential; everything else is unaffected.
-- RLS can't cheaply join employee_documents -> employee_document_types
-- row-by-row, so this is enforced the same documented way as
-- employees.notes and fleet_drivers.license_no elsewhere in this schema:
-- DB-level for the flag itself (read-only master, admin-write already
-- gated), application-level redaction for the confidential document rows
-- (see src/modules/admin/employees/documentsActions.ts).
-- ----------------------------------------------------------------------------
alter table public.employee_document_types add column if not exists confidential boolean not null default false;

update public.employee_document_types
set confidential = true
where code in ('government_id', 'medical_clearance', 'police_clearance');

-- ----------------------------------------------------------------------------
-- Part B1 -- U014: canonical, system-controlled, immutable employee_no.
-- Follows the exact guard_supplier_code()/guard_pr_number() pattern already
-- established for every other numbered entity. Format: EMP-####.
-- Existing employee_no values (user-entered) are left untouched -- this only
-- changes how NEW numbers are assigned and blocks future edits.
-- ----------------------------------------------------------------------------
create or replace function public.next_employee_no()
returns text language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('EMP'));
  select coalesce(max(substring(employee_no from 5)::bigint), 0) + 1 into n
  from public.employees
  where employee_no ~ '^EMP-[0-9]{4,}$';
  return 'EMP-' || lpad(n::text, 4, '0');
exception when others then
  return 'EMP-' || lpad((extract(epoch from clock_timestamp())::bigint % 100000)::text, 5, '0');
end $$;

create or replace function public.guard_employee_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (new.employee_no is null or btrim(new.employee_no) = '') then
    new.employee_no := public.next_employee_no();
  end if;
  if tg_op = 'UPDATE' and new.employee_no is distinct from old.employee_no then
    raise exception 'Employee number is system-controlled and immutable.';
  end if;
  return new;
end $$;

drop trigger if exists employees_guard_employee_no on public.employees;
create trigger employees_guard_employee_no
before insert or update on public.employees
for each row execute function public.guard_employee_no();

-- ----------------------------------------------------------------------------
-- Part B2 -- U015: reconcile the status model. The UI (EmployeeManagement.tsx,
-- EmployeeProfile.tsx) has offered a "Suspended" option that the DB enum has
-- never had and setEmployeeStatusAction has always rejected -- a live,
-- reproducible bug (selecting it throws "Invalid employment status."). Since
-- the UI's own intent (and normal HR practice) is that suspension is a real,
-- distinct state from on_leave/inactive, it is added to the enum rather than
-- removed from the UI.
-- ----------------------------------------------------------------------------
alter type public.employee_status add value if not exists 'suspended';

-- Transition guard: no direct DB or app write can silently move an employee
-- between the two terminal-ish states without the expected side data.
-- - separated requires a separation_date (matches the existing
--   employee_dates_check intent, just enforced on the status transition too).
-- - moving OUT of separated (rehire) must go through active/probationary
--   explicitly with a cleared separation_date -- allowed, but the date must
--   be cleared, so a stale separation_date can't survive a rehire by mistake.
create or replace function public.guard_employee_status_transition()
returns trigger language plpgsql as $$
begin
  if new.employment_status = 'separated' and new.separation_date is null then
    raise exception 'A separation date is required when setting status to separated.';
  end if;
  if old.employment_status = 'separated' and new.employment_status <> 'separated' and new.separation_date is not null then
    raise exception 'Clear the separation date before moving an employee out of separated status.';
  end if;
  return new;
end $$;

drop trigger if exists employees_guard_status_transition on public.employees;
create trigger employees_guard_status_transition
before update on public.employees
for each row
when (old.employment_status is distinct from new.employment_status)
execute function public.guard_employee_status_transition();

-- ----------------------------------------------------------------------------
-- Part B3 -- U017: sales_commissions currently carries both employee_id and
-- a separate optional user_id, the one dual-linking inconsistency found
-- against the "employees is the one record every module joins against" rule.
-- Backfill employee_id from user_id where possible, then stop writing
-- user_id going forward (column is kept, nullable, for historical rows that
-- can't be resolved -- no data is deleted).
-- ----------------------------------------------------------------------------
update public.sales_commissions sc
set employee_id = e.id
from public.employees e
where sc.employee_id is null
  and sc.user_id is not null
  and e.user_id = sc.user_id;
