-- ============================================================================
-- Build 77 — catalog & procurement audit items
--
--  1. PROC-01  procurement_dashboard(period): the Finance → Procurement
--     overview computed in SQL, scoped to the viewer's store (the Super Admin
--     sees the "Acting as" store, or every store when none is chosen):
--     PR/PO pipeline, PO issuance breakout, average PR→PO and PO→receipt
--     cycle times, spend by supplier and by category, and an action queue
--     holding only the steps the viewer's own Finance workflow role can take.
--     Every figure carries the ids of its records so the page can drill down.
--  2. CAT-11   catalog_item_pricing_history(item): the item's markup, category
--     add-on and customer-discount changes (finance_catalog_pricing_history,
--     written by triggers since Build 20 but never shown), store-scoped, with
--     the previous value and who made the change.
--  3. CAT-07   catalog_import_pricing(): the dry run also reports, per store,
--     how many rows change an existing price ('price_changes') and how many
--     new items get a price ('new_item_prices') — for the import preview.
--     Otherwise unchanged.
--  4. PR list  procurement_user_names(ids): names (only) of the people on the
--     PRs/POs the caller can see. users RLS hides other users' rows, so the
--     "Requested by" column was blank for everybody else's PRs.
--  5. U052     supplier tax ID, bank details and payment destination move to
--     finance_supplier_private (RLS: Finance / admin only). The columns stay
--     on finance_suppliers (so existing selects keep working) but are always
--     NULL there: a trigger diverts any value written to them into the
--     private table. Writes from the app go through
--     supplier_set_private_details().
-- ============================================================================

-- ------------------------------------------------------------- helpers ---
-- Finance access: Super Admin, Business Admin, a user whose role is Finance,
-- or anybody granted the Finance section.
create or replace function public.procurement_finance_access()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.users u where u.id = auth.uid() and u.is_active)
     and (public.is_super_admin() or public.is_business_admin()
          or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance')
          or public.has_section_access('finance'));
$$;
revoke all on function public.procurement_finance_access() from public;
grant execute on function public.procurement_finance_access() to authenticated;

-- The store the caller's procurement figures belong to: own business, or the
-- Super Admin's "Acting as" business (NULL = every business, Super Admin only).
create or replace function public.procurement_scope_business()
returns uuid language sql stable security definer set search_path = public as $$
  select case when public.is_super_admin() then public.super_admin_view_business() else public.current_business_id() end;
$$;
revoke all on function public.procurement_scope_business() from public;
grant execute on function public.procurement_scope_business() to authenticated;

