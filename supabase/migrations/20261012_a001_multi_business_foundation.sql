-- ============================================================================
-- A001 — Multi-business architecture: FOUNDATION LAYER
--
-- Scope of this migration (deliberately bounded — see worklog for the rest):
--   1. New public.businesses table (the tenant root).
--   2. business_id becomes the partition key on every business-scoped table
--      (88 tables — see the array below), each backfilled to the single
--      existing business ("Ishabella Aircon & Refrigeration Parts Trading")
--      so this migration is a no-op for current data/behavior.
--   3. Business isolation enforced at the database layer via RESTRICTIVE RLS
--      policies layered on top of — not replacing — every table's existing
--      permissive (department/workflow) policies. Restrictive policies AND
--      with permissive ones in Postgres, so this adds a hard boundary
--      ("must be in your business") without touching a single existing
--      policy definition.
--   4. public.users gets business_id too (nullable only for role='super_admin',
--      the 5H13 Global Super Admin, who already bypasses RLS via
--      public.is_super_admin()).
--   5. A new 'business_admin' app_role enum value (Business Super Admin),
--      added now so the data model is ready — NOT yet wired into any
--      permissive policy or app-layer permission check. That is UI/app work
--      for a later pass, not a database-layer concern.
--
-- Explicitly NOT in scope for this migration (see worklog "still pending"):
--   - Global/Business Super Admin admin UI, business switcher, business
--     onboarding flow.
--   - Business branding config (U033) beyond the raw jsonb column here.
--   - Shared-master business-specific relationship data (U054), e.g.
--     per-business supplier terms/status, per-business product visibility.
--     Products/Suppliers/Categories/Manufacturers/Units stay global per the
--     locked architecture; only their business-specific overlay is deferred.
--   - Removing the transitional `default <ishabella business id>` on each
--     business_id column (see note at the bottom) once every app write path
--     is confirmed to set business_id explicitly from the acting user's
--     session. Until that app-layer pass happens, this default is a safety
--     net, not a correctness guarantee, for a second business.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. businesses — the tenant root
-- ----------------------------------------------------------------------------
create table if not exists public.businesses (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  legal_name   text not null,
  trade_name   text,
  is_active    boolean not null default true,
  branding     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.businesses enable row level security;

insert into public.businesses (code, legal_name, trade_name)
values ('ISHABELLA', 'Ishabella Aircon and Refrigeration Parts Trading', 'Ishabella')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 2. app_role gets a Business Super Admin tier (additive; not yet consumed
--    by any policy or app code — see header note).
-- ----------------------------------------------------------------------------
alter type public.app_role add value if not exists 'business_admin';

-- ----------------------------------------------------------------------------
-- 3. public.users — business_id (added before the businesses table's own
--    policies below, since those policies read users.business_id).
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists business_id uuid references public.businesses(id);

update public.users u
set business_id = (select id from public.businesses where code = 'ISHABELLA')
where u.business_id is null;

alter table public.users
  drop constraint if exists users_business_id_required_unless_global_admin;
alter table public.users
  add constraint users_business_id_required_unless_global_admin
  check (role = 'super_admin' or business_id is not null);

create index if not exists idx_users_business_id on public.users(business_id);

-- Everyone authenticated may read the list of active businesses they could
-- conceivably belong to is NOT what we want here; a business row should only
-- be readable by its own members plus the Global Super Admin.
drop policy if exists "businesses read own or global admin" on public.businesses;
create policy "businesses read own or global admin" on public.businesses for select using (
  public.is_super_admin()
  or id = (select business_id from public.users where id = auth.uid())
);

drop policy if exists "businesses write global admin only" on public.businesses;
create policy "businesses write global admin only" on public.businesses for all using (
  public.is_super_admin()
) with check (
  public.is_super_admin()
);

-- ----------------------------------------------------------------------------
-- 4. current_business_id() — the RLS helper every restrictive policy below
--    relies on. security definer + set search_path mirrors the existing
--    public.is_super_admin() / public.in_section() pattern in schema.sql,
--    so it reads public.users without being blocked by that table's own RLS.
-- ----------------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select business_id from public.users where id = auth.uid();
$$;

-- Restrictive isolation policy on users itself: a Business Super Admin (once
-- that tier is wired up) or an employee should only ever see users rows in
-- their own business; the Global Super Admin (is_super_admin()) still sees
-- everyone. This layers on top of whatever self-read / admin-write
-- permissive policies already exist on public.users.
drop policy if exists "users business isolation" on public.users;
create policy "users business isolation" on public.users as restrictive for all using (
  public.is_super_admin() or business_id = public.current_business_id()
) with check (
  public.is_super_admin() or business_id = public.current_business_id()
);

-- ----------------------------------------------------------------------------
-- 5. business_id on every business-scoped table (88 tables).
--
-- Shared/global master data is deliberately excluded from this list per the
-- locked architecture (products, suppliers, categories, units stay global):
--   admin_policy_categories, asset_categories, employee_document_types,
--   finance_catalog_categories, finance_catalog_units,
--   finance_procurement_item_suppliers, finance_procurement_items,
--   finance_supplier_contacts, finance_supplier_documents, finance_suppliers,
--   leave_types, supply_categories, workflow_registry, sections
-- (Supplier business-specific relationship data is U054 — deferred.)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  biz uuid;
begin
  select id into biz from public.businesses where code = 'ISHABELLA';

  foreach t in array array[
    'admin_announcements','admin_expense_categories','admin_policies','admin_policy_acknowledgements',
    'approval_decisions','asset_assignments','assets','attendance_corrections','attendance_periods',
    'attendance_records','employee_documents','employee_leave_balances','employee_schedule_assignments',
    'employees','finance_accounting_periods','finance_bank_accounts','finance_bank_reconciliation_items',
    'finance_bank_reconciliations','finance_budget_actuals','finance_budget_lines','finance_budgets',
    'finance_cash_transactions','finance_catalog_category_pricing','finance_catalog_customer_discounts',
    'finance_catalog_item_pricing','finance_catalog_pricing_history','finance_chart_of_accounts',
    'finance_cost_centers','finance_customer_invoice_items','finance_customer_invoices',
    'finance_customer_receipts','finance_customers','finance_journal_entries','finance_journal_lines',
    'finance_supplier_invoice_items','finance_supplier_invoices','finance_supplier_payments',
    'fleet_assignments','fleet_drivers','fleet_expenses','fleet_maintenance','fleet_trips','fleet_vehicles',
    'integration_events','internal_request_categories','internal_request_items','internal_requests',
    'leave_requests','logistics_delivery_events','logistics_delivery_order_items','logistics_delivery_orders',
    'logistics_delivery_stops','logistics_dispatch_items','logistics_dispatches','logistics_inventory_items',
    'logistics_inventory_location_settings','logistics_locations','logistics_receipt_items',
    'logistics_receipts','logistics_stock_movements','logistics_stock_transfer_items',
    'logistics_stock_transfers','marketing_activities','marketing_campaigns','marketing_channels',
    'marketing_leads','payroll_employee_profiles','payroll_entries','payroll_entry_adjustments',
    'payroll_periods','payroll_runs','purchase_order_items','purchase_orders',
    'purchase_requisition_items','purchase_requisitions','sales_commission_monthly_summary',
    'sales_commission_payouts','sales_commissions','sales_monthly_revenue_summary','sales_opportunities',
    'sales_order_items','sales_orders','sales_quotation_items','sales_quotations',
    'sales_revenue_recognitions','supplies','supply_transactions','work_schedules'
  ]
  loop
    -- add the column (nullable first so backfill can run)
    execute format('alter table public.%I add column if not exists business_id uuid references public.businesses(id)', t);

    -- backfill every existing row to the single current business
    execute format('update public.%I set business_id = %L where business_id is null', t, biz);

    -- transitional default: see header note #5 — remove once every app
    -- write path sets business_id explicitly from the session.
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
