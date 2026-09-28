-- IBX Approvals / Decision Engine
-- Cumulative migration on top of the Sales / Commission Operations build.

-- Fleet expenses previously had no workflow. Add the same approval lifecycle used by Admin expenses.
ALTER TABLE public.fleet_expenses
  ADD COLUMN IF NOT EXISTS status entry_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_fleet_expenses_status ON public.fleet_expenses(status, expense_date DESC);

-- Central decision history. Source records remain the system of record; this table records
-- every central approval decision without changing the source module's schema.
CREATE TABLE IF NOT EXISTS public.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_record_id uuid NOT NULL,
  section_code text NOT NULL,
  action text NOT NULL CHECK (action IN ('reviewed','approved','returned','rejected','posted')),
  from_status text,
  to_status text,
  reason text,
  actor_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_source
  ON public.approval_decisions(source_table, source_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_actor
  ON public.approval_decisions(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_section
  ON public.approval_decisions(section_code, created_at DESC);

ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_decisions_read ON public.approval_decisions;
CREATE POLICY approval_decisions_read ON public.approval_decisions
  FOR SELECT USING (
    public.is_super_admin()
    OR public.in_section((SELECT id FROM public.sections WHERE code = approval_decisions.section_code))
  );

-- Inserts/updates are performed server-side by the decision engine using the service role.
-- No client-side write policy is intentionally exposed.
