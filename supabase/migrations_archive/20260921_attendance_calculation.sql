-- Application-layer attendance calculation support.
-- The calculated result remains stored in attendance_records so payroll can consume
-- a stable authoritative value. Schedule assignment lookup is indexed for speed.
create index if not exists employee_schedule_effective_lookup_idx
  on public.employee_schedule_assignments(employee_id, effective_from desc, effective_to);
