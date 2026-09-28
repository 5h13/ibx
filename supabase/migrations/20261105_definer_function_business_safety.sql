-- ============================================================================
-- Build 53 — SECURITY DEFINER functions: business_id and ownership safety.
--
-- A001 gave 91 business-scoped tables a *transitional* column default of
-- the ISHABELLA business id ("remove once every app write path sets
-- business_id explicitly"). RLS's WITH CHECK catches that default for
-- ordinary session-client inserts, but SECURITY DEFINER functions bypass
-- RLS — so every definer function that inserts without naming business_id
-- silently files the row under Ishabella, whichever business did the work.
-- Build 53's audit found ten such functions (a catalog query over
-- pg_proc, not a guess). It also found definer functions callable by any
-- authenticated user that act on a record by id with no ownership check
-- (the same class 20261102 fixed for stock posting/PO issuance), and one
-- that has thrown on every call since Build 47 made months/financial_summary
-- unique per business.
--
-- Fixed here (each function re-created from its CURRENT definition, only
-- the business handling changed):
--   post_receipt_to_stock        business_id from the receipt; also restores
--                                lot_number propagation that 20261003 added
--                                and the 20261102 rewrite dropped (LOG-23)
--   post_transfer_to_stock       business_id from the transfer
--   create_sales_revenue_draft   ownership check on the order; AR/revenue
--                                accounts looked up in the ORDER's business
--                                (was: any business's 1100/4000); business_id
--                                on all five inserts
--   post_finance_journal         ownership check; accounting-period lookup
--                                scoped to the journal's business
--   refresh_financial_summary_from_ledger
--                                new (date, business) form; old (date) form
--                                kept as a wrapper. Was: ON CONFLICT (year,
--                                month) — no such constraint since Build 47,
--                                so journal posting threw whenever the month
--                                existed — and it summed EVERY business's
--                                journals into one row
--   refresh_sales_monthly_revenue_summary,
--   refresh_sales_commission_monthly_summary
--                                (the revenue one also had an ambiguous
--                                `status` reference and had never run)
--                                computed per business (caller's own, or
--                                every business for the Global Super Admin);
--                                their unique keys gain business_id
--   record_integration_event     business_id from the source record when
--                                resolvable, else the caller's business
--   snapshot_catalog_*_pricing   business_id from the pricing rule row
--   get_catalog_sales_price      pricing rules/discounts read from the
--                                pricing business only (was: any business's)
--
-- Deliberately NOT changed: the recalculate_* helpers and the marketing /
-- opportunity refreshers. They only recompute a derived total on one row
-- from that row's own child rows, so a cross-business call cannot alter a
-- value; several are also called from trigger/definer contexts where an
-- added ownership check would break legitimate flows.
-- ============================================================================

-- ---------------------------------------------------------------- stock ---
create or replace function public.post_receipt_to_stock(p_receipt_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare r record; l record;
begin
  select * into r from public.logistics_receipts where id=p_receipt_id for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if not public.is_super_admin() and r.business_id is distinct from public.current_business_id() then
    raise exception 'Receipt does not belong to your business.';
  end if;
  if r.status='posted' then return; end if;
  if r.status <> 'approved' then raise exception 'Receipt must be approved before posting.'; end if;

  for l in select * from public.logistics_receipt_items where receipt_id=r.id loop
    insert into public.logistics_stock_movements(
      business_id, inventory_item_id, location_id, movement_date, movement_type, quantity,
      unit_cost, source_table, source_record_id, reference_number, notes, created_by, lot_number
    ) values (
      r.business_id, l.inventory_item_id, r.location_id, r.receipt_date, 'receipt', l.quantity,
      l.unit_cost, 'logistics_receipts', r.id, r.receipt_number, l.description, p_actor, l.lot_number
    ) on conflict (source_table, source_record_id, inventory_item_id, location_id, movement_type)
      where source_table is not null and source_record_id is not null do nothing;
  end loop;

  update public.logistics_receipts set status='posted', posted_at=now(), updated_at=now()
   where id=r.id and status='approved';
end $function$;

create or replace function public.post_transfer_to_stock(p_transfer_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t record; l record; v_balance numeric;
begin
  select * into t from public.logistics_stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer not found.'; end if;
  if not public.is_super_admin() and t.business_id is distinct from public.current_business_id() then
    raise exception 'Transfer does not belong to your business.';
  end if;
  if t.status='posted' then return; end if;
  if t.status <> 'approved' then raise exception 'Transfer must be approved before posting.'; end if;

  for l in select * from public.logistics_stock_transfer_items where transfer_id=t.id loop
    select coalesce(sum(case when sm.location_id=t.from_location_id and sm.movement_type in ('receipt','transfer_in','adjustment') then sm.quantity
                             when sm.location_id=t.from_location_id and sm.movement_type in ('issue','transfer_out') then -sm.quantity else 0 end),0)
      into v_balance
    from public.logistics_stock_movements sm
    where sm.inventory_item_id=l.inventory_item_id and sm.business_id=t.business_id;
    if v_balance < l.quantity then
      raise exception 'Insufficient available stock for transfer item % (requested %, available %).', l.inventory_item_id, l.quantity, v_balance;
    end if;

    insert into public.logistics_stock_movements(business_id,inventory_item_id,location_id,movement_date,movement_type,quantity,unit_cost,source_table,source_record_id,reference_number,notes,created_by)
    values(t.business_id,l.inventory_item_id,t.from_location_id,t.transfer_date,'transfer_out',l.quantity,0,'logistics_stock_transfers',t.id,t.transfer_number,l.notes,p_actor)
    on conflict (source_table, source_record_id, inventory_item_id, location_id, movement_type) where source_table is not null and source_record_id is not null do nothing;
    insert into public.logistics_stock_movements(business_id,inventory_item_id,location_id,movement_date,movement_type,quantity,unit_cost,source_table,source_record_id,reference_number,notes,created_by)
    values(t.business_id,l.inventory_item_id,t.to_location_id,t.transfer_date,'transfer_in',l.quantity,0,'logistics_stock_transfers',t.id,t.transfer_number,l.notes,p_actor)
    on conflict (source_table, source_record_id, inventory_item_id, location_id, movement_type) where source_table is not null and source_record_id is not null do nothing;
  end loop;

  update public.logistics_stock_transfers set status='posted', posted_at=now(), updated_at=now() where id=t.id and status='approved';
end $function$;

-- ---------------------------------------------------------------- sales ---
create or replace function public.create_sales_revenue_draft(p_order_id uuid, p_delivery_id uuid, p_actor uuid, p_recognition_number text, p_invoice_number text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare o public.sales_orders%rowtype; inv uuid; rr uuid; je uuid; revenue numeric(14,2); ar_account uuid; revenue_account uuid; section_id uuid; ddate date;
begin
  select * into o from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if not public.is_super_admin() and o.business_id is distinct from public.current_business_id() then
    raise exception 'Sales order does not belong to your business.';
  end if;
  if o.status not in ('processing','fulfilled') then raise exception 'Sales order must be in processing or fulfilled status'; end if;
  select id into section_id from public.sections where code='sales' limit 1;
  select id into ar_account from public.finance_chart_of_accounts where account_code='1100' and business_id=o.business_id limit 1;
  select id into revenue_account from public.finance_chart_of_accounts where account_code='4000' and business_id=o.business_id limit 1;
  if ar_account is null or revenue_account is null then raise exception 'Required AR (1100) / revenue (4000) accounts are missing from this business''s chart of accounts'; end if;
  revenue := o.total_amount;
  ddate := coalesce((select delivery_date from public.logistics_delivery_orders where id=p_delivery_id and business_id=o.business_id), o.order_date);
  if exists(select 1 from public.sales_revenue_recognitions where sales_order_id=o.id) then raise exception 'Revenue recognition already exists for this order'; end if;
  insert into public.finance_customer_invoices(business_id,invoice_number,customer_id,invoice_date,due_date,currency,subtotal,discount_amount,tax_amount,other_charges,status,created_by,notes)
  values(o.business_id,p_invoice_number,o.customer_id,ddate,ddate + 30,o.currency,o.subtotal,o.discount_amount,o.tax_amount,o.other_charges,'draft',p_actor,'Generated from sales order '||o.order_number)
  returning id into inv;
  insert into public.finance_customer_invoice_items(business_id,invoice_id,description,quantity,unit,unit_price,notes)
  select o.business_id,inv,description,quantity,unit,unit_price,notes from public.sales_order_items where order_id=o.id;
  insert into public.finance_journal_entries(business_id,journal_number,entry_date,description,source_module,source_record_id,section_id,status,total_debit,total_credit,created_by,notes)
  values(o.business_id,'JE-SALES-'||replace(p_recognition_number,'REC-',''),ddate,'Revenue recognition - '||o.order_number,'sales_revenue',o.id,section_id,'draft',revenue,revenue,p_actor,'Draft accounting entry generated with AR invoice')
  returning id into je;
  insert into public.finance_journal_lines(business_id,journal_entry_id,account_id,line_description,debit,credit,department)
  values(o.business_id,je,ar_account,'Accounts receivable - '||o.order_number,revenue,0,'Sales'),(o.business_id,je,revenue_account,'Sales revenue - '||o.order_number,0,revenue,'Sales');
  insert into public.sales_revenue_recognitions(business_id,recognition_number,sales_order_id,delivery_order_id,customer_id,ar_invoice_id,journal_entry_id,recognition_date,revenue_amount,status,created_by)
  values(o.business_id,p_recognition_number,o.id,p_delivery_id,o.customer_id,inv,je,ddate,revenue,'draft',p_actor)
  returning id into rr;
  perform public.recalculate_finance_journal_totals(je);
  if p_delivery_id is not null then update public.sales_orders set status='fulfilled',fulfilled_at=coalesce(fulfilled_at,now()),updated_at=now() where id=o.id; end if;
  return rr;
end; $function$;

-- Businesses a summary refresh should (re)compute for: the caller's own, or
-- every business for the Global Super Admin.
create or replace function public.refresh_scope_business_ids()
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.businesses where public.is_super_admin() or id = public.current_business_id();
$$;
revoke all on function public.refresh_scope_business_ids() from public;
grant execute on function public.refresh_scope_business_ids() to authenticated;

alter table public.sales_monthly_revenue_summary drop constraint if exists sales_monthly_revenue_summary_section_id_year_month_key;
alter table public.sales_monthly_revenue_summary drop constraint if exists sales_monthly_revenue_summary_business_section_year_month_key;
alter table public.sales_monthly_revenue_summary add constraint sales_monthly_revenue_summary_business_section_year_month_key unique (business_id, section_id, year, month);

alter table public.sales_commission_monthly_summary drop constraint if exists sales_commission_monthly_summ_section_id_employee_id_year_m_key;
alter table public.sales_commission_monthly_summary drop constraint if exists sales_commission_monthly_summary_business_key;
alter table public.sales_commission_monthly_summary add constraint sales_commission_monthly_summary_business_key unique (business_id, section_id, employee_id, year, month);

create or replace function public.refresh_sales_monthly_revenue_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_section uuid; v_start date; v_end date; v_orders integer; v_revenue numeric(14,2); v_ar numeric(14,2); v_cash numeric(14,2); v_comm numeric(14,2); v_comm_approved numeric(14,2); b uuid;
begin
  select id into v_section from public.sections where code='sales' limit 1;
  if v_section is null then return; end if;
  v_start := make_date(p_year,p_month,1);
  v_end := (v_start + interval '1 month')::date;
  for b in select public.refresh_scope_business_ids() loop
    select count(*), coalesce(sum(total_amount),0) into v_orders,v_revenue
      from public.sales_orders where business_id=b and order_date >= v_start and order_date < v_end and status='fulfilled';
    select coalesce(sum(inv.total_amount),0), coalesce(sum(inv.amount_received),0) into v_ar,v_cash
      from public.sales_revenue_recognitions rr join public.finance_customer_invoices inv on inv.id=rr.ar_invoice_id
      where rr.business_id=b and rr.recognition_date >= v_start and rr.recognition_date < v_end and inv.status <> 'voided';
    -- sc.status qualified: the original unqualified `status` was ambiguous
    -- with sales_orders.status, so this function had never run successfully.
    select coalesce(sum(sc.commission_amount),0), coalesce(sum(sc.commission_amount) filter(where sc.status in ('approved','paid')),0) into v_comm,v_comm_approved
      from public.sales_commissions sc join public.sales_orders so on so.id=sc.sales_order_id
      where so.business_id=b and so.order_date >= v_start and so.order_date < v_end;
    insert into public.sales_monthly_revenue_summary(business_id,section_id,year,month,fulfilled_orders,gross_revenue,ar_invoiced,cash_collected,commission_accrued,commission_approved,updated_at)
    values(b,v_section,p_year,p_month,v_orders,v_revenue,v_ar,v_cash,v_comm,v_comm_approved,now())
    on conflict(business_id,section_id,year,month) do update set
      fulfilled_orders=excluded.fulfilled_orders,gross_revenue=excluded.gross_revenue,ar_invoiced=excluded.ar_invoiced,
      cash_collected=excluded.cash_collected,commission_accrued=excluded.commission_accrued,commission_approved=excluded.commission_approved,updated_at=now();
  end loop;
end; $function$;

create or replace function public.refresh_sales_commission_monthly_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_section uuid; v_start date; v_end date; b uuid;
begin
  select id into v_section from public.sections where code='sales' limit 1;
  if v_section is null then return; end if;
  v_start := make_date(p_year,p_month,1);
  v_end := (v_start + interval '1 month')::date;
  for b in select public.refresh_scope_business_ids() loop
    delete from public.sales_commission_monthly_summary where business_id=b and section_id=v_section and year=p_year and month=p_month;
    insert into public.sales_commission_monthly_summary(business_id,section_id,employee_id,year,month,commission_count,accrued,prepared,reviewed,approved,paid,open_amount,updated_at)
    select b, v_section, sc.employee_id, p_year, p_month, count(*),
      coalesce(sum(sc.commission_amount),0),
      coalesce(sum(sc.commission_amount) filter(where sc.status in ('prepared','reviewed','approved','paid')),0),
      coalesce(sum(sc.commission_amount) filter(where sc.status in ('reviewed','approved','paid')),0),
      coalesce(sum(sc.commission_amount) filter(where sc.status in ('approved','paid')),0),
      coalesce(sum(sc.commission_amount) filter(where sc.status='paid'),0),
      coalesce(sum(sc.commission_amount) filter(where sc.status not in ('paid','cancelled')),0), now()
    from public.sales_commissions sc
    join public.sales_orders so on so.id=sc.sales_order_id
    where so.business_id=b and so.order_date >= v_start and so.order_date < v_end
    group by sc.employee_id;
  end loop;
end; $function$;

-- ------------------------------------------------------------- finance ---
create or replace function public.refresh_financial_summary_from_ledger(p_entry_date date, p_business_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare mid uuid; y int:=extract(year from p_entry_date)::int; m int:=extract(month from p_entry_date)::int;
begin
  if p_business_id is null then return; end if;
  if not public.is_super_admin() and p_business_id is distinct from public.current_business_id() then
    raise exception 'Cannot refresh another business''s financial summary.';
  end if;
  -- Same semantics as before: only refresh a period row that already exists
  -- (months creation stays with getCurrentMonthId()/Super Admin).
  select id into mid from public.months where business_id=p_business_id and year=y and month=m;
  if mid is null then return; end if;
  -- financial_summary is unique on (business_id, section_id, month_id) but the
  -- company-wide row has section_id NULL, and NULLs never conflict — so an
  -- ON CONFLICT upsert would add a duplicate row on every refresh. Replace it.
  delete from public.financial_summary where business_id=p_business_id and section_id is null and month_id=mid;
  insert into public.financial_summary(business_id,section_id,month_id,total_sales,total_expenses,bottomline,total_commission,computed_at)
  select p_business_id,null,mid,
    coalesce(sum(case when coa.account_type='revenue' then jl.credit-jl.debit else 0 end),0),
    coalesce(sum(case when coa.account_type='expense' then jl.debit-jl.credit else 0 end),0),
    coalesce(sum(case when coa.account_type='revenue' then jl.credit-jl.debit when coa.account_type='expense' then -(jl.debit-jl.credit) else 0 end),0),
    0,now()
  from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id=je.id join public.finance_chart_of_accounts coa on coa.id=jl.account_id
  where je.business_id=p_business_id and je.status='posted' and extract(year from je.entry_date)=y and extract(month from je.entry_date)=m;
end; $function$;
revoke all on function public.refresh_financial_summary_from_ledger(date, uuid) from public;
grant execute on function public.refresh_financial_summary_from_ledger(date, uuid) to authenticated;

-- Old signature kept for any existing caller; scoped to the caller's business.
create or replace function public.refresh_financial_summary_from_ledger(p_entry_date date)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public.refresh_financial_summary_from_ledger(p_entry_date, public.current_business_id());
end; $function$;

create or replace function public.post_finance_journal(p_journal_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare j public.finance_journal_entries%rowtype; period_status text; d numeric(14,2); c numeric(14,2);
begin
  select * into j from public.finance_journal_entries where id=p_journal_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if not public.is_super_admin() and j.business_id is distinct from public.current_business_id() then
    raise exception 'Journal entry does not belong to your business.';
  end if;
  if j.status <> 'approved' then raise exception 'Only approved journal entries can be posted'; end if;
  select status into period_status from public.finance_accounting_periods
   where business_id=j.business_id and year=extract(year from j.entry_date)::int and month=extract(month from j.entry_date)::int;
  if period_status='closed' then raise exception 'Accounting period is closed'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d,c from public.finance_journal_lines where journal_entry_id=j.id;
  if d <= 0 or d <> c then raise exception 'Journal entry must be balanced and greater than zero'; end if;
  update public.finance_journal_entries set status='posted',posted_by=p_actor,posted_at=now(),total_debit=d,total_credit=c,updated_at=now() where id=j.id;
  perform public.refresh_financial_summary_from_ledger(j.entry_date, j.business_id);
end; $function$;

-- --------------------------------------------------------- integration ---
create or replace function public.record_integration_event(p_source_module text, p_target_module text, p_event_type text, p_source_table text default null, p_source_record_id uuid default null, p_status text default 'completed', p_message text default null, p_payload jsonb default null, p_actor_id uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; v_biz uuid;
begin
  -- The event belongs to the business of the record it is about, when that
  -- record's table carries business_id; otherwise the caller's business.
  if p_source_table is not null and p_source_record_id is not null and exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name=p_source_table and column_name='business_id') then
    execute format('select business_id from public.%I where id = $1', p_source_table) into v_biz using p_source_record_id;
  end if;
  v_biz := coalesce(v_biz, public.current_business_id());
  if v_biz is null then
    raise exception 'Cannot determine the business for this integration event.';
  end if;
  insert into public.integration_events(
    business_id,source_module,target_module,event_type,source_table,source_record_id,
    status,message,payload,actor_id,completed_at
  ) values (
    v_biz,p_source_module,p_target_module,p_event_type,p_source_table,p_source_record_id,
    p_status,p_message,p_payload,p_actor_id,
    case when p_status in ('completed','skipped') then now() else null end
  ) returning id into v_id;
  return v_id;
end;
$function$;

-- ------------------------------------------------------------- catalog ---
create or replace function public.snapshot_catalog_category_pricing()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if (tg_op='UPDATE' and (new.addon_percent is distinct from old.addon_percent or new.active is distinct from old.active)) or tg_op='INSERT' then
    insert into public.finance_catalog_pricing_history(business_id,rule_type,rule_id,category_id,value_percent,effective_from,captured_by)
    values(new.business_id,'category_addon',new.id,new.category_id,new.addon_percent,new.effective_from,new.created_by);
  end if;
  return new;
end; $function$;

create or replace function public.snapshot_catalog_item_pricing()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if (tg_op='UPDATE' and (new.markup_percent is distinct from old.markup_percent or new.active is distinct from old.active)) or tg_op='INSERT' then
    insert into public.finance_catalog_pricing_history(business_id,rule_type,rule_id,item_id,value_percent,effective_from,captured_by)
    values(new.business_id,'item_markup',new.id,new.item_id,new.markup_percent,new.effective_from,new.created_by);
  end if;
  return new;
end; $function$;

create or replace function public.snapshot_catalog_customer_discount()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if (tg_op='UPDATE' and (new.discount_percent is distinct from old.discount_percent or new.active is distinct from old.active)) or tg_op='INSERT' then
    insert into public.finance_catalog_pricing_history(business_id,rule_type,rule_id,item_id,customer_id,value_percent,effective_from,captured_by)
    values(new.business_id,'customer_discount',new.id,new.item_id,new.customer_id,new.discount_percent,new.effective_from,new.created_by);
  end if;
  return new;
end; $function$;

-- Pricing rules (category add-on, item markup, customer discount) are
-- business-scoped; the catalog item itself is the global master. The
-- pricing business is the caller's own, or — for the Global Super Admin,
-- who has none — the customer's business when a customer is given.
create or replace function public.get_catalog_sales_price(p_item_id uuid, p_customer_id uuid default null, p_supplier_cost numeric default null)
returns table(item_type text, supplier_cost numeric, service_cost_basis numeric, category_addon_percent numeric, acquisition_cost numeric, item_markup_percent numeric, srp numeric, customer_discount_percent numeric, customer_price numeric)
language sql stable security definer set search_path to 'public' as $function$
  with biz as (
    select coalesce(public.current_business_id(),
                    (select fc.business_id from public.finance_customers fc where fc.id = p_customer_id)) as id
  ), base as (
    select i.item_type,
           case when i.item_type='service' then 0::numeric else coalesce(p_supplier_cost,i.standard_cost,0)::numeric end as product_cost,
           case when i.item_type='service' then coalesce(i.service_cost_basis,0)::numeric else 0::numeric end as service_basis,
           coalesce((select cp.addon_percent from public.finance_catalog_category_pricing cp
                      join public.finance_catalog_categories c on c.id=cp.category_id
                     where lower(trim(c.name))=lower(trim(i.category)) and cp.active
                       and cp.business_id = (select id from biz) limit 1),0)::numeric as addon,
           coalesce((select ip.markup_percent from public.finance_catalog_item_pricing ip
                     where ip.item_id=i.id and ip.active and ip.business_id = (select id from biz) limit 1),0)::numeric as markup
    from public.finance_procurement_items i
    where i.id=p_item_id
  ), priced as (
    select *,
      case when item_type='service' then null::numeric else product_cost*(1+addon/100) end as acq,
      case when item_type='service' then service_basis*(1+addon/100) else product_cost*(1+addon/100) end as pricing_base
    from base
  ), final as (
    select p.*, p.pricing_base*(1+p.markup/100) as sell,
      coalesce((select d.discount_percent from public.finance_catalog_customer_discounts d
                 where d.customer_id=p_customer_id and d.item_id=p_item_id and d.active
                   and d.business_id = (select id from biz) limit 1),0)::numeric as discount
    from priced p
  )
  select item_type, product_cost, service_basis, addon, acq, markup, sell, discount, sell*(1-discount/100)
  from final;
$function$;
