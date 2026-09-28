-- ============================================================================
-- A001 follow-up: legacy schema.sql coverage gap
--
-- The 20261012 A001 migration's business_id/RLS sweep only scanned tables
-- defined in supabase/migrations/*.sql. Four tables are instead defined
-- directly in supabase/schema.sql (the original baseline schema, predating
-- the migration-file convention) and were missed:
--   months, expenses, sales_data, financial_summary
-- These are still actively used by every department's expense actions
-- (src/shared/expenses/service.ts) and the legacy sales-entry flow
-- (src/shared/sales/service.ts), so this is a real gap, not a cosmetic one.
--
-- This migration brings them into the same business_id + restrictive-RLS
-- coverage as every other business-scoped table, using the identical
-- pattern from 20261012, and fixes two uniqueness constraints that become
-- wrong once multiple businesses can each have their own "August 2026" or
-- their own section/month financial summary:
--   months:             unique(year, month)         -> unique(business_id, year, month)
--   financial_summary:  unique(section_id, month_id) -> unique(business_id, section_id, month_id)
-- ============================================================================

do $$
declare
  t text;
  biz uuid;
begin
  select id into biz from public.businesses where code = 'ISHABELLA';

  foreach t in array array['months', 'expenses', 'sales_data', 'financial_summary']
  loop
    execute format('alter table public.%I add column if not exists business_id uuid references public.businesses(id)', t);
    execute format('update public.%I set business_id = %L where business_id is null', t, biz);
    execute format('alter table public.%I alter column business_id set default %L', t, biz);
    execute format('alter table public.%I alter column business_id set not null', t);
    execute format('create index if not exists %I on public.%I(business_id)', 'idx_' || t || '_business_id', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_business_isolation', t);
    execute format(
      'create policy %I on public.%I as restrictive for all using (public.is_super_admin() or business_id = public.current_business_id()) with check (public.is_super_admin() or business_id = public.current_business_id())',
      t || '_business_isolation', t
    );
  end loop;
end $$;

-- months: unique(year, month) is now wrong across businesses.
alter table public.months drop constraint if exists months_year_month_key;
alter table public.months add constraint months_business_id_year_month_key unique (business_id, year, month);

-- financial_summary: unique(section_id, month_id) is now wrong across businesses.
alter table public.financial_summary drop constraint if exists financial_summary_section_id_month_id_key;
alter table public.financial_summary add constraint financial_summary_business_id_section_id_month_id_key unique (business_id, section_id, month_id);
