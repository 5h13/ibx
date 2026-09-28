-- ============================================================================
-- IBX Admin — Group 2: Driver License Confidentiality Completion
--
-- Completes the U009 classification item deliberately deferred by Group 1:
-- CONFIDENTIAL: fleet_drivers.license_no
-- GENERAL (unchanged): fleet_drivers.authorized, license_type, license_expiry
--
-- No other schema change in this group. U010 (Employee Profile) and U012
-- (Change History) are presentation-layer work over Group 1's existing
-- structures and require no migration, per the authorized Group 2 boundary.
--
-- Reuses public.is_admin_approver_or_super(), defined in Group 1's
-- migration (20260923_admin_employee_master_foundation.sql) — no new
-- role/permission primitive is introduced here either.
-- ============================================================================

create or replace function public.guard_fleet_drivers_license_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.license_no is not null)
     or (tg_op = 'UPDATE' and new.license_no is distinct from old.license_no) then
    if not public.is_admin_approver_or_super() then
      raise exception 'Only an Admin approver or Super Admin may set or change a driver license number.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists fleet_drivers_guard_license_no on public.fleet_drivers;
create trigger fleet_drivers_guard_license_no
  before insert or update on public.fleet_drivers
  for each row execute function public.guard_fleet_drivers_license_no();

-- No RLS policy change: fleet_drivers_admin_all (Admin) and "logistics can
-- read fleet drivers" (Logistics) are UNCHANGED — row-level RLS cannot
-- express a column-level restriction, the same limitation already
-- documented for employees.notes in Group 1. The write side is fully
-- DB-enforced by the trigger above, regardless of caller/client. The read
-- side is redacted at the application layer within Admin's own Fleet module
-- in this group (see the implementation report); Logistics'
-- warehouse-delivery page, which also currently reads license_no, is
-- OUT OF SCOPE for this group and is flagged, not modified — see the
-- Group 2 report's discovered-dependency section.
