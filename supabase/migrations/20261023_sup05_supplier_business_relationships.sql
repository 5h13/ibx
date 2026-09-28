-- SUP-05: Supplier-business relationship absent.
--
-- finance_suppliers is, correctly, a GLOBAL shared master (per the "locked
-- architecture" rule -- see 20261012_a001_multi_business_foundation.sql
-- section 5 and 20261019_hr_department_position_location_masters.sql's own
-- restatement of the same rule): one supplier record shared across Pili,
-- Aton and Ishabella, not duplicated per business.
--
-- What was missing is the business-specific OVERLAY the punchlist item asks
-- for: a given supplier can be active for one business and inactive for
-- another, can have different negotiated payment terms per business, and
-- may need business-specific relationship notes -- none of which belongs on
-- the shared global row.
--
-- This migration adds that overlay as its own business-scoped table, using
-- the same restrictive-RLS business-isolation pattern every other
-- business-scoped table got in 20261012_a001_multi_business_foundation.sql,
-- rather than adding business_id directly onto finance_suppliers (which
-- would break the "one global row" model this table is deliberately built
-- to preserve).

create table if not exists public.finance_supplier_business_relationships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  supplier_id uuid not null references public.finance_suppliers(id) on delete cascade,
  status text not null default 'active' check (status in ('active','inactive')),
  -- Business-specific override; null means "use the supplier's global
  -- payment_terms as-is for this business".
  payment_terms_override text,
  preferred boolean not null default false,
  relationship_notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id, supplier_id)
);

create index if not exists idx_finance_supplier_business_rel_business
  on public.finance_supplier_business_relationships(business_id);
create index if not exists idx_finance_supplier_business_rel_supplier
  on public.finance_supplier_business_relationships(supplier_id);

alter table public.finance_supplier_business_relationships enable row level security;

-- App-layer permissive policy (mirrors the finance-section pattern used by
-- every other finance table, e.g. finance_cost_centers).
drop policy if exists finance_supplier_business_rel_select on public.finance_supplier_business_relationships;
create policy finance_supplier_business_rel_select on public.finance_supplier_business_relationships
for select using (public.is_super_admin() or public.has_section_access('finance'));

drop policy if exists finance_supplier_business_rel_write on public.finance_supplier_business_relationships;
create policy finance_supplier_business_rel_write on public.finance_supplier_business_relationships
for all using (public.is_super_admin() or public.has_section_access('finance'))
with check (public.is_super_admin() or public.has_section_access('finance'));

-- Restrictive business-isolation policy, same shape as every other
-- business-scoped table added by 20261012_a001_multi_business_foundation.sql.
drop policy if exists "finance_supplier_business_relationships business isolation" on public.finance_supplier_business_relationships;
create policy "finance_supplier_business_relationships business isolation"
  on public.finance_supplier_business_relationships as restrictive for all using (
    public.is_super_admin() or business_id = public.current_business_id()
  ) with check (
    public.is_super_admin() or business_id = public.current_business_id()
  );