create or replace function public.procurement_in_scope(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when public.is_super_admin() and public.super_admin_view_business() is null then true
              else p_business_id is not distinct from public.procurement_scope_business()
                   and p_business_id is not null end;
$$;
revoke all on function public.procurement_in_scope(uuid) from public;
grant execute on function public.procurement_in_scope(uuid) to authenticated;

-- ------------------------------------------------- 1. PROC-01 dashboard ---
-- p_period: 'month' (default), 'quarter' or 'ytd' — Philippine time.
create or replace function public.procurement_dashboard(p_period text default 'month')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_super boolean := public.is_super_admin();
  v_admin boolean;
  v_scope uuid;
  v_all boolean;
  v_fin uuid;
  v_role text; v_section uuid;
  v_prep boolean; v_rev boolean; v_appr boolean;
  v_unit text;
  v_start timestamptz; v_end timestamptz := now();
  v_out jsonb;
begin
  if not public.procurement_finance_access() then
    raise exception 'Finance access is required for the procurement dashboard.';
  end if;
  v_admin := v_super or public.is_business_admin();
  v_scope := public.procurement_scope_business();
  v_all := v_super and v_scope is null;
  select id into v_fin from public.sections where code = 'finance';
  select role::text, section_id into v_role, v_section from public.users where id = v_uid;
  -- same rule as the app (hasFinanceWorkflowRole): admin tier does every
  -- step; a Finance-role user of the Finance section prepares; otherwise the
  -- Finance workflow grants (an approver may also review).
  v_prep := v_admin or (v_role = 'finance' and v_section is not distinct from v_fin) or public.has_workflow_role(v_fin, 'preparer');
  v_rev  := v_admin or public.has_workflow_role(v_fin, 'reviewer');
  v_appr := v_admin or public.has_workflow_role(v_fin, 'approver');

  v_unit := case lower(coalesce(p_period, 'month')) when 'quarter' then 'quarter' when 'ytd' then 'year' when 'year' then 'year' else 'month' end;
  v_start := date_trunc(v_unit, now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';

  with pr as (
    select * from public.purchase_requisitions x where v_all or x.business_id = v_scope
  ), po as (
    select * from public.purchase_orders x where v_all or x.business_id = v_scope
  ), pr_p as (
    select * from pr where created_at >= v_start and created_at <= v_end
  ), po_p as (
    select * from po where coalesce(created_at, order_date::timestamptz) >= v_start and coalesce(created_at, order_date::timestamptz) <= v_end
  ), spend_po as (   -- committed spend: approved POs dated in the period
    select * from po where status = 'approved' and order_date >= (v_start at time zone 'Asia/Manila')::date and order_date <= (v_end at time zone 'Asia/Manila')::date
  ), pr_cycle as (   -- PR created → its first PO created, measured when the PO is raised in the period
    select pr.id, extract(epoch from (min(po.created_at) - pr.created_at)) / 86400.0 as days, min(po.created_at) as done_at
      from pr join po on po.requisition_id = pr.id
     group by pr.id, pr.created_at
  ), rc_cycle as (   -- PO issued (else approved) → first approved/posted receipt, measured when received in the period
    select po.id, extract(epoch from (min(coalesce(r.posted_at, r.approved_at, r.receipt_date::timestamptz)) - coalesce(po.issued_at, po.approved_at))) / 86400.0 as days,
           min(coalesce(r.posted_at, r.approved_at, r.receipt_date::timestamptz)) as done_at
      from po join public.logistics_receipts r on r.purchase_order_id = po.id and (r.status = 'approved' or r.posted_at is not null)
     where coalesce(po.issued_at, po.approved_at) is not null
     group by po.id, po.issued_at, po.approved_at
  ), queue as (
    select 'pr'::text as kind, pr.id, pr.pr_number as ref, pr.status::text as status,
           case pr.status when 'draft' then 'Prepare' when 'prepared' then 'Review' when 'reviewed' then 'Approve' else 'Create PO' end as step,
           coalesce(pr.purpose, 'Purchase requisition') as label, pr.estimated_total as amount, pr.created_at
      from pr
     where (pr.status = 'draft' and v_prep) or (pr.status = 'prepared' and v_rev) or (pr.status = 'reviewed' and v_appr)
        or (pr.status = 'approved' and v_prep and pr.fulfillment_status = 'awaiting_po'
            and not exists (select 1 from po where po.requisition_id = pr.id))
    union all
    select 'po', po.id, po.po_number, po.status::text,
           case when po.status = 'draft' then 'Prepare' when po.status = 'prepared' then 'Review' when po.status = 'reviewed' then 'Approve' else 'Issue to supplier' end,
           coalesce(nullif(po.notes, ''), (select s.legal_name from public.finance_suppliers s where s.id = po.supplier_id), 'Purchase order'), po.total_amount, po.created_at
      from po
     where (po.status = 'draft' and v_prep) or (po.status = 'prepared' and v_rev) or (po.status = 'reviewed' and v_appr)
        or (po.status = 'approved' and po.issuance_status = 'draft' and v_appr)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('key', lower(coalesce(p_period, 'month')), 'start', v_start, 'end', v_end),
    'scope', jsonb_build_object('business_id', v_scope, 'all_businesses', v_all,
                                'business_code', (select code from public.businesses where id = v_scope)),
    'roles', jsonb_build_object('preparer', v_prep, 'reviewer', v_rev, 'approver', v_appr),
    'totals', jsonb_build_object(
       'active_suppliers', (select count(*) from public.finance_suppliers s where s.active
                              and not exists (select 1 from public.finance_supplier_business_relationships rel
                                               where rel.supplier_id = s.id and rel.status = 'inactive' and not v_all and rel.business_id = v_scope)),
       'pr_count', (select count(*) from pr_p), 'pr_value', (select coalesce(sum(estimated_total), 0) from pr_p),
       'pr_ids', (select coalesce(jsonb_agg(id), '[]') from pr_p),
       'po_count', (select count(*) from po_p), 'po_value', (select coalesce(sum(total_amount), 0) from po_p),
       'po_ids', (select coalesce(jsonb_agg(id), '[]') from po_p),
       'committed_value', (select coalesce(sum(total_amount), 0) from spend_po),
       'committed_ids', (select coalesce(jsonb_agg(id), '[]') from spend_po)),
    'pr_pipeline', (select coalesce(jsonb_agg(jsonb_build_object('status', st, 'count', n, 'value', v, 'ids', ids) order by ord), '[]')
                      from (select status::text as st, array_position(enum_range(null::entry_status), status) as ord, count(*) as n,
                                   coalesce(sum(estimated_total), 0) as v, jsonb_agg(id) as ids from pr_p group by status) g),
    'po_pipeline', (select coalesce(jsonb_agg(jsonb_build_object('status', st, 'count', n, 'value', v, 'ids', ids) order by ord), '[]')
                      from (select status::text as st, array_position(enum_range(null::entry_status), status) as ord, count(*) as n,
                                   coalesce(sum(total_amount), 0) as v, jsonb_agg(id) as ids from po_p group by status) g),
    'po_issuance', (select coalesce(jsonb_agg(jsonb_build_object('issuance_status', st, 'count', n, 'value', v, 'ids', ids)
                                       order by array_position(array['not_approved','awaiting_issue','issued','acknowledged','closed','cancelled'], st)), '[]')
                      from (select st, count(*) as n, coalesce(sum(total_amount), 0) as v, jsonb_agg(id) as ids
                              from (select id, total_amount,
                                           case when issuance_status = 'draft' and status = 'approved' then 'awaiting_issue'
                                                when issuance_status = 'draft' then 'not_approved' else issuance_status end as st
                                      from po_p) z
                             group by st) g),
    'cycle', jsonb_build_object(
       'pr_to_po_days', (select round(avg(days)::numeric, 1) from pr_cycle where done_at >= v_start and done_at <= v_end),
       'pr_to_po_count', (select count(*) from pr_cycle where done_at >= v_start and done_at <= v_end),
       'pr_to_po_ids', (select coalesce(jsonb_agg(id), '[]') from pr_cycle where done_at >= v_start and done_at <= v_end),
       'po_to_receipt_days', (select round(avg(days)::numeric, 1) from rc_cycle where done_at >= v_start and done_at <= v_end),
       'po_to_receipt_count', (select count(*) from rc_cycle where done_at >= v_start and done_at <= v_end),
       'po_to_receipt_ids', (select coalesce(jsonb_agg(id), '[]') from rc_cycle where done_at >= v_start and done_at <= v_end)),
    'spend_by_supplier', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', g.supplier_id, 'supplier_code', s.supplier_code, 'legal_name', s.legal_name,
                                                                        'count', g.n, 'amount', g.amt, 'ids', g.ids) order by g.amt desc, s.legal_name), '[]')
                            from (select supplier_id, count(*) as n, coalesce(sum(total_amount), 0) as amt, jsonb_agg(id) as ids
                                    from spend_po group by supplier_id order by 3 desc limit 10) g
                            join public.finance_suppliers s on s.id = g.supplier_id),
    'spend_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', g.cat, 'lines', g.n, 'amount', g.amt, 'ids', g.ids) order by g.amt desc, g.cat), '[]')
                            from (select coalesce(nullif(btrim(i.category), ''), 'Not in catalog') as cat, count(*) as n, coalesce(sum(l.amount), 0) as amt,
                                         jsonb_agg(distinct l.purchase_order_id) as ids
                                    from spend_po p join public.purchase_order_items l on l.purchase_order_id = p.id
                                    left join public.finance_procurement_items i on i.id = l.item_id
                                   group by 1 order by 3 desc limit 12) g),
    'action_queue', jsonb_build_object(
       'total', (select count(*) from queue),
       'by_step', (select coalesce(jsonb_object_agg(step, n), '{}') from (select kind || ':' || step as step, count(*) as n from queue group by 1) s),
       'items', (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]')
                   from (select * from queue order by created_at limit 50) q))
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.procurement_dashboard(text) from public;
grant execute on function public.procurement_dashboard(text) to authenticated;

