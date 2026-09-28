-- U019 — Universal My Employee Profile read foundation.
-- The application resolves the employee record exclusively from auth.uid()
-- through employees.user_id; this migration adds the supporting index.
create index if not exists employees_user_id_active_idx
  on public.employees(user_id, employment_status);
