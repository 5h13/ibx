-- ============================================================================
-- Build 77 (access + multi-business) — punchlist RA-05, RA-06, A001 remaining
-- pieces.
--
-- 1. RA-05  Policies & Announcements open to every employee.
--    Reading was already open (admin_policies_select / admin_announcements_
--    select: published rows, any signed-in user, own business by the
--    restrictive isolation policy). Acknowledging was broken outside
--    Ishabella: admin_policy_acknowledgements.business_id still carries A001's
--    transitional Ishabella default and the app does not send it, so a Pili or
--    Aton employee's acknowledgement failed the isolation check. The
--    acknowledgement now takes its business from the policy it acknowledges.
--
-- 2. RA-06  Preparer / reviewer / approver separation in the database
--    (defence in depth; the app checks were corrected in Build 58).
--    One generic BEFORE INSERT/UPDATE trigger, workflow_separation_guard(),
--    on the main Finance workflow tables:
--      finance_supplier_invoices, finance_supplier_payments,
--      finance_customer_invoices, finance_customer_receipts,
--      finance_cash_transactions, finance_journal_entries, finance_budgets,
--      payroll_runs, purchase_requisitions, purchase_orders  (section finance)
--      expenses  (section = the expense's own section_id)
--    Rules, for direct writes made by an API session only:
--      * a move to reviewed needs the reviewer role for the section (an
--        approver grant satisfies it, as in has_workflow_role), a move to
--        approved / posted / paid / partially_paid / closed needs the
--        approver role; admin tier (super_admin, business_admin) passes;
--      * the approver may not be the preparer (Global Super Admin excepted);
--      * posted / paid / closed only from an approved (or later) row, so the
--        approval step cannot be skipped;
--      * an approved or later row cannot be moved back to draft / prepared /
--        reviewed, and voiding one needs the approver role;
--      * prepared_by can only name the current user; reviewed_by,
--        approved_by and posted_by cannot be rewritten without a status
--        change, and are stamped with the acting user on the transition;
--      * a row cannot be inserted already reviewed / approved / posted,
--        except the cash-out an approver books when marking a posted expense
--        paid (shared/expenses/service.ts markExpensePaid).
--    Which writes are checked: current_user is 'authenticated' (or 'anon')
--    only for statements sent by PostgREST. Inside a SECURITY DEFINER
--    function current_user is the function owner, so rows written by
--    storefront posting, closings, storefront_record_payment, combined SI,
--    bounced-check invoices, revenue drafts, recalculate_* etc. are not
--    affected even though auth.uid() is the sales user. The trigger function
--    itself is deliberately NOT security definer (that would hide the
--    caller). The service role (server-side admin client) is not checked.
--    post_finance_journal() (an RPC, security definer) now also requires the
--    approver role when called from an API session and records the caller as
--    poster.
--
-- 3. A001 remaining pieces — business-owned keys were unique across all
--    businesses, so a second business could not use the same code / number
--    (and the error leaked the other business's row). Each is now unique per
--    business (business_id, key). Checked first: no foreign key references
--    any of these unique keys, no ON CONFLICT target (live functions or app
--    upserts) names them, and no function looks a row up by these keys alone
--    except storefront_combined_si (its business-prefixed SI number; the
--    global existence check there only becomes stricter). Deliberately left
--    global: see the list at the end of this file.
-- ============================================================================

-- ------------------------------------------------------------ 1. RA-05 ------
create or replace function public.policy_ack_business()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select business_id into b from public.admin_policies where id = new.policy_id;
  if b is null then raise exception 'Policy not found.'; end if;
  new.business_id := b;
  return new;
end $$;

drop trigger if exists admin_policy_ack_business on public.admin_policy_acknowledgements;
create trigger admin_policy_ack_business before insert on public.admin_policy_acknowledgements
  for each row execute function public.policy_ack_business();

-- ------------------------------------------------------------ 2. RA-06 ------
create or replace function public.workflow_status_rank(p_status text)
returns int language sql immutable as $$
  select case p_status
    when 'draft' then 0 when 'prepared' then 1 when 'reviewed' then 2 when 'approved' then 3
    when 'posted' then 4 when 'partially_paid' then 4 when 'paid' then 4 when 'closed' then 4
    when 'voided' then -1 else null end
$$;

create or replace function public.workflow_separation_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  uid uuid := auth.uid();
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_new text := n->>'status';
  v_old text := o->>'status';
  r_new int := public.workflow_status_rank(n->>'status');
  r_old int := public.workflow_status_rank(o->>'status');
  v_label text := case tg_table_name
    when 'finance_supplier_invoices' then 'supplier invoice' when 'finance_supplier_payments' then 'supplier payment'
    when 'finance_customer_invoices' then 'customer invoice' when 'finance_customer_receipts' then 'customer receipt'
    when 'finance_cash_transactions' then 'cash / bank transaction' when 'finance_journal_entries' then 'journal entry'
    when 'finance_budgets' then 'budget' when 'payroll_runs' then 'payroll run'
    when 'purchase_requisitions' then 'purchase requisition' when 'purchase_orders' then 'purchase order'
    when 'expenses' then 'expense' else replace(tg_table_name, '_', ' ') end;
  v_section uuid;
  v_super boolean;
  v_tier boolean;
  v_needed public.workflow_role;
  v_preparer uuid;
  v_stamp jsonb := '{}'::jsonb;
begin
  -- Only statements sent directly by an API session are checked; SECURITY
  -- DEFINER functions run as their owner (see the header).
  if current_user not in ('authenticated', 'anon') then return new; end if;

  v_super := public.is_super_admin();
  v_tier := v_super or public.is_business_admin();
  -- expenses belong to their own department's section (as in their RLS);
  -- every other table is approved by Finance (as in the Approvals queue),
  -- whatever section_id a journal carries.
  v_section := case when tg_table_name = 'expenses' then nullif(n->>'section_id', '')::uuid
                    else (select id from public.sections where code = tg_argv[0]) end;

  if tg_op = 'INSERT' then
    if not v_super and n ? 'prepared_by' and n->>'prepared_by' is not null and (n->>'prepared_by')::uuid is distinct from uid then
      raise exception 'The preparer of a % must be the user who prepares it.', v_label;
    end if;
    if coalesce(r_new, 0) between 0 and 1 or v_super then return new; end if;
    -- markExpensePaid: the approver who pays a posted expense books its cash-out as posted.
    if tg_table_name = 'finance_cash_transactions' and n->>'source_module' = 'expenses' and r_new = 4
       and exists (select 1 from public.expenses e
                    where e.id = nullif(n->>'source_record_id', '')::uuid and e.status = 'posted'
                      and (v_tier or public.has_workflow_role(e.section_id, 'approver'))) then
      return new;
    end if;
    raise exception 'A % cannot be created as %; create it as a draft and take it through review and approval.', v_label, v_new;
  end if;

  -- UPDATE
  if not v_super then
    if (n->>'prepared_by') is distinct from (o->>'prepared_by') and n->>'prepared_by' is not null
       and (n->>'prepared_by')::uuid is distinct from uid then
      raise exception 'The preparer of a % must be the user who prepares it.', v_label;
    end if;
    if v_new is not distinct from v_old and (
         (n->>'reviewed_by') is distinct from (o->>'reviewed_by')
      or (n->>'approved_by') is distinct from (o->>'approved_by')
      or (n->>'posted_by') is distinct from (o->>'posted_by')) then
      raise exception 'Reviewer, approver and poster of a % are recorded by the workflow and cannot be edited.', v_label;
    end if;
  end if;

  if v_new is not distinct from v_old then return new; end if;

  if v_new = 'voided' then
    if coalesce(r_old, 0) >= 3 and not v_tier and not public.has_workflow_role(v_section, 'approver') then
      raise exception 'Approver access is required to void an approved or posted %.', v_label;
    end if;
    return new;
  end if;

  if r_new is null or r_old is null then return new; end if;

  if r_old >= 3 and r_new < 3 and not v_super then
    raise exception 'An % % cannot be moved back to %.', v_old, v_label, v_new;
  end if;

  if r_new < 2 then return new; end if;  -- draft / prepared: row-level security decides

  v_needed := case when r_new = 2 then 'reviewer' else 'approver' end;
  if not v_tier and not public.has_workflow_role(v_section, v_needed) then
    raise exception '% access is required to mark this % as %.', initcap(v_needed::text), v_label, v_new;
  end if;

  if r_new = 4 and r_old < 3 then
    raise exception 'A % must be approved before it is %.', v_label, v_new;
  end if;

  if r_new = 3 and not v_super then
    v_preparer := coalesce(nullif(o->>'prepared_by', '')::uuid, nullif(o->>'created_by', '')::uuid);
    if uid is not distinct from v_preparer or uid::text is not distinct from n->>'prepared_by' then
      raise exception 'You prepared this %, so another approver must approve it.', v_label;
    end if;
  end if;

  -- record who actually made the transition
  if r_new = 2 and n ? 'reviewed_by' then v_stamp := jsonb_build_object('reviewed_by', uid); end if;
  if r_new = 3 and n ? 'approved_by' then v_stamp := jsonb_build_object('approved_by', uid); end if;
  if v_new = 'posted' and n ? 'posted_by' then v_stamp := jsonb_build_object('posted_by', uid); end if;
  if v_stamp <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_stamp);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['finance_supplier_invoices','finance_supplier_payments','finance_customer_invoices',
                           'finance_customer_receipts','finance_cash_transactions','finance_journal_entries',
                           'finance_budgets','payroll_runs','purchase_requisitions','purchase_orders','expenses'] loop
    execute format('drop trigger if exists workflow_separation_guard on public.%I', t);
    execute format('create trigger workflow_separation_guard before insert or update on public.%I
                    for each row execute function public.workflow_separation_guard(%L)', t, 'finance');
  end loop;
end $$;

-- post_finance_journal: unchanged except the caller check and the poster.
create or replace function public.post_finance_journal(p_journal_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare j public.finance_journal_entries%rowtype; period_status text; d numeric(14,2); c numeric(14,2); v_actor uuid := p_actor;
begin
  select * into j from public.finance_journal_entries where id=p_journal_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if not public.is_super_admin() and j.business_id is distinct from public.current_business_id() then
    raise exception 'Journal entry does not belong to your business.';
  end if;
  -- RA-06: called from an API session (role GUC stays 'authenticated' inside a definer function)
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    if not (public.is_super_admin() or public.is_business_admin()
            or public.has_workflow_role((select id from public.sections where code = 'finance'), 'approver')) then
      raise exception 'Approver access is required to post a journal entry.';
    end if;
    v_actor := coalesce(auth.uid(), p_actor);
  end if;
  if j.status <> 'approved' then raise exception 'Only approved journal entries can be posted'; end if;
  select status into period_status from public.finance_accounting_periods
   where business_id=j.business_id and year=extract(year from j.entry_date)::int and month=extract(month from j.entry_date)::int;
  if period_status='closed' then raise exception 'Accounting period is closed'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d,c from public.finance_journal_lines where journal_entry_id=j.id;
  if d <= 0 or d <> c then raise exception 'Journal entry must be balanced and greater than zero'; end if;
  update public.finance_journal_entries set status='posted',posted_by=v_actor,posted_at=now(),total_debit=d,total_credit=c,updated_at=now() where id=j.id;
  perform public.refresh_financial_summary_from_ledger(j.entry_date, j.business_id);
end; $function$;

-- ------------------------------------------------------------ 3. A001 -------
-- (table, old constraint, new constraint, key columns)
do $$
declare r record;
begin
  for r in select * from (values
    ('admin_announcements',        'admin_announcements_announcement_no_key',        'admin_announcements_business_announcement_no_key',   'announcement_no'),
    ('admin_policies',             'admin_policies_policy_no_key',                   'admin_policies_business_policy_no_key',              'policy_no'),
    ('assets',                     'assets_serial_number_key',                       'assets_business_serial_number_key',                  'serial_number'),
    ('attendance_periods',         'attendance_periods_start_date_end_date_key',     'attendance_periods_business_dates_key',              'start_date, end_date'),
    ('finance_accounting_periods', 'finance_accounting_periods_year_month_key',      'finance_accounting_periods_business_year_month_key', 'year, month'),
    ('finance_budgets',            'finance_budgets_budget_code_key',                'finance_budgets_business_budget_code_key',           'budget_code'),
    ('finance_cash_transactions',  'finance_cash_transactions_transaction_number_key','finance_cash_transactions_business_number_key',     'transaction_number'),
    ('finance_cost_centers',       'finance_cost_centers_code_key',                  'finance_cost_centers_business_code_key',             'code'),
    ('finance_customer_invoices',  'finance_customer_invoices_invoice_number_key',   'finance_customer_invoices_business_number_key',      'invoice_number'),
    ('finance_customer_receipts',  'finance_customer_receipts_receipt_number_key',   'finance_customer_receipts_business_number_key',      'receipt_number'),
    ('finance_customers',          'finance_customers_customer_code_key',            'finance_customers_business_customer_code_key',       'customer_code'),
    ('finance_journal_entries',    'finance_journal_entries_journal_number_key',     'finance_journal_entries_business_number_key',        'journal_number'),
    ('finance_supplier_invoices',  'finance_supplier_invoices_supplier_id_invoice_number_key', 'finance_supplier_invoices_business_supplier_number_key', 'supplier_id, invoice_number'),
    ('finance_supplier_payments',  'finance_supplier_payments_payment_number_key',   'finance_supplier_payments_business_number_key',      'payment_number'),
    ('fleet_trips',                'fleet_trips_trip_no_key',                        'fleet_trips_business_trip_no_key',                   'trip_no'),
    ('fleet_vehicles',             'fleet_vehicles_vehicle_no_key',                  'fleet_vehicles_business_vehicle_no_key',             'vehicle_no'),
    ('fleet_vehicles',             'fleet_vehicles_plate_no_key',                    'fleet_vehicles_business_plate_no_key',               'plate_no'),
    ('fleet_vehicles',             'fleet_vehicles_vin_key',                         'fleet_vehicles_business_vin_key',                    'vin'),
    ('fleet_vehicles',             'fleet_vehicles_engine_no_key',                   'fleet_vehicles_business_engine_no_key',              'engine_no'),
    ('internal_request_categories','internal_request_categories_code_key',           'internal_request_categories_business_code_key',      'code'),
    ('internal_requests',          'internal_requests_request_no_key',               'internal_requests_business_request_no_key',          'request_no'),
    ('logistics_delivery_orders',  'logistics_delivery_orders_delivery_number_key',  'logistics_delivery_orders_business_number_key',      'delivery_number'),
    ('logistics_dispatches',       'logistics_dispatches_dispatch_number_key',       'logistics_dispatches_business_number_key',           'dispatch_number'),
    ('marketing_campaigns',        'marketing_campaigns_campaign_code_key',          'marketing_campaigns_business_campaign_code_key',     'campaign_code'),
    ('marketing_channels',         'marketing_channels_channel_code_key',            'marketing_channels_business_channel_code_key',       'channel_code'),
    ('marketing_leads',            'marketing_leads_lead_code_key',                  'marketing_leads_business_lead_code_key',             'lead_code'),
    ('payroll_periods',            'payroll_periods_start_date_end_date_key',        'payroll_periods_business_dates_key',                 'start_date, end_date'),
    ('payroll_runs',               'payroll_runs_run_number_key',                    'payroll_runs_business_run_number_key',               'run_number'),
    ('sales_commission_payouts',   'sales_commission_payouts_payout_number_key',     'sales_commission_payouts_business_number_key',       'payout_number'),
    ('sales_commissions',          'sales_commissions_commission_number_key',        'sales_commissions_business_number_key',              'commission_number'),
    ('sales_opportunities',        'sales_opportunities_opportunity_number_key',     'sales_opportunities_business_number_key',            'opportunity_number'),
    ('supplies',                   'supplies_item_code_key',                         'supplies_business_item_code_key',                    'item_code'),
    ('work_schedules',             'work_schedules_name_key',                        'work_schedules_business_name_key',                   'name')
  ) v(tbl, old_name, new_name, cols) loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.old_name);
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.new_name);
    execute format('alter table public.%I add constraint %I unique (business_id, %s)', r.tbl, r.new_name, r.cols);
  end loop;
end $$;

-- finance_budgets_year_version_idx is a unique index, not a constraint.
drop index if exists public.finance_budgets_year_version_idx;
create unique index if not exists finance_budgets_business_year_version_idx
  on public.finance_budgets (business_id, fiscal_year, scenario, version);

-- Deliberately left GLOBAL (unique across businesses):
--  * System numbers from one global series, generated by SECURITY DEFINER
--    functions that see every business (unique by construction, unprefixed,
--    so a global key keeps unscoped lookups unambiguous):
--      purchase_requisitions.pr_number (PR-), purchase_orders.po_number (PO-),
--      logistics_receipts.receipt_number (RCV-), logistics_stock_transfers.
--      transfer_number (TRF-), logistics_stock_movements.movement_number
--      (STM-), employees.employee_no (EMP-), assets.asset_no (AST-, immutable).
--  * System numbers that already carry the business code (unique per
--    business by construction): storefront_sales sale/dr numbers,
--    storefront_payments, storefront_returns, storefront_closings,
--    storefront_cash_movements, sales_orders.order_number, sales_quotations
--    (quotation_number, base_number+revision), sales_revenue_recognitions.
--    recognition_number (REC-<order no>), inventory_opening_counts.count_number
--    (<CODE>-OPC-).
--  * Keys made of another row's id (that row already belongs to one business):
--    admin_policy_acknowledgements(policy_id,user_id), asset_assignments,
--    attendance_records(employee_id,date), employee_government_ids,
--    employee_leave_balances, employees.user_id (one login = one business,
--    RA-07), finance_bank_reconciliations(bank_account_id,date),
--    finance_budget_actuals, finance_budget_lines, finance_cash_transactions
--    (bank_account_id,check_number), finance_catalog_customer_discounts
--    (customer_id,item_id), finance_item_supplier_price_history
--    (purchase_order_item_id), finance_posted_source_unique_idx
--    (source_module, source_record_id uuid), fleet_assignments, fleet_drivers,
--    inventory_opening_count_lines, logistics_delivery_stops,
--    logistics_inventory_location_settings, uq_stock_movement_source_line,
--    payroll_employee_profiles, payroll_entries, payroll_runs.period_id,
--    purchase_requisitions_one_per_sales_order, sales_orders_one_open_per_quote,
--    sales_revenue_recognitions.sales_order_id, storefront_checks.payment_id.
--    Several are ON CONFLICT targets (app upserts / definer functions).
--  * Shared taxonomy / masters (no business_id or deliberately global):
--    sections, leave_types, hr_departments, admin_expense_categories,
--    finance_suppliers, finance_catalog_categories, finance_procurement_items.