-- ------------------------------------------- 2. CAT-11 pricing history ---
-- One item's price-rule history for the caller's store: its markup, its
-- category's add-on and its customer discounts, each with the value before.
create or replace function public.catalog_item_pricing_history(p_item_id uuid)
returns table(id uuid, captured_at timestamptz, business_code text, rule_type text, subject text,
              value_percent numeric, previous_percent numeric, effective_from date, captured_by_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_cat uuid;
begin
  if not public.procurement_finance_access() then
    raise exception 'Finance access is required to view pricing history.';
  end if;
  select c.id into v_cat
    from public.finance_procurement_items i
    join public.finance_catalog_categories c on lower(btrim(c.name)) = lower(btrim(i.category))
   where i.id = p_item_id
   limit 1;
  return query
  select h.id, h.captured_at, b.code, h.rule_type,
         case h.rule_type when 'category_addon' then 'Category add-on' || coalesce(' (' || cat.name || ')', '')
                          when 'item_markup' then 'Item markup'
                          else 'Customer discount' || coalesce(' — ' || cu.legal_name, '') end,
         h.value_percent, h.prev, h.effective_from, u.full_name
    from (select x.*, lag(x.value_percent) over (partition by x.business_id, x.rule_type, x.category_id, x.item_id, x.customer_id
                                                   order by x.captured_at, x.id) as prev
            from public.finance_catalog_pricing_history x
           where public.procurement_in_scope(x.business_id)
             and ((x.rule_type in ('item_markup', 'customer_discount') and x.item_id = p_item_id)
                  or (x.rule_type = 'category_addon' and v_cat is not null and x.category_id = v_cat))) h
    left join public.businesses b on b.id = h.business_id
    left join public.finance_catalog_categories cat on cat.id = h.category_id
    left join public.finance_customers cu on cu.id = h.customer_id
    left join public.users u on u.id = h.captured_by
   order by h.captured_at desc, h.id;
end;
$$;
revoke all on function public.catalog_item_pricing_history(uuid) from public;
grant execute on function public.catalog_item_pricing_history(uuid) to authenticated;

-- ------------------------------------------------- 4. requester names ---
-- Names only (no e-mail, role or business) of people who appear on a PR or
-- PO the caller may see.
create or replace function public.procurement_user_names(p_ids uuid[])
returns table(id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.procurement_finance_access() then
    raise exception 'Finance access is required.';
  end if;
  return query
  select u.id, u.full_name
    from public.users u
   where u.id = any(coalesce(p_ids, '{}'::uuid[]))
     and (exists (select 1 from public.purchase_requisitions pr
                   where public.procurement_in_scope(pr.business_id)
                     and u.id in (pr.requested_by, pr.prepared_by, pr.reviewed_by, pr.approved_by))
          or exists (select 1 from public.purchase_orders po
                      where public.procurement_in_scope(po.business_id)
                        and u.id in (po.prepared_by, po.reviewed_by, po.approved_by, po.issued_by)));
end;
$$;
revoke all on function public.procurement_user_names(uuid[]) from public;
grant execute on function public.procurement_user_names(uuid[]) to authenticated;

-- ------------------------------------ 5. U052 supplier private details ---
create table if not exists public.finance_supplier_private (
  supplier_id uuid primary key references public.finance_suppliers(id) on delete cascade deferrable initially deferred,
  tax_id text,
  bank_details text,
  payment_destination text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);
alter table public.finance_supplier_private enable row level security;
drop policy if exists "supplier private finance read" on public.finance_supplier_private;
create policy "supplier private finance read" on public.finance_supplier_private
  for select using (public.procurement_finance_access());
-- no insert/update/delete policies: writes go through supplier_set_private_details()
grant select on public.finance_supplier_private to authenticated;

-- move what is on the shared row today
insert into public.finance_supplier_private(supplier_id, tax_id, bank_details, payment_destination)
select id, nullif(btrim(tax_id), ''), nullif(btrim(bank_details), ''), nullif(btrim(payment_destination), '')
  from public.finance_suppliers
 where coalesce(btrim(tax_id), '') <> '' or coalesce(btrim(bank_details), '') <> '' or coalesce(btrim(payment_destination), '') <> ''
on conflict (supplier_id) do nothing;

-- Any value written to the three columns of finance_suppliers (an older
-- client, a direct API call, a later migration) goes to the private table
-- instead; the shared row never holds them. A NULL never clears a stored
-- value here — clearing is done with supplier_set_private_details().
create or replace function public.divert_supplier_private()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(new.tax_id), '') is not null or nullif(btrim(new.bank_details), '') is not null
     or nullif(btrim(new.payment_destination), '') is not null then
    insert into public.finance_supplier_private as sp (supplier_id, tax_id, bank_details, payment_destination, updated_at, updated_by)
    values (new.id, nullif(btrim(new.tax_id), ''), nullif(btrim(new.bank_details), ''), nullif(btrim(new.payment_destination), ''), now(),
            (select id from public.users where id = auth.uid()))
    on conflict (supplier_id) do update
       set tax_id = coalesce(excluded.tax_id, sp.tax_id),
           bank_details = coalesce(excluded.bank_details, sp.bank_details),
           payment_destination = coalesce(excluded.payment_destination, sp.payment_destination),
           updated_at = now(), updated_by = excluded.updated_by;
  end if;
  new.tax_id := null; new.bank_details := null; new.payment_destination := null;
  return new;
end;
$$;
drop trigger if exists finance_suppliers_divert_private on public.finance_suppliers;
create trigger finance_suppliers_divert_private before insert or update on public.finance_suppliers
  for each row execute function public.divert_supplier_private();
update public.finance_suppliers set tax_id = null, bank_details = null, payment_destination = null
 where tax_id is not null or bank_details is not null or payment_destination is not null;

-- Set (or clear: pass NULL / '') a supplier's private details. Same write
-- rule as the supplier master: Super Admin or Finance.
create or replace function public.supplier_set_private_details(p_supplier_id uuid, p_tax_id text, p_bank_details text, p_payment_destination text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (public.is_super_admin()
          or exists (select 1 from public.users where id = auth.uid() and is_active and role = 'finance')
          or public.has_section_access('finance')) then
    raise exception 'Finance access is required to change supplier banking and tax details.';
  end if;
  if not exists (select 1 from public.finance_suppliers where id = p_supplier_id) then
    raise exception 'Supplier not found.';
  end if;
  insert into public.finance_supplier_private as sp (supplier_id, tax_id, bank_details, payment_destination, updated_at, updated_by)
  values (p_supplier_id, nullif(btrim(p_tax_id), ''), nullif(btrim(p_bank_details), ''), nullif(btrim(p_payment_destination), ''), now(), auth.uid())
  on conflict (supplier_id) do update
     set tax_id = excluded.tax_id, bank_details = excluded.bank_details, payment_destination = excluded.payment_destination,
         updated_at = now(), updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.supplier_set_private_details(uuid, text, text, text) from public;
grant execute on function public.supplier_set_private_details(uuid, text, text, text) to authenticated;

-- ---------------------------------------- 3. CAT-07 import price preview ---
create or replace function public.catalog_import_pricing(p_business_ids uuid[], p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_super boolean := public.is_super_admin();
  v_own uuid := public.current_business_id();
  v_ids uuid[];
  v_multi boolean;
  b record; r record;
  v_errors text[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_new_addons jsonb; v_exceptions text[]; v_markups int; v_changes int; v_new_prices int;
  v_acq numeric; v_m numeric; v_final numeric; v_pre text;
begin
  if v_uid is null or not exists (select 1 from public.users where id = v_uid and is_active) then
    raise exception 'Authentication required.';
  end if;
  if not (v_super or public.is_business_admin()
          or exists (select 1 from public.users where id = v_uid and role = 'finance')
          or public.has_section_access('finance')) then
    raise exception 'Finance access is required to import catalog prices.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_business_ids, '{}'::uuid[])) as x where x is not null;
  if v_ids is null then
    raise exception 'Choose at least one business to apply the prices to.';
  end if;
  for b in select x as id, bz.code, bz.is_active from unnest(v_ids) as x left join public.businesses bz on bz.id = x loop
    if b.code is null or not b.is_active then
      raise exception 'Prices can only be imported for an active business.';
    end if;
    if not v_super and b.id is distinct from v_own then
      raise exception 'Only the Super Admin can import prices for another business (%). You can import prices for your own business only.', b.code;
    end if;
  end loop;
  v_multi := array_length(v_ids, 1) > 1;

  for b in select id, code, coalesce(nullif(btrim(trade_name), ''), legal_name) as name
             from public.businesses where id = any(v_ids) order by code loop
    v_pre := case when v_multi then b.code || ': ' else '' end;
    -- categories with no active add-on in this business take the file's most
    -- common Add on (ties: the value that appears first in the file)
    with f as (
      select x.category_id, x.addon, count(*) as n, min(x.line) as first_line
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(line int, category_id uuid, addon numeric)
       where x.addon is not null and x.category_id is not null
       group by 1, 2
    ), top as (
      select distinct on (category_id) category_id, addon from f order by category_id, n desc, first_line
    )
    select coalesce(jsonb_agg(jsonb_build_object('category_id', t.category_id, 'category', c.name, 'addon', t.addon) order by c.name), '[]'::jsonb)
      into v_new_addons
      from top t join public.finance_catalog_categories c on c.id = t.category_id
     where not exists (select 1 from public.finance_catalog_category_pricing p
                        where p.business_id = b.id and p.category_id = t.category_id and p.active);

    if p_apply then
      insert into public.finance_catalog_category_pricing as cp (business_id, category_id, addon_percent, active, updated_at, created_by)
      select b.id, (e->>'category_id')::uuid, (e->>'addon')::numeric, true, now(), v_uid
        from jsonb_array_elements(v_new_addons) e
      on conflict (business_id, category_id) do update
         set addon_percent = excluded.addon_percent, active = true, updated_at = now(), created_by = excluded.created_by
       where not cp.active;
    end if;

    v_exceptions := '{}'; v_markups := 0; v_changes := 0; v_new_prices := 0;
    for r in
      select x.line, x.item_id, x.item_name, x.cost, x.addon, x.store, x.markup,
             coalesce((select p.addon_percent from public.finance_catalog_category_pricing p
                        where p.business_id = b.id and p.category_id = x.category_id and p.active),
                      (select (e->>'addon')::numeric from jsonb_array_elements(v_new_addons) e
                        where (e->>'category_id')::uuid = x.category_id),
                      0) as cat_addon
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
             as x(line int, item_id uuid, item_name text, category_id uuid, cost numeric, addon numeric, store numeric, markup numeric)
       order by x.line
    loop
      if r.addon is not null and r.addon <> r.cat_addon then
        v_exceptions := v_exceptions || format('row %s %s (%s%% vs category %s%%)', r.line, r.item_name, r.addon::float8, r.cat_addon::float8);
      end if;
      v_final := r.markup;
      if r.store is not null then
        v_acq := coalesce(r.cost, 0) * (1 + r.cat_addon / 100);
        if v_acq <= 0 then
          v_errors := v_errors || format('%sRow %s: STORE PRICE needs a Supplier Cost above 0.', v_pre, r.line);
          v_final := null;
        else
          v_m := (r.store / v_acq - 1) * 100;
          if v_m < 0 then
            v_errors := v_errors || format('%sRow %s: STORE PRICE ₱%s is below the Acquisition Cost ₱%s.', v_pre, r.line, r.store::float8, to_char(v_acq, 'FM999999999990.00'));
            v_final := null;
          elsif v_m > 1000 then
            v_errors := v_errors || format('%sRow %s: STORE PRICE is more than 11× the Acquisition Cost (markup above 1000%%).', v_pre, r.line);
            v_final := null;
          else
            v_final := round(v_m, 8);
          end if;
        end if;
      elsif v_final is not null and (v_final < 0 or v_final > 1000) then
        v_errors := v_errors || format('%sRow %s: %%Mark up must be between 0%% and 1000%%.', v_pre, r.line);
        v_final := null;
      end if;
      if v_final is not null and r.item_id is null then
        v_new_prices := v_new_prices + 1;
      end if;
      if v_final is not null and r.item_id is not null then
        v_markups := v_markups + 1;
        -- Build 77 (CAT-07 preview): does this row change the business's current price?
        if not exists (select 1 from public.finance_catalog_item_pricing ip
                        where ip.business_id = b.id and ip.item_id = r.item_id and ip.active
                          and ip.markup_percent = round(v_final, 8)) then
          v_changes := v_changes + 1;
        end if;
        if p_apply then
          insert into public.finance_catalog_item_pricing as ip (business_id, item_id, markup_percent, active, updated_at, created_by)
          values (b.id, r.item_id, v_final, true, now(), v_uid)
          on conflict (business_id, item_id) do update
             set markup_percent = excluded.markup_percent, active = true, updated_at = now(), created_by = excluded.created_by;
        end if;
      end if;
    end loop;

    if p_apply then
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (v_uid, 'businesses', b.id, 'catalog_import_pricing',
              jsonb_build_object('business_code', b.code, 'markups', v_markups,
                                 'new_addons', (select coalesce(jsonb_agg(e - 'category_id'), '[]'::jsonb) from jsonb_array_elements(v_new_addons) e)));
    end if;
    v_out := v_out || jsonb_build_object('business_id', b.id, 'code', b.code, 'name', b.name, 'markups', v_markups,
                                         'price_changes', v_changes, 'new_item_prices', v_new_prices,
                                         'new_addons', (select coalesce(jsonb_agg(e - 'category_id'), '[]'::jsonb) from jsonb_array_elements(v_new_addons) e),
                                         'addon_exceptions', to_jsonb(v_exceptions));
  end loop;

  if p_apply and coalesce(array_length(v_errors, 1), 0) > 0 then
    raise exception 'Catalog prices were not imported (% issue(s)): %', array_length(v_errors, 1), array_to_string(v_errors[1:10], ' ');
  end if;
  return jsonb_build_object('errors', to_jsonb(v_errors), 'businesses', v_out);
end;
$$;
revoke all on function public.catalog_import_pricing(uuid[], jsonb, boolean) from public;
grant execute on function public.catalog_import_pricing(uuid[], jsonb, boolean) to authenticated;
