-- ============================================================================
-- Build 74 — Storefront: everything decided in the audit (user, 2026-09-28)
--   SF-04  Cash tendered and change (recorded, not printed on the DR).
--   SF-14  Price floor: an item with no cost needs an approver; selling at the
--          store price is always allowed.
--   SF-15  Returned lines are marked Back to stock / Damaged / Wrong item;
--          damaged goods are kept aside (not sellable), at cost in 1210.
--   SF-17  Late encoding (a sale dated before today) and cancellation of a
--          completed sale both need an approver.
--   SF-18  Storefront numbers run per store with the store code
--          (PILI-SF-2026-000001, PILI-DR-…, PILI-SFP-…).
--   SF-19  Returns found by sale, DR or SI number.
--   SF-20  Finance can open the Storefront read-only.
--   SF-23  Counter cost of sales at the weighted average cost (Build 74 d),
--          falling back to the pricing cost.
--   SF-27  Customer checks (post-dated included) from anyone, no approver:
--          Checks on hand → deposited → cleared, or bounced (back to AR).
--   SF-01  DRs from approved sales orders at the Storefront: order prices,
--          partial deliveries (supplier lines after the PO is received),
--          COD or credit tracked in AR, warehouse release moves the stock,
--          order completion monitor.
--   SF-03d VAT on quotations is optional; the order follows its quotation.
-- ============================================================================

-- ------------------------------------------------------------------ schema --
alter table public.storefront_payments drop constraint if exists storefront_payments_method_check;
alter table public.storefront_payments add constraint storefront_payments_method_check
  check (method in ('cash','gcash','maya','card','bank_transfer','check'));
alter table public.finance_bank_accounts drop constraint if exists finance_bank_accounts_payment_method_check;
alter table public.finance_bank_accounts add constraint finance_bank_accounts_payment_method_check
  check (payment_method in ('cash','gcash','maya','card','bank_transfer','check'));
alter table public.storefront_payments
  add column if not exists tendered numeric(14,2),
  add column if not exists change_given numeric(14,2);

alter table public.storefront_sales
  add column if not exists approval_reasons text[] not null default '{}',
  add column if not exists late_entry boolean not null default false,
  add column if not exists late_reason text,
  add column if not exists sales_order_id uuid references public.sales_orders(id),
  add column if not exists release_status text check (release_status in ('awaiting_release','released')),
  add column if not exists released_by uuid references public.users(id),
  add column if not exists released_at timestamptz,
  add column if not exists cancel_status text check (cancel_status in ('requested','approved','rejected')),
  add column if not exists cancel_reason text,
  add column if not exists cancel_requested_by uuid references public.users(id),
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_decided_by uuid references public.users(id),
  add column if not exists cancel_decided_at timestamptz,
  add column if not exists cancel_note text,
  add column if not exists cancel_return_id uuid references public.storefront_returns(id);
create index if not exists storefront_sales_order on public.storefront_sales (sales_order_id) where sales_order_id is not null;

alter table public.storefront_sale_items
  add column if not exists sales_order_item_id uuid references public.sales_order_items(id),
  add column if not exists unit_cost numeric(14,4);
alter table public.storefront_sale_items alter column item_id drop not null;   -- custom order lines (no catalog item)
create index if not exists storefront_sale_items_order_item on public.storefront_sale_items (sales_order_item_id) where sales_order_item_id is not null;

alter table public.storefront_return_items
  add column if not exists condition text not null default 'back_to_stock' check (condition in ('back_to_stock','damaged','wrong_item'));
alter table public.storefront_returns
  add column if not exists damaged_cost numeric(14,2) not null default 0;

alter table public.sales_quotations
  add column if not exists vat_applied boolean not null default false,
  add column if not exists vat_amount numeric(14,2) not null default 0;
alter table public.sales_orders
  add column if not exists vat_applied boolean not null default false,
  add column if not exists vat_amount numeric(14,2) not null default 0,
  add column if not exists payment_terms text;

-- accounts: Checks on hand and Damaged goods held
insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
select b.id, a.code, a.name, 'asset'::public.finance_account_type, a.descr
  from public.businesses b
 cross join (values ('1040','Checks on Hand','Customer checks received and not yet deposited (post-dated included)'),
                    ('1210','Damaged Goods Held','Returned damaged goods kept aside, not sellable (for supplier return or write-off)')) a(code, name, descr)
 where not exists (select 1 from public.finance_chart_of_accounts c where c.business_id = b.id and c.account_code = a.code);
insert into public.finance_bank_accounts(business_id, account_code, account_name, account_type, payment_method, gl_account_id, notes)
select b.id, 'SF-CHECK', 'Checks on hand', 'clearing', 'check', public.sf_gl(b.id, '1040'), 'Customer checks received at the counter until deposited'
  from public.businesses b
 where not exists (select 1 from public.finance_bank_accounts x where x.business_id = b.id and x.account_code = 'SF-CHECK');

create or replace function public.sf_default_gl(p_business uuid, p_method text)
returns uuid language sql stable security definer set search_path = public as $$
  select public.sf_gl(p_business, case p_method when 'cash' then '1000' when 'gcash' then '1020' when 'maya' then '1020' when 'card' then '1030'
                                               when 'check' then '1040' else '1010' end);
$$;
revoke all on function public.sf_default_gl(uuid, text) from public, authenticated;

-- customer checks
create table if not exists public.storefront_checks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  payment_id uuid not null unique references public.storefront_payments(id),
  customer_id uuid references public.finance_customers(id),
  issuer_name text,
  bank_name text not null,
  check_number text not null,
  check_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'on_hand' check (status in ('on_hand','deposited','cleared','bounced')),
  deposited_to uuid references public.finance_bank_accounts(id),
  deposited_on date,
  deposit_journal_id uuid references public.finance_journal_entries(id),
  cleared_on date,
  bounced_on date,
  bounce_reason text,
  bounce_invoice_id uuid references public.finance_customer_invoices(id),
  bounce_journal_id uuid references public.finance_journal_entries(id),
  reminded_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
create index if not exists storefront_checks_business_status on public.storefront_checks (business_id, status, check_date);
alter table public.storefront_checks enable row level security;
drop policy if exists storefront_checks_business_isolation on public.storefront_checks;
create policy storefront_checks_business_isolation on public.storefront_checks as restrictive for all
  using (public.business_row_visible(business_id)) with check (public.business_row_visible(business_id));
drop policy if exists storefront_checks_read on public.storefront_checks;
create policy storefront_checks_read on public.storefront_checks for select using (public.can_view_storefront());
grant select on public.storefront_checks to authenticated;

-- ------------------------------------------------------------------ SF-18 --
-- Storefront documents are numbered per store with the store code; other
-- callers (journals, orders …) pass their own prefix as before.
create or replace function public.storefront_next_number(p_prefix text, p_table text, p_column text)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint; yr text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYY'); v_prefix text := p_prefix; v_code text;
begin
  if p_table in ('storefront_sales','storefront_payments','storefront_returns','storefront_closings','storefront_cash_movements') then
    select code into v_code from public.businesses where id = public.pricing_business_id();
    if v_code is null then raise exception 'Select a business in "Acting as" first.'; end if;
    v_prefix := v_code || '-' || p_prefix;
  end if;
  perform pg_advisory_xact_lock(hashtext(v_prefix || ':' || yr));
  execute format('select coalesce(max(substring(%I from %s)::bigint), 0) + 1 from public.%I where %I ~ %L',
                 p_column, length(v_prefix) + 7, p_table, p_column, '^' || v_prefix || '-' || yr || '-[0-9]{6,}$')
     into n;
  return v_prefix || '-' || yr || '-' || lpad(n::text, 6, '0');
end $$;
revoke all on function public.storefront_next_number(text, text, text) from public, authenticated;

-- ------------------------------------------------------------------ SF-14 --
-- The floor is 7% over cost, but never above the store's own price (a sale
-- at the store price is always allowed). An item with no cost on record
-- (acquisition cost 0) needs an approver — checked in storefront_submit_sale.
create or replace function public.storefront_item_price(p_item uuid, p_business uuid)
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, acquisition_cost numeric, floor_price numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.item_code, i.item_name, i.unit, i.item_type, x.list, x.acq, least(round(x.acq * 1.07, 2), x.list)
    from public.finance_procurement_items i
    cross join lateral (select case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end::numeric as base) b
    left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = p_business
    left join public.finance_catalog_item_pricing ip on ip.item_id = i.id and ip.active and ip.business_id = p_business
    cross join lateral (select coalesce(b.base, 0) * (1 + coalesce(cp.addon_percent,0)/100) as acq,
                               round(coalesce(b.base, 0) * (1 + coalesce(cp.addon_percent,0)/100) * (1 + coalesce(ip.markup_percent,0)/100), 2) as list) x
   where i.id = p_item and i.active;
$$;
revoke all on function public.storefront_item_price(uuid, uuid) from public, authenticated;

drop function if exists public.storefront_price_lines(uuid[]);
create or replace function public.storefront_price_lines(p_items uuid[])
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, floor_price numeric, on_hand numeric, no_cost boolean)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); loc uuid;
begin
  select location_id into loc from public.storefront_settings where business_id = b;
  return query
  select p.item_id, p.item_code, p.item_name, p.unit, p.item_type, p.list_price, p.floor_price,
         case when p.item_type = 'service' then null else coalesce((
           select sum(bal.on_hand) from public.logistics_inventory_items inv
             join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id and bal.location_id = loc
            where inv.business_id = b and inv.procurement_item_id = p.item_id), 0) end,
         coalesce(p.acquisition_cost, 0) <= 0
    from unnest(p_items) x(id) cross join lateral public.storefront_item_price(x.id, b) p;
end $$;
grant execute on function public.storefront_price_lines(uuid[]) to authenticated;

-- ------------------------------------------------------- helper: journals --
-- A prepared journal (for Finance to approve and post) from {account_id: signed amount}.
create or replace function public.sf_make_journal(p_business uuid, p_date date, p_description text, p_source uuid, gl jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d numeric; cr numeric; v_je uuid; v_jno text; v_code text; v_section uuid;
begin
  select coalesce(sum(greatest(value::numeric, 0)), 0), coalesce(sum(greatest(-value::numeric, 0)), 0) into d, cr
    from jsonb_each_text(gl) where round(value::numeric, 2) <> 0;
  if round(d, 2) <> round(cr, 2) then raise exception 'Journal "%" does not balance (debit % / credit %).', p_description, d, cr; end if;
  if d = 0 then return null; end if;
  select code into v_code from public.businesses where id = p_business;
  select id into v_section from public.sections where code = 'sales';
  v_jno := public.storefront_next_number(v_code || '-SFJ', 'finance_journal_entries', 'journal_number');
  insert into public.finance_journal_entries(business_id, journal_number, entry_date, description, source_module, source_record_id, section_id, status,
                                             total_debit, total_credit, prepared_by, prepared_at, created_by, notes)
  values (p_business, v_jno, p_date, p_description, 'storefront', p_source, v_section, 'prepared', round(d, 2), round(cr, 2), auth.uid(), now(), auth.uid(), p_notes)
  returning id into v_je;
  insert into public.finance_journal_lines(business_id, journal_entry_id, account_id, line_description, debit, credit, department)
  select p_business, v_je, key::uuid, coa.account_name || ' — ' || p_description,
         case when round(value::numeric, 2) > 0 then round(value::numeric, 2) else 0 end,
         case when round(value::numeric, 2) < 0 then round(-value::numeric, 2) else 0 end, 'Storefront'
    from jsonb_each_text(gl) join public.finance_chart_of_accounts coa on coa.id = key::uuid
   where round(value::numeric, 2) <> 0;
  return v_je;
end $$;
revoke all on function public.sf_make_journal(uuid, date, text, uuid, jsonb, text) from public, authenticated;

-- A prepared Bank/Cash transaction (+ in / − out) on one account.
create or replace function public.sf_make_cash_txn(p_business uuid, p_account uuid, p_date date, p_amount numeric, p_description text, p_reference text, p_source uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_code text; v_tno text; v uuid;
begin
  if p_account is null or round(coalesce(p_amount, 0), 2) = 0 then return null; end if;
  select code into v_code from public.businesses where id = p_business;
  v_tno := public.storefront_next_number(v_code || '-SFT', 'finance_cash_transactions', 'transaction_number');
  insert into public.finance_cash_transactions(business_id, transaction_number, bank_account_id, transaction_date, transaction_type, amount, direction, description,
                                               reference_number, source_module, source_record_id, status, prepared_by, prepared_at, created_by)
  values (p_business, v_tno, p_account, p_date, case when p_amount > 0 then 'deposit' else 'withdrawal' end::public.cash_transaction_type, abs(round(p_amount, 2)),
          case when p_amount > 0 then 'in' else 'out' end, p_description, p_reference, 'storefront', p_source, 'prepared', auth.uid(), now(), auth.uid())
  returning id into v;
  return v;
end $$;
revoke all on function public.sf_make_cash_txn(uuid, uuid, date, numeric, text, text, uuid) from public, authenticated;

-- A customer record (used when a walk-in's check bounces)
create or replace function public.sf_create_customer(p_business uuid, p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare code text; n int; v uuid;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the name of the check''s issuer.'; end if;
  select id into v from public.finance_customers where business_id = p_business and lower(btrim(legal_name)) = lower(btrim(p_name)) and active limit 1;
  if v is not null then return v; end if;
  select bz.code into code from public.businesses bz where bz.id = p_business;
  perform pg_advisory_xact_lock(hashtext('CUS:' || code));
  select coalesce(max(substring(customer_code from length(code) + 6)::int), 0) + 1 into n
    from public.finance_customers where customer_code ~ ('^CUS-' || code || '-[0-9]+$');
  insert into public.finance_customers(business_id, customer_code, legal_name, phone, active, created_by, notes)
  values (p_business, 'CUS-' || code || '-' || lpad(n::text, 5, '0'), btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), true, auth.uid(), 'Created for a bounced check (Storefront).')
  returning id into v;
  return v;
end $$;
revoke all on function public.sf_create_customer(uuid, text, text) from public, authenticated;

-- ------------------------------------------------ payments: change, checks --
-- p_extra: {tendered, check_bank, check_date, issuer, customer_id}
drop function if exists public.storefront_record_payment(uuid, text, text, numeric, text, uuid, uuid, uuid, text, uuid);
create or replace function public.storefront_record_payment(p_business uuid, p_kind text, p_method text, p_amount numeric, p_reference text,
                                                            p_sale uuid, p_invoice uuid, p_return uuid, p_note text, p_account uuid default null,
                                                            p_extra jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_no text; v_rec uuid; v_id uuid; v_tend numeric; v_cust uuid; v_date date;
begin
  if p_method not in ('cash','gcash','maya','card','bank_transfer','check') then raise exception 'Unknown payment method %.', p_method; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
  if p_kind = 'refund' and p_method = 'check' then raise exception 'Refunds are not given by check: refund in cash or by bank transfer.'; end if;
  if p_method = 'check' and coalesce(btrim(p_reference), '') = '' then raise exception 'Enter the check number.'; end if;
  if p_method not in ('cash','check') and coalesce(btrim(p_reference), '') = '' then raise exception 'Enter the reference number for the % payment.', case p_method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' else 'bank transfer' end; end if;
  -- SF-04: cash tendered and change
  v_tend := nullif(p_extra->>'tendered', '')::numeric;
  if v_tend is not null then
    if p_method <> 'cash' or p_kind = 'refund' then v_tend := null;
    elsif round(v_tend, 2) < round(p_amount, 2) then raise exception 'Cash tendered (₱%) is less than the cash amount applied (₱%).', v_tend, round(p_amount, 2);
    end if;
  end if;
  -- SF-27: check details
  if p_method = 'check' then
    if coalesce(btrim(p_extra->>'check_bank'), '') = '' then raise exception 'Enter the bank of the check.'; end if;
    v_date := nullif(p_extra->>'check_date', '')::date;
    if v_date is null then raise exception 'Enter the date on the check.'; end if;
    if v_date > (now() at time zone 'Asia/Manila')::date + 365 then raise exception 'The check date is more than a year ahead; check the date.'; end if;
  end if;
  v_no := public.storefront_next_number(case when p_kind = 'refund' then 'SFX' else 'SFP' end, 'storefront_payments', 'payment_number');
  insert into public.storefront_payments(business_id, payment_number, kind, sale_id, ar_invoice_id, return_id, method, amount, reference_number, received_by, bank_account_id,
                                         tendered, change_given)
  values (p_business, v_no, p_kind, p_sale, p_invoice, p_return, p_method, round(p_amount, 2), nullif(btrim(p_reference), ''), auth.uid(), p_account,
          round(v_tend, 2), case when v_tend is not null then round(v_tend - p_amount, 2) end)
  returning id into v_id;
  if p_method = 'check' then
    v_cust := coalesce(nullif(p_extra->>'customer_id', '')::uuid,
                       (select customer_id from public.storefront_sales where id = p_sale),
                       (select customer_id from public.finance_customer_invoices where id = p_invoice));
    insert into public.storefront_checks(business_id, payment_id, customer_id, issuer_name, bank_name, check_number, check_date, amount, created_by)
    values (p_business, v_id, v_cust, nullif(btrim(coalesce(p_extra->>'issuer', '')), ''), btrim(p_extra->>'check_bank'), btrim(p_reference), v_date, round(p_amount, 2), auth.uid());
  end if;
  if p_invoice is not null and p_kind <> 'refund' then
    insert into public.finance_customer_receipts(business_id, receipt_number, invoice_id, receipt_date, amount, payment_method, reference_number, notes, status,
                                                 prepared_by, prepared_at, approved_by, approved_at, posted_by, posted_at, created_by)
    values (p_business, v_no, p_invoice, (now() at time zone 'Asia/Manila')::date, round(p_amount, 2), p_method,
            nullif(btrim(p_reference), '') || case when p_method = 'check' then ' (' || btrim(p_extra->>'check_bank') || ', dated ' || v_date || ')' else '' end, p_note,
            'posted', auth.uid(), now(), auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_rec;
    update public.storefront_payments set ar_receipt_id = v_rec where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.storefront_record_payment(uuid, text, text, numeric, text, uuid, uuid, uuid, text, uuid, jsonb) from public, authenticated;

-- the payment guard: labels for checks; a check number counts as its reference
create or replace function public.guard_storefront_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text; v_dup text; v_inv uuid; v_paid numeric; v_refunded numeric; v_label text;
begin
  v_label := case new.method when 'cash' then 'cash' when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' when 'check' then 'check' else 'bank transfer' end;
  if new.kind <> 'refund' and new.method <> 'cash' and nullif(regexp_replace(coalesce(new.reference_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null then
    v_ref := lower(regexp_replace(new.reference_number, '[^A-Za-z0-9]', '', 'g'));
    select payment_number into v_dup from public.storefront_payments
     where business_id = new.business_id and method = new.method and kind <> 'refund'
       and lower(regexp_replace(reference_number, '[^A-Za-z0-9]', '', 'g')) = v_ref limit 1;
    if v_dup is not null then
      if not public.can_approve_storefront() then
        raise exception '% reference % was already used on payment %. Check the reference; if one transfer really covers several payments, ask an approver to record it.', v_label, new.reference_number, v_dup;
      end if;
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'storefront_payments', new.id, 'storefront_reference_reused', jsonb_build_object('method', new.method, 'reference', new.reference_number, 'first_payment', v_dup));
    end if;
  end if;
  if new.kind = 'refund' and new.sale_id is not null then
    select ar_invoice_id into v_inv from public.storefront_sales where id = new.sale_id;
    select coalesce(sum(amount), 0) into v_paid from public.storefront_payments
     where business_id = new.business_id and method = new.method
       and ((kind = 'sale' and sale_id = new.sale_id) or (kind = 'ar_collection' and v_inv is not null and ar_invoice_id = v_inv));
    select coalesce(sum(amount), 0) into v_refunded from public.storefront_payments
     where business_id = new.business_id and method = new.method and kind = 'refund' and sale_id = new.sale_id;
    if v_refunded + new.amount > v_paid then
      if not public.can_approve_storefront() then
        raise exception 'Refund by % (₱%) is more than the customer paid by % on this sale (₱% paid, ₱% already refunded). Refund the way the customer paid, or ask an approver to process this return.',
          v_label, new.amount, v_label, v_paid, v_refunded;
      end if;
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'storefront_payments', new.id, 'storefront_refund_method_override',
              jsonb_build_object('method', new.method, 'amount', new.amount, 'paid_by_method', v_paid, 'already_refunded', v_refunded, 'sale_id', new.sale_id));
    end if;
  end if;
  return new;
end $$;

create or replace function public.storefront_refundable(p_sale uuid)
returns table(method text, paid numeric, refunded numeric, refundable numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v_inv uuid;
begin
  select ar_invoice_id into v_inv from public.storefront_sales where id = p_sale and business_id = b;
  if not found then raise exception 'Sale not found in this store.'; end if;
  return query
  select m.method, coalesce(sum(p.amount) filter (where p.kind <> 'refund'), 0), coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0),
         coalesce(sum(p.amount) filter (where p.kind <> 'refund'), 0) - coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0)
    from (values ('cash'),('gcash'),('maya'),('card'),('bank_transfer'),('check')) m(method)
    left join public.storefront_payments p on p.business_id = b and p.method = m.method
         and ((p.kind = 'sale' and p.sale_id = p_sale) or (p.kind = 'refund' and p.sale_id = p_sale)
              or (p.kind = 'ar_collection' and v_inv is not null and p.ar_invoice_id = v_inv))
   group by m.method
  having coalesce(sum(p.amount), 0) > 0;
end $$;

-- receiving accounts: checks too (Checks on hand accounts)
create or replace function public.storefront_add_receiving_account(p_method text, p_name text, p_number text default null, p_bank text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v uuid; n int; v_code text; v_digits text;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can set up receiving accounts.'; end if;
  if p_method not in ('cash','gcash','maya','card','bank_transfer','check') then raise exception 'Choose the payment method.'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter a name for the account.'; end if;
  v_digits := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
  if p_method in ('gcash','maya') then
    if v_digits !~ '^(09|639)[0-9]{9}$' then raise exception 'Enter the % mobile number (SIM), e.g. 0917 123 4567.', case p_method when 'gcash' then 'GCash' else 'Maya' end; end if;
    if exists (select 1 from public.finance_bank_accounts where business_id = b and payment_method = p_method and regexp_replace(coalesce(mobile_number,''), '[^0-9]', '', 'g') = v_digits) then
      raise exception 'That number is already set up for this store.';
    end if;
  end if;
  if p_method = 'bank_transfer' and v_digits = '' then raise exception 'Enter the bank account number.'; end if;
  select count(*) + 1 into n from public.finance_bank_accounts where business_id = b and account_code like 'SF-%';
  v_code := 'SF-' || upper(p_method) || '-' || n;
  insert into public.finance_bank_accounts(business_id, account_code, account_name, bank_name, account_number_masked, account_type, is_cash_on_hand,
                                           payment_method, mobile_number, gl_account_id, notes, created_by)
  values (b, v_code, btrim(p_name), case when p_method = 'bank_transfer' then nullif(btrim(coalesce(p_bank, '')), '') when p_method in ('gcash','maya') then initcap(p_method) end,
          case when v_digits <> '' then '••••' || right(v_digits, 4) end,
          case p_method when 'cash' then 'cash' when 'card' then 'clearing' when 'check' then 'clearing' when 'bank_transfer' then 'checking' else 'ewallet' end, p_method = 'cash',
          p_method, case when p_method in ('gcash','maya') then v_digits end, public.sf_default_gl(b, p_method), 'Storefront receiving account', auth.uid())
  returning id into v;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_bank_accounts', v, 'storefront_receiving_account_added', jsonb_build_object('method', p_method, 'name', p_name, 'code', v_code));
  return v;
end $$;

create or replace function public.resolve_storefront_payment_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int; v uuid; v_label text;
begin
  v_label := case new.method when 'cash' then 'cash drawer' when 'gcash' then 'GCash number' when 'maya' then 'Maya number' when 'card' then 'card account'
                             when 'check' then 'checks-on-hand account' else 'bank account' end;
  if new.bank_account_id is not null then
    if not exists (select 1 from public.finance_bank_accounts where id = new.bank_account_id and business_id = new.business_id
                    and payment_method = new.method and status = 'active') then
      raise exception 'The chosen % is not an active % account of this store.', v_label, v_label;
    end if;
    return new;
  end if;
  select count(*), min(id::text)::uuid into n, v from public.finance_bank_accounts
   where business_id = new.business_id and payment_method = new.method and status = 'active';
  if n = 1 then new.bank_account_id := v;
  elsif n = 0 then raise exception 'This store has no % set up: a Business Admin adds it in Storefront → Store settings → Receiving accounts.', v_label;
  else raise exception 'Choose which % received / paid this.', v_label;
  end if;
  return new;
end $$;

-- payment objects from the screens: {method, amount, reference, account, tendered, check_bank, check_date, issuer}
create or replace function public.sf_pay_extra(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('tendered', p->'tendered', 'check_bank', p->'check_bank', 'check_date', p->'check_date', 'issuer', p->'issuer'));
$$;

create or replace function public.storefront_collect_ar(p_invoice uuid, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); inv record; p jsonb; v_total numeric := 0;
begin
  select * into inv from public.finance_customer_invoices where id = p_invoice and business_id = b for update;
  if not found then raise exception 'Invoice not found in this business.'; end if;
  if inv.status in ('paid','voided') then raise exception 'Invoice % is already %.', inv.invoice_number, inv.status; end if;
  if inv.status not in ('approved','partially_paid') then raise exception 'Invoice % is not approved yet; Finance must approve it first.', inv.invoice_number; end if;
  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_total := v_total + round(coalesce((p->>'amount')::numeric, 0), 2);
  end loop;
  if v_total <= 0 then raise exception 'Enter the amount received.'; end if;
  if v_total > inv.balance_due then raise exception 'Payment ₱% is more than the invoice balance ₱%. Record only the amount applied; give change for cash.', v_total, inv.balance_due; end if;
  for p in select * from jsonb_array_elements(p_payments) loop
    perform public.storefront_record_payment(b, 'ar_collection', p->>'method', (p->>'amount')::numeric, p->>'reference', null, inv.id, null,
                                             'Received at the counter (Storefront) for invoice ' || inv.invoice_number, nullif(p->>'account', '')::uuid,
                                             public.sf_pay_extra(p) || jsonb_build_object('customer_id', inv.customer_id));
  end loop;
  perform public.recalculate_customer_invoice_received(inv.id);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customer_invoices', inv.id, 'storefront_ar_collected', jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total));
  return jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total, 'balance', inv.balance_due - v_total);
end $$;

-- ------------------------------------------------------------ post a sale --
-- Counter sale: stock leaves the store location now. Order DR (SF-01): the
-- stock leaves when the Warehouse confirms the release; VAT follows the
-- order; every order DR is billed through AR (COD or credit) so its payment
-- status shows on the order. Cost of sales at the weighted average (SF-23).
create or replace function public.storefront_post_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record; l record; p jsonb; v_paid numeric := 0; v_inv uuid; v_code text; v_walk uuid; v_mov uuid; v_inv_item uuid; v_unit numeric;
        v_booklet uuid; v_vat_reg boolean; v_vat numeric := 0; v_cost numeric := 0; o record; v_order boolean; v_order_no text; v_terms text;
begin
  select * into s from public.storefront_sales where id = p_sale for update;
  v_order := s.sales_order_id is not null;
  select code into v_code from public.businesses where id = s.business_id;
  select walk_in_customer_id into v_walk from public.storefront_settings where business_id = s.business_id;
  v_booklet := public.sf_booklet_business(s.business_id);
  select vat_registered into v_vat_reg from public.businesses where id = v_booklet;
  if v_order then select * into o from public.sales_orders where id = s.sales_order_id; v_order_no := o.order_number; v_terms := o.payment_terms; end if;

  -- documents
  p_si := nullif(btrim(coalesce(p_si, '')), '');
  if v_order then p_issue_dr := true; end if;
  if not coalesce(p_issue_dr, false) and p_si is null then raise exception 'Choose at least one document: DR and/or SI (enter the SI booklet number).'; end if;
  if p_si is not null and exists (select 1 from public.storefront_sales where coalesce(si_booklet_business_id, business_id) = v_booklet and id <> s.id
                                    and status <> 'cancelled' and lower(btrim(si_number)) = lower(p_si)) then
    raise exception 'SI number % is already used on this SI booklet.', p_si;
  end if;
  if v_order then
    if p_si is not null and coalesce(v_vat_reg, false) <> o.vat_applied then
      raise exception '%', case when o.vat_applied then 'This order is with VAT: its SI must come from a VAT-registered booklet. Issue the DR only, or change the store''s SI booklet.'
                                else 'This order is without VAT: issue the DR only, or use a non-VAT SI booklet.' end;
    end if;
    if o.vat_applied then v_vat := round(s.total * 12 / 112, 2); end if;
  elsif p_si is not null and coalesce(v_vat_reg, false) then v_vat := round(s.total * 12 / 112, 2);
  end if;

  -- payments (checked again by the payment triggers)
  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce(p->>'method', '') not in ('cash','gcash','maya','card','bank_transfer','check') then raise exception 'Unknown payment method %.', p->>'method'; end if;
    if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
    v_paid := v_paid + round((p->>'amount')::numeric, 2);
  end loop;
  if v_paid > s.total then raise exception 'Payments (₱%) are more than the sale total (₱%). Record only the amount applied: enter the cash tendered and the change is worked out.', v_paid, s.total; end if;
  if s.total - v_paid > 0 and s.customer_id = v_walk then
    raise exception 'A charge or partly paid sale needs a named customer, not Walk-in.';
  end if;

  -- stock and cost
  for l in select * from public.storefront_sale_items where sale_id = s.id loop
    v_inv_item := case when l.item_type <> 'service' and l.item_id is not null then coalesce(l.inventory_item_id, public.ensure_inventory_link(l.item_id, s.business_id)) end;
    v_unit := case when v_inv_item is not null then coalesce(public.inventory_unit_cost(s.business_id, v_inv_item), l.acquisition_cost, 0) else coalesce(l.acquisition_cost, 0) end;
    v_mov := null;
    if v_inv_item is not null and not v_order then
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
      values (s.business_id, v_inv_item, s.location_id, s.sale_date, 'issue', l.quantity, round(v_unit, 4), 'storefront_sales', s.id, s.sale_number, 'Storefront sale', auth.uid())
      returning id into v_mov;
    end if;
    update public.storefront_sale_items set inventory_item_id = v_inv_item, stock_movement_id = v_mov, unit_cost = round(v_unit, 4) where id = l.id;
    if l.item_type <> 'service' then v_cost := v_cost + round(l.quantity * v_unit, 2); end if;
  end loop;

  update public.storefront_sales
     set status = 'completed', si_number = p_si, issue_dr = coalesce(p_issue_dr, false),
         si_booklet_business_id = case when p_si is not null then v_booklet end, vat_applied = v_vat > 0, vat_amount = v_vat, cost_total = v_cost,
         dr_number = case when coalesce(p_issue_dr, false) then public.storefront_next_number('DR', 'storefront_sales', 'dr_number') end,
         release_status = case when v_order then 'awaiting_release' end,
         amount_paid = v_paid, balance = s.total - v_paid, completed_by = auth.uid(), completed_at = now()
   where id = s.id;

  -- AR invoice: charge / partly paid sales, and every order DR
  if s.total - v_paid > 0 or v_order then
    insert into public.finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, discount_amount, amount_received, status, notes, prepared_by, prepared_at, approved_by, approved_at, created_by)
    values (s.business_id, coalesce(v_code || '-SI-' || p_si, s.sale_number), s.customer_id, s.sale_date,
            case when v_order then s.sale_date + public.payment_terms_days(v_terms) end,
            s.total - v_vat, v_vat, 0, v_paid, 'approved',
            'Storefront sale ' || s.sale_number || coalesce(', SI ' || p_si, '') || case when v_order then ', order ' || v_order_no || coalesce(' (' || v_terms || ')', '') else '' end
              || case when v_vat > 0 then ' (VAT-inclusive; VAT ₱' || v_vat || ')' else '' end,
            auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_inv;
    insert into public.finance_customer_invoice_items(business_id, invoice_id, description, quantity, unit, unit_price)
    select s.business_id, v_inv, description, quantity, unit,
           case when v_vat > 0 then round(unit_price * 100 / 112, 2) else unit_price end
      from public.storefront_sale_items where sale_id = s.id;
    update public.storefront_sales set ar_invoice_id = v_inv where id = s.id;
  end if;

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    perform public.storefront_record_payment(s.business_id, 'sale', p->>'method', (p->>'amount')::numeric, p->>'reference', s.id, v_inv, null,
                                             'Paid at the counter, Storefront sale ' || s.sale_number, nullif(p->>'account', '')::uuid, public.sf_pay_extra(p));
  end loop;
  if v_inv is not null then perform public.recalculate_customer_invoice_received(v_inv); end if;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_completed',
          jsonb_build_object('sale_number', s.sale_number, 'total', s.total, 'paid', v_paid, 'ar_invoice_id', v_inv, 'si_number', p_si, 'vat', v_vat, 'order', v_order_no));
end $$;
revoke all on function public.storefront_post_sale(uuid, jsonb, text, boolean) from public, authenticated;

-- ------------------------------------------------ new sale: SF-14 / SF-17 --
-- p = {customer_id, lines:[{item_id, quantity, unit_price}], payments, si_number, issue_dr, notes, sale_date, late_reason}
create or replace function public.storefront_submit_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); st record; v_sale uuid; v_no text; v_customer uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
        l record; pr record; v_sub numeric := 0; v_tot numeric := 0; v_below boolean := false; v_nocost boolean := false; v_status text;
        v_date date; v_reasons text[] := '{}';
begin
  select * into st from public.storefront_settings where business_id = b;
  if st.location_id is null then raise exception 'The Storefront has no stock location yet: a Business Admin sets it in Storefront settings.'; end if;
  v_customer := coalesce(nullif(p->>'customer_id', '')::uuid, public.storefront_walk_in(b));
  if not exists (select 1 from public.finance_customers where id = v_customer and business_id = b and active) then
    raise exception 'Customer not found in this business.';
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  v_date := coalesce(nullif(p->>'sale_date', '')::date, v_today);
  if v_date > v_today then raise exception 'The sale date cannot be in the future.'; end if;
  if v_date < v_today and coalesce(btrim(p->>'late_reason'), '') = '' then raise exception 'Say why this sale is entered late (e.g. system was down, sale made off-site).'; end if;

  v_no := public.storefront_next_number('SF', 'storefront_sales', 'sale_number');
  insert into public.storefront_sales(business_id, sale_number, sale_date, customer_id, location_id, status, notes, created_by, late_entry, late_reason)
  values (b, v_no, v_date, v_customer, st.location_id, 'pending_approval', nullif(btrim(p->>'notes'), ''), auth.uid(), v_date < v_today,
          case when v_date < v_today then btrim(p->>'late_reason') end)
  returning id into v_sale;

  for l in select * from jsonb_to_recordset(p->'lines') as x(item_id uuid, quantity numeric, unit_price numeric) loop
    select * into pr from public.storefront_item_price(l.item_id, b);
    if not found then raise exception 'An item on the sale is not an active catalog item.'; end if;
    if coalesce(l.quantity, 0) <= 0 then raise exception 'Quantity for % must be more than zero.', pr.item_name; end if;
    l.unit_price := round(coalesce(l.unit_price, pr.list_price), 2);
    if l.unit_price < 0 then raise exception 'Price for % cannot be negative.', pr.item_name; end if;
    insert into public.storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, acquisition_cost, floor_price, below_floor, line_total)
    values (b, v_sale, pr.item_id, pr.item_code, pr.item_name, pr.unit, pr.item_type, l.quantity, pr.list_price, l.unit_price, pr.acquisition_cost, pr.floor_price,
            l.unit_price < pr.floor_price or coalesce(pr.acquisition_cost, 0) <= 0, round(l.quantity * l.unit_price, 2));
    v_sub := v_sub + round(l.quantity * pr.list_price, 2);
    v_tot := v_tot + round(l.quantity * l.unit_price, 2);
    v_below := v_below or l.unit_price < pr.floor_price;
    v_nocost := v_nocost or coalesce(pr.acquisition_cost, 0) <= 0;
  end loop;

  if v_below then v_reasons := array_append(v_reasons, 'below_floor'); end if;
  if v_nocost then v_reasons := array_append(v_reasons, 'no_cost'); end if;
  if v_date < v_today then v_reasons := array_append(v_reasons, 'late_entry'); end if;
  update public.storefront_sales set subtotal = v_sub, total = v_tot, discount_total = greatest(v_sub - v_tot, 0), below_floor = v_below or v_nocost,
                                     approval_reasons = v_reasons where id = v_sale;
  if cardinality(v_reasons) > 0 then
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'storefront_sales', v_sale, 'storefront_sale_approval_requested', jsonb_build_object('sale_number', v_no, 'total', v_tot, 'reasons', v_reasons, 'sale_date', v_date));
    v_status := 'pending_approval';
  else
    perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', coalesce((p->>'issue_dr')::boolean, true));
    v_status := 'completed';
  end if;
  return jsonb_build_object('id', v_sale, 'sale_number', v_no, 'status', v_status, 'total', v_tot, 'reasons', v_reasons);
end $$;

create or replace function public.storefront_approve_sale(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver or Business Admin can approve this sale.'; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status <> 'pending_approval' then raise exception 'This sale is not waiting for approval.'; end if;
  if s.created_by = auth.uid() and not public.is_super_admin() then
    raise exception 'You made this sale, so another approver must sign it off.';
  end if;
  update public.storefront_sales set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_approved', jsonb_build_object('sale_number', s.sale_number, 'total', s.total, 'reasons', s.approval_reasons, 'sale_date', s.sale_date));
end $$;

-- ------------------------------------------------------ SF-19 return lookup --
drop function if exists public.storefront_sale_for_return(text);
create or replace function public.storefront_sale_for_return(p_sale_number text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; v_bal numeric := 0; v_key text := upper(btrim(coalesce(p_sale_number, ''))); n int;
begin
  if v_key = '' then raise exception 'Enter the sale, DR or SI number.'; end if;
  select count(*) into n from public.storefront_sales ss
   where ss.business_id = b and (upper(ss.sale_number) = v_key or upper(ss.dr_number) = v_key or upper(btrim(ss.si_number)) = v_key
                                 or upper(btrim(ss.si_number)) = regexp_replace(v_key, '^SI[- ]?', ''));
  if n > 1 then raise exception 'More than one sale matches %; use the sale number.', p_sale_number; end if;
  select ss.*, c.legal_name into s from public.storefront_sales ss join public.finance_customers c on c.id = ss.customer_id
   where ss.business_id = b and (upper(ss.sale_number) = v_key or upper(ss.dr_number) = v_key or upper(btrim(ss.si_number)) = v_key
                                 or upper(btrim(ss.si_number)) = regexp_replace(v_key, '^SI[- ]?', ''));
  if not found then raise exception 'No sale with sale, DR or SI number % in this store.', p_sale_number; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be returned (this one is %).', replace(s.status, '_', ' '); end if;
  if s.ar_invoice_id is not null then select balance_due into v_bal from public.finance_customer_invoices where id = s.ar_invoice_id; end if;
  return jsonb_build_object('id', s.id, 'sale_number', s.sale_number, 'dr_number', s.dr_number, 'si_number', s.si_number, 'sale_date', s.sale_date,
    'customer', s.legal_name, 'total', s.total, 'ar_balance', coalesce(v_bal, 0), 'order_dr', s.sales_order_id is not null,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sale_item_id', i.id, 'description', i.description, 'unit', i.unit, 'item_type', i.item_type,
                'sold', i.quantity, 'unit_price', i.unit_price, 'released', i.stock_movement_id is not null,
                'returned', coalesce((select sum(ri.quantity) from public.storefront_return_items ri where ri.sale_item_id = i.id), 0)) order by i.description)
              from public.storefront_sale_items i where i.sale_id = s.id), '[]'::jsonb));
end $$;
grant execute on function public.storefront_sale_for_return(text) to authenticated;

-- --------------------------------------------------- returns: SF-15 condition --
-- lines: [{sale_item_id, quantity, condition: back_to_stock | damaged | wrong_item}]
create or replace function public.storefront_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; l record; si record; r jsonb; v_ret uuid; v_no text; v_cond text;
        v_total numeric := 0; v_credit numeric := 0; v_refund numeric := 0; v_paid_refund numeric := 0; v_bal numeric := 0; v_mov uuid; v_inv_item uuid; v_done numeric;
        v_cost numeric := 0; v_damaged numeric := 0; v_vat numeric := 0; v_unit numeric;
begin
  select * into s from public.storefront_sales where id = (p->>'sale_id')::uuid and business_id = b for update;
  if not found then raise exception 'Sale not found in this store.'; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be returned.'; end if;
  if coalesce(btrim(p->>'reason'), '') = '' then raise exception 'Enter the reason for the return.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Choose at least one item to return.'; end if;

  v_no := public.storefront_next_number('SFR', 'storefront_returns', 'return_number');
  insert into public.storefront_returns(business_id, return_number, sale_id, reason, created_by)
  values (b, v_no, s.id, btrim(p->>'reason'), auth.uid()) returning id into v_ret;

  for l in select * from jsonb_to_recordset(p->'lines') as x(sale_item_id uuid, quantity numeric, condition text) loop
    if coalesce(l.quantity, 0) <= 0 then continue; end if;
    v_cond := coalesce(nullif(l.condition, ''), 'back_to_stock');
    if v_cond not in ('back_to_stock','damaged','wrong_item') then raise exception 'Mark each returned item as Back to stock, Damaged or Wrong item.'; end if;
    select * into si from public.storefront_sale_items where id = l.sale_item_id and sale_id = s.id;
    if not found then raise exception 'An item on the return is not on sale %.', s.sale_number; end if;
    select coalesce(sum(quantity), 0) into v_done from public.storefront_return_items where sale_item_id = si.id;
    if l.quantity > si.quantity - v_done then
      raise exception 'Only % of % can still be returned.', (si.quantity - v_done)::text, si.description;
    end if;
    v_mov := null;
    v_unit := coalesce(si.unit_cost, si.acquisition_cost, 0);
    if si.item_type <> 'service' then
      -- goods that left the store come back into stock unless damaged; an order DR not yet released never left
      if v_cond <> 'damaged' and si.stock_movement_id is not null then
        v_inv_item := coalesce(si.inventory_item_id, public.ensure_inventory_link(si.item_id, b));
        insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
        values (b, v_inv_item, s.location_id, (now() at time zone 'Asia/Manila')::date, 'adjustment', l.quantity, round(v_unit, 4), 'storefront_returns', v_ret, v_no,
                'Storefront return of ' || s.sale_number || ' (' || replace(v_cond, '_', ' ') || '): ' || btrim(p->>'reason'), auth.uid())
        returning id into v_mov;
      end if;
      v_cost := v_cost + round(l.quantity * v_unit, 2);
      if v_cond = 'damaged' and (si.stock_movement_id is not null) then v_damaged := v_damaged + round(l.quantity * v_unit, 2); end if;
    end if;
    insert into public.storefront_return_items(business_id, return_id, sale_item_id, quantity, unit_price, line_total, stock_movement_id, condition)
    values (b, v_ret, si.id, l.quantity, si.unit_price, round(l.quantity * si.unit_price, 2), v_mov, v_cond);
    v_total := v_total + round(l.quantity * si.unit_price, 2);
  end loop;
  if v_total <= 0 then raise exception 'Choose at least one item to return.'; end if;
  if s.vat_applied then v_vat := round(v_total * 12 / 112, 2); end if;

  if s.ar_invoice_id is not null then
    select balance_due into v_bal from public.finance_customer_invoices where id = s.ar_invoice_id for update;
    v_credit := least(v_total, greatest(coalesce(v_bal, 0), 0));
    if v_credit > 0 then
      update public.finance_customer_invoices
         set discount_amount = discount_amount + v_credit, updated_at = now(),
             notes = coalesce(notes || E'\n', '') || 'Return ' || v_no || ': ₱' || v_credit || ' credited against the balance.'
       where id = s.ar_invoice_id;
      perform public.recalculate_customer_invoice_received(s.ar_invoice_id);
    end if;
  end if;
  v_refund := v_total - v_credit;

  for r in select * from jsonb_array_elements(coalesce(p->'refunds', '[]'::jsonb)) loop
    if coalesce((r->>'amount')::numeric, 0) <= 0 then continue; end if;
    perform public.storefront_record_payment(b, 'refund', r->>'method', (r->>'amount')::numeric, r->>'reference', s.id, null, v_ret, 'Refund for return ' || v_no,
                                             nullif(r->>'account', '')::uuid);
    v_paid_refund := v_paid_refund + round((r->>'amount')::numeric, 2);
  end loop;
  if v_paid_refund <> v_refund then
    raise exception 'Refund to give is ₱% (returned ₱%, of which ₱% reduces the unpaid balance); the refund entered is ₱%.', v_refund, v_total, v_credit, v_paid_refund;
  end if;

  update public.storefront_returns set total = v_total, credit_to_ar = v_credit, refund_total = v_refund, vat_amount = v_vat, cost_total = v_cost, damaged_cost = v_damaged where id = v_ret;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_returns', v_ret, 'storefront_return', jsonb_build_object('return_number', v_no, 'sale_number', s.sale_number, 'total', v_total, 'credit_to_ar', v_credit,
          'refund', v_refund, 'vat', v_vat, 'damaged_cost', v_damaged, 'reason', btrim(p->>'reason')));
  return jsonb_build_object('id', v_ret, 'return_number', v_no, 'total', v_total, 'credit_to_ar', v_credit, 'refund', v_refund, 'damaged_cost', v_damaged);
end $$;

-- ------------------------------------------ SF-17: cancel a completed sale --
create or replace function public.storefront_request_cancel(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale is cancelled this way (a sale not yet completed is simply cancelled).'; end if;
  if s.cancel_status in ('requested','approved') then raise exception 'Cancellation of % is already %.', s.sale_number, s.cancel_status; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the sale is cancelled.'; end if;
  update public.storefront_sales set cancel_status = 'requested', cancel_reason = btrim(p_reason), cancel_requested_by = auth.uid(), cancel_requested_at = now(),
                                     cancel_decided_by = null, cancel_decided_at = null, cancel_note = null where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_cancel_requested', jsonb_build_object('sale_number', s.sale_number, 'reason', btrim(p_reason)));
end $$;

-- Approving reverses the whole sale as a return of everything not yet returned:
-- goods back to stock, the unpaid balance credited, the rest refunded the way it
-- was paid (checks are refunded in cash). The sale stays in the books with its
-- reversal, so both show in the closings.
create or replace function public.storefront_decide_cancel(p_sale uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; v_lines jsonb; v_value numeric; v_bal numeric := 0; v_refund numeric; v_left numeric;
        m record; v_refunds jsonb := '[]'; a numeric; v_acc uuid; r jsonb; v_ret uuid;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver or Business Admin can decide a cancellation.'; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.cancel_status is distinct from 'requested' then raise exception 'No cancellation is waiting for % .', s.sale_number; end if;
  if s.cancel_requested_by = auth.uid() and not public.is_super_admin() then raise exception 'You asked for this cancellation, so another approver must decide it.'; end if;
  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Say why the cancellation is refused.'; end if;
    update public.storefront_sales set cancel_status = 'rejected', cancel_decided_by = auth.uid(), cancel_decided_at = now(), cancel_note = btrim(p_note) where id = s.id;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_cancel_rejected', jsonb_build_object('sale_number', s.sale_number, 'note', p_note));
    return jsonb_build_object('status', 'rejected');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('sale_item_id', i.id, 'quantity', i.quantity - x.done, 'condition', 'back_to_stock')), '[]'::jsonb),
         coalesce(sum(round((i.quantity - x.done) * i.unit_price, 2)), 0)
    into v_lines, v_value
    from public.storefront_sale_items i
    cross join lateral (select coalesce(sum(ri.quantity), 0) as done from public.storefront_return_items ri where ri.sale_item_id = i.id) x
   where i.sale_id = s.id and i.quantity - x.done > 0;
  if v_value > 0 then
    if s.ar_invoice_id is not null then select greatest(balance_due, 0) into v_bal from public.finance_customer_invoices where id = s.ar_invoice_id; end if;
    v_refund := v_value - least(v_value, coalesce(v_bal, 0));
    v_left := v_refund;
    for m in select * from public.storefront_refundable(s.id) where method <> 'check' and refundable > 0 order by (method = 'cash') loop
      exit when v_left <= 0;
      a := least(v_left, m.refundable);
      select bank_account_id into v_acc from public.storefront_payments where sale_id = s.id and method = m.method and kind <> 'refund' order by received_at desc limit 1;
      v_refunds := v_refunds || jsonb_build_array(jsonb_build_object('method', m.method, 'amount', a, 'reference', 'Cancel ' || s.sale_number, 'account', v_acc));
      v_left := v_left - a;
    end loop;
    if v_left > 0 then
      select bank_account_id into v_acc from public.storefront_payments where sale_id = s.id and method = 'cash' and kind <> 'refund' order by received_at desc limit 1;
      v_refunds := v_refunds || jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', v_left, 'account', v_acc));
    end if;
    r := public.storefront_return(jsonb_build_object('sale_id', s.id, 'reason', 'Sale cancelled: ' || s.cancel_reason, 'lines', v_lines, 'refunds', v_refunds));
    v_ret := (r->>'id')::uuid;
  end if;
  update public.storefront_sales set cancel_status = 'approved', cancel_decided_by = auth.uid(), cancel_decided_at = now(), cancel_note = nullif(btrim(coalesce(p_note, '')), ''),
                                     cancel_return_id = v_ret where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_cancelled_after_completion', jsonb_build_object('sale_number', s.sale_number, 'return', r->>'return_number', 'refund', r->>'refund'));
  return jsonb_build_object('status', 'approved', 'return_number', r->>'return_number', 'refund', coalesce((r->>'refund')::numeric, 0), 'credit_to_ar', coalesce((r->>'credit_to_ar')::numeric, 0));
end $$;

-- -------------------------------------- closing journal: damaged goods (SF-15) --
create or replace function public.storefront_post_closing(p_closing uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; b uuid; v_code text; gl jsonb := '{}'; bank jsonb := '{}'; p record; x record; v_je uuid; v_jno text;
        v_rev_net numeric; v_vat numeric; v_ret_net numeric; v_ret_vat numeric; v_ar_charged numeric; v_ar_credit numeric; v_ar_coll numeric;
        v_cogs numeric; v_ret_cost numeric; v_damaged numeric; v_drawer uuid; v_drawer_gl uuid; d numeric; cr numeric; v_section uuid; v_tno text; v_n int; v_acc uuid;
begin
  select * into c from public.storefront_closings where id = p_closing for update;
  if c.journal_entry_id is not null then return c.journal_entry_id; end if;
  b := c.business_id;
  select code into v_code from public.businesses where id = b;
  select id into v_section from public.sections where code = 'sales';
  select id, coalesce(gl_account_id, public.sf_gl(b, '1000')) into v_drawer, v_drawer_gl
    from public.finance_bank_accounts where business_id = b and payment_method = 'cash' and status = 'active' order by (account_code = 'SF-CASH') desc limit 1;
  if v_drawer_gl is null then v_drawer_gl := public.sf_gl(b, '1000'); end if;

  -- Build 71d: every payment must name the account that received it before
  -- the day goes to Finance. Payments recorded before receiving accounts
  -- existed get the store's only account for their method; with none (or
  -- several) the approval stops and says what to set up.
  for p in select sp.id, sp.payment_number, sp.method, sp.amount from public.storefront_payments sp
            where sp.closing_id = c.id and sp.bank_account_id is null loop
    select count(*), min(id::text)::uuid into v_n, v_acc from public.finance_bank_accounts
     where business_id = b and payment_method = p.method and status = 'active';
    if v_n = 1 then
      update public.storefront_payments set bank_account_id = v_acc where id = p.id;
    elsif v_n = 0 then
      raise exception 'Payment % (% ₱%) has no receiving account and this store has no % account yet: a Business Admin adds it in Storefront → Store settings → Receiving accounts, then approve again.',
        p.payment_number, p.method, p.amount, case p.method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' when 'cash' then 'cash drawer' else 'bank' end;
    else
      raise exception 'Payment % (% ₱%) has no receiving account and this store has several % accounts; it cannot be linked automatically. Ask the Super Admin to set which account received it, then approve again.',
        p.payment_number, p.method, p.amount, p.method;
    end if;
  end loop;

  -- money in / out by receiving account
  for p in select sp.*, a.gl_account_id from public.storefront_payments sp left join public.finance_bank_accounts a on a.id = sp.bank_account_id
            where sp.closing_id = c.id loop
    gl := public.sf_jadd(gl, coalesce(p.gl_account_id, public.sf_default_gl(b, p.method)), case when p.kind = 'refund' then -p.amount else p.amount end);
    bank := public.sf_badd(bank, p.bank_account_id, case when p.kind = 'refund' then -p.amount else p.amount end);
  end loop;

  -- sales, VAT, AR
  select coalesce(sum(total - vat_amount), 0), coalesce(sum(vat_amount), 0), coalesce(sum(balance), 0), coalesce(sum(cost_total), 0)
    into v_rev_net, v_vat, v_ar_charged, v_cogs from public.storefront_sales where closing_id = c.id and status = 'completed';
  select coalesce(sum(total - vat_amount), 0), coalesce(sum(vat_amount), 0), coalesce(sum(credit_to_ar), 0), coalesce(sum(cost_total), 0), coalesce(sum(damaged_cost), 0)
    into v_ret_net, v_ret_vat, v_ar_credit, v_ret_cost, v_damaged from public.storefront_returns where closing_id = c.id;
  select coalesce(sum(amount), 0) into v_ar_coll from public.storefront_payments where closing_id = c.id and kind = 'ar_collection';

  gl := public.sf_jadd(gl, public.sf_gl(b, '4000'), -v_rev_net);          -- Cr sales (net of VAT)
  gl := public.sf_jadd(gl, public.sf_gl(b, '2210'), -v_vat);              -- Cr output VAT
  gl := public.sf_jadd(gl, public.sf_gl(b, '4010'), v_ret_net);           -- Dr sales returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '2210'), v_ret_vat);           -- Dr output VAT on returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '1100'), v_ar_charged - v_ar_coll - v_ar_credit); -- AR: charged − collected − credited by returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '5000'), v_cogs - v_ret_cost); -- Dr cost of sales
  gl := public.sf_jadd(gl, public.sf_gl(b, '1200'), v_ret_cost - v_damaged - v_cogs); -- Cr inventory (returned goods back in stock)
  gl := public.sf_jadd(gl, public.sf_gl(b, '1210'), v_damaged);          -- Dr damaged goods held (SF-15)

  -- cash taken out of the drawer
  for x in select * from public.storefront_cash_movements where closing_id = c.id and kind = 'cash_out' loop
    gl := public.sf_jadd(gl, v_drawer_gl, -x.amount);
    bank := public.sf_badd(bank, v_drawer, -x.amount);
    if x.category = 'bank_deposit' then
      gl := public.sf_jadd(gl, coalesce((select gl_account_id from public.finance_bank_accounts where id = x.bank_account_id), public.sf_gl(b, '1010')), x.amount);
      bank := public.sf_badd(bank, x.bank_account_id, x.amount);
    elsif x.category = 'petty_cash' then gl := public.sf_jadd(gl, public.sf_gl(b, '1005'), x.amount);
    else gl := public.sf_jadd(gl, public.sf_gl(b, '1090'), x.amount);
    end if;
  end loop;

  -- cash short / over
  gl := public.sf_jadd(gl, v_drawer_gl, c.variance);
  gl := public.sf_jadd(gl, public.sf_gl(b, '5010'), -c.variance);
  bank := public.sf_badd(bank, v_drawer, c.variance);

  select coalesce(sum(greatest(value::numeric, 0)), 0), coalesce(sum(greatest(-value::numeric, 0)), 0) into d, cr
    from jsonb_each_text(gl) where round(value::numeric, 2) <> 0;
  if round(d, 2) <> round(cr, 2) then raise exception 'Closing % does not balance (debit % / credit %).', c.closing_number, d, cr; end if;

  if d > 0 then
    v_jno := public.storefront_next_number(v_code || '-SFJ', 'finance_journal_entries', 'journal_number');
    insert into public.finance_journal_entries(business_id, journal_number, entry_date, description, source_module, source_record_id, section_id, status,
                                               total_debit, total_credit, prepared_by, prepared_at, created_by, notes)
    values (b, v_jno, c.closing_date, 'Storefront daily closing ' || c.closing_number || ' (' || c.closing_date || ')', 'storefront', c.id, v_section, 'prepared',
            round(d, 2), round(cr, 2), auth.uid(), now(), auth.uid(),
            'Created when the daily closing was approved. Sales ₱' || c.sales_total || ' (VAT ₱' || c.vat_total || '), returns ₱' || c.returns_total || ', cash variance ₱' || c.variance || '.')
    returning id into v_je;
    insert into public.finance_journal_lines(business_id, journal_entry_id, account_id, line_description, debit, credit, department)
    select b, v_je, key::uuid, coa.account_name || ' — ' || c.closing_number,
           case when round(value::numeric, 2) > 0 then round(value::numeric, 2) else 0 end,
           case when round(value::numeric, 2) < 0 then round(-value::numeric, 2) else 0 end, 'Storefront'
      from jsonb_each_text(gl) join public.finance_chart_of_accounts coa on coa.id = key::uuid
     where round(value::numeric, 2) <> 0;
  end if;

  -- one Bank/Cash transaction per account (net), for Finance to review and post
  for x in select key::uuid as account_id, round(value::numeric, 2) as amount from jsonb_each_text(bank) where round(value::numeric, 2) <> 0 loop
    v_tno := public.storefront_next_number(v_code || '-SFT', 'finance_cash_transactions', 'transaction_number');
    insert into public.finance_cash_transactions(business_id, transaction_number, bank_account_id, transaction_date, transaction_type, amount, direction, description,
                                                 reference_number, source_module, source_record_id, status, prepared_by, prepared_at, created_by)
    values (b, v_tno, x.account_id, c.closing_date, case when x.amount > 0 then 'deposit' else 'withdrawal' end::public.cash_transaction_type, abs(x.amount),
            case when x.amount > 0 then 'in' else 'out' end, 'Storefront daily closing ' || c.closing_number || ' (net for the day)',
            c.closing_number, 'storefront', c.id, 'prepared', auth.uid(), now(), auth.uid());
  end loop;

  update public.storefront_closings set journal_entry_id = v_je, posted_at = now() where id = c.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', c.id, 'storefront_closing_sent_to_finance', jsonb_build_object('journal', v_jno, 'total', d));
  return v_je;
end $$;
revoke all on function public.storefront_post_closing(uuid) from public, authenticated;

-- closing preview: the checks received (post-dated ones marked)
create or replace function public.storefront_closing_preview(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return public.storefront_closing_totals(b, p_date, null) || jsonb_build_object(
    'date', p_date,
    'already_closed', exists (select 1 from public.storefront_closings where business_id = b and closing_date = p_date and status <> 'returned'),
    'awaiting_approval', (select count(*) from public.storefront_sales where business_id = b and status in ('pending_approval','approved')),
    'cash_movements', coalesce((select jsonb_agg(jsonb_build_object('number', movement_number, 'date', movement_date, 'kind', kind, 'category', category, 'amount', amount, 'note', note) order by created_at)
                                  from public.storefront_cash_movements where business_id = b and closing_id is null and movement_date <= p_date), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('number', k.check_number, 'bank', k.bank_name, 'date', k.check_date, 'amount', k.amount,
                                                           'pdc', k.check_date > p_date, 'payment', sp.payment_number) order by k.check_date)
                          from public.storefront_checks k join public.storefront_payments sp on sp.id = k.payment_id
                         where k.business_id = b and sp.closing_id is null and (sp.received_at at time zone 'Asia/Manila')::date <= p_date), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ SF-27 --
create or replace function public.can_handle_checks()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_approve_storefront() or public.has_section_access('finance')
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'finance');
$$;

-- p_action: deposit {bank_account, date} | clear {date} | bounce {reason, date, customer_id | new_customer_name, phone}
create or replace function public.storefront_check_action(p_check uuid, p_action text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); k record; v_date date := coalesce(nullif(p->>'date', '')::date, (now() at time zone 'Asia/Manila')::date);
        v_bank record; v_hold record; v_je uuid; v_cust uuid; v_walk uuid; v_inv uuid; v_no text; v_code text; gl jsonb := '{}'; v_from_gl uuid; v_from_acc uuid;
begin
  if not public.can_handle_checks() then raise exception 'Checks are deposited, cleared or marked bounced by a Sales approver, Business Admin or Finance.'; end if;
  select * into k from public.storefront_checks where id = p_check and business_id = b for update;
  if not found then raise exception 'Check not found in this business.'; end if;
  select a.* into v_hold from public.storefront_payments sp join public.finance_bank_accounts a on a.id = sp.bank_account_id where sp.id = k.payment_id;
  select code into v_code from public.businesses where id = b;

  if p_action = 'deposit' then
    if k.status <> 'on_hand' then raise exception 'Only a check on hand can be deposited (this one is %).', k.status; end if;
    if k.check_date > v_date then raise exception 'Post-dated check: it can be deposited from % onwards.', k.check_date; end if;
    select * into v_bank from public.finance_bank_accounts where id = nullif(p->>'bank_account', '')::uuid and business_id = b and status = 'active'
       and coalesce(payment_method, 'bank_transfer') = 'bank_transfer' and not is_cash_on_hand;
    if not found then raise exception 'Choose the bank account the check was deposited to.'; end if;
    gl := public.sf_jadd(gl, coalesce(v_bank.gl_account_id, public.sf_gl(b, '1010')), k.amount);
    gl := public.sf_jadd(gl, coalesce(v_hold.gl_account_id, public.sf_gl(b, '1040')), -k.amount);
    v_je := public.sf_make_journal(b, v_date, 'Check ' || k.check_number || ' (' || k.bank_name || ') deposited', k.id, gl);
    perform public.sf_make_cash_txn(b, v_hold.id, v_date, -k.amount, 'Check ' || k.check_number || ' deposited to ' || v_bank.account_name, k.check_number, k.id);
    perform public.sf_make_cash_txn(b, v_bank.id, v_date, k.amount, 'Check ' || k.check_number || ' (' || k.bank_name || ') deposited', k.check_number, k.id);
    update public.storefront_checks set status = 'deposited', deposited_to = v_bank.id, deposited_on = v_date, deposit_journal_id = v_je, updated_by = auth.uid(), updated_at = now() where id = k.id;

  elsif p_action = 'clear' then
    if k.status <> 'deposited' then raise exception 'Only a deposited check can be marked cleared.'; end if;
    update public.storefront_checks set status = 'cleared', cleared_on = v_date, updated_by = auth.uid(), updated_at = now() where id = k.id;

  elsif p_action = 'bounce' then
    if k.status not in ('on_hand','deposited') then raise exception 'Only a check on hand or deposited can bounce (this one is %).', k.status; end if;
    if coalesce(btrim(p->>'reason'), '') = '' then raise exception 'Enter why the check bounced (e.g. insufficient funds).'; end if;
    select walk_in_customer_id into v_walk from public.storefront_settings where business_id = b;
    v_cust := k.customer_id;
    if v_cust is null or v_cust = v_walk then
      v_cust := nullif(p->>'customer_id', '')::uuid;
      if v_cust is not null and not exists (select 1 from public.finance_customers where id = v_cust and business_id = b and active and (v_walk is null or id <> v_walk)) then
        raise exception 'Choose a named customer of this business.';
      end if;
      if v_cust is null then v_cust := public.sf_create_customer(b, coalesce(nullif(btrim(p->>'new_customer_name'), ''), k.issuer_name), p->>'phone'); end if;
    end if;
    if k.status = 'deposited' then
      select id, coalesce(gl_account_id, public.sf_gl(b, '1010')) into v_from_acc, v_from_gl from public.finance_bank_accounts where id = k.deposited_to;
    else v_from_acc := v_hold.id; v_from_gl := coalesce(v_hold.gl_account_id, public.sf_gl(b, '1040'));
    end if;
    v_no := public.storefront_next_number(v_code || '-BCK', 'finance_customer_invoices', 'invoice_number');
    insert into public.finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, discount_amount, amount_received, status, notes,
                                                 prepared_by, prepared_at, approved_by, approved_at, created_by)
    values (b, v_no, v_cust, v_date, v_date, k.amount, 0, 0, 0, 'approved',
            'Bounced check ' || k.check_number || ' (' || k.bank_name || ', dated ' || k.check_date || '): ' || btrim(p->>'reason') || '. The amount is owed again.',
            auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_inv;
    insert into public.finance_customer_invoice_items(business_id, invoice_id, description, quantity, unit, unit_price)
    values (b, v_inv, 'Bounced check ' || k.check_number || ' — ' || k.bank_name, 1, 'lot', k.amount);
    gl := public.sf_jadd(gl, public.sf_gl(b, '1100'), k.amount);
    gl := public.sf_jadd(gl, v_from_gl, -k.amount);
    v_je := public.sf_make_journal(b, v_date, 'Bounced check ' || k.check_number || ' back to AR (' || v_no || ')', k.id, gl);
    perform public.sf_make_cash_txn(b, v_from_acc, v_date, -k.amount, 'Bounced check ' || k.check_number || ' reversed', k.check_number, k.id);
    update public.storefront_checks set status = 'bounced', bounced_on = v_date, bounce_reason = btrim(p->>'reason'), bounce_invoice_id = v_inv, bounce_journal_id = v_je,
                                        customer_id = v_cust, updated_by = auth.uid(), updated_at = now() where id = k.id;
  else
    raise exception 'Unknown check action %.', p_action;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_checks', k.id, 'storefront_check_' || p_action, jsonb_build_object('check', k.check_number, 'amount', k.amount, 'journal', v_je, 'invoice', v_no) || coalesce(p, '{}'));
  return jsonb_build_object('status', (select status from public.storefront_checks where id = k.id), 'invoice_number', v_no);
end $$;

-- Reminder when a post-dated check's date arrives (run when the Storefront opens;
-- each check reminds once). Returns the number of new reminders.
create or replace function public.storefront_check_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); k record; n int := 0;
begin
  if b is null or not public.can_view_storefront() then return 0; end if;
  for k in select * from public.storefront_checks where business_id = b and status = 'on_hand' and reminded_at is null
             and check_date <= (now() at time zone 'Asia/Manila')::date and check_date > (created_at at time zone 'Asia/Manila')::date for update skip locked loop
    insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
    select distinct b, u.id, 'sales', 'storefront_checks', k.id, 'Post-dated check due: ' || k.check_number,
           'Check ' || k.check_number || ' (' || k.bank_name || ', ₱' || k.amount || ') is dated ' || k.check_date || ' and can now be deposited.',
           '/sales/storefront?tab=checks', auth.uid()
      from public.users u
     where u.is_active and u.business_id = b
       and (u.role in ('business_admin','finance')
            or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                        where ua.user_id = u.id and (s.code = 'finance' or (s.code = 'sales' and ua.workflow_role = 'approver'))));
    update public.storefront_checks set reminded_at = now() where id = k.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------ SF-03d --
create or replace function public.guard_quotation_vat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.revised_from is not null and not new.vat_applied then
    select vat_applied into new.vat_applied from public.sales_quotations where id = new.revised_from;
  end if;
  if new.vat_applied then new.tax_amount := 0; end if;   -- prices are VAT-inclusive; no separate tax on top
  new.vat_amount := case when new.vat_applied
                         then round((coalesce(new.subtotal,0) + coalesce(new.other_charges,0) - coalesce(new.discount_amount,0)) * 12 / 112, 2) else 0 end;
  return new;
end $$;
drop trigger if exists sales_quotations_vat on public.sales_quotations;
create trigger sales_quotations_vat before insert or update on public.sales_quotations for each row execute function public.guard_quotation_vat();

create or replace function public.guard_order_vat()
returns trigger language plpgsql security definer set search_path = public as $$
declare q record;
begin
  if tg_op = 'INSERT' and new.quotation_id is not null then
    select vat_applied, payment_terms into q from public.sales_quotations where id = new.quotation_id;
    new.vat_applied := coalesce(q.vat_applied, false);
    new.payment_terms := coalesce(new.payment_terms, q.payment_terms);
  elsif tg_op = 'UPDATE' then
    new.vat_applied := old.vat_applied;   -- the order follows its quotation
  end if;
  if new.vat_applied then new.tax_amount := 0; end if;
  new.vat_amount := case when new.vat_applied
                         then round((coalesce(new.subtotal,0) + coalesce(new.other_charges,0) - coalesce(new.discount_amount,0)) * 12 / 112, 2) else 0 end;
  return new;
end $$;
drop trigger if exists sales_orders_vat on public.sales_orders;
create trigger sales_orders_vat before insert or update on public.sales_orders for each row execute function public.guard_order_vat();
revoke all on function public.guard_quotation_vat(), public.guard_order_vat() from public, authenticated;
update public.sales_orders o set payment_terms = q.payment_terms from public.sales_quotations q where q.id = o.quotation_id and o.payment_terms is null;

-- ------------------------------------------------------------------ SF-01 --
-- quantity of an order line delivered on DRs (net of returns), and released by the Warehouse
create or replace function public.sf_order_line_delivered(p_order_item uuid)
returns table(delivered numeric, released numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.quantity - r.qty), 0),
         coalesce(sum(i.quantity - r.qty) filter (where s.release_status = 'released'), 0)
    from public.storefront_sale_items i
    join public.storefront_sales s on s.id = i.sale_id and s.status = 'completed'
    cross join lateral (select coalesce(sum(ri.quantity), 0) as qty from public.storefront_return_items ri where ri.sale_item_id = i.id) r
   where i.sales_order_item_id = p_order_item;
$$;

-- quantity of a "from supplier" order line received on posted receipts of its PO(s)
create or replace function public.sf_order_line_received(p_order_item uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(least(poi.quantity, coalesce((
           select sum(ri.quantity) from public.logistics_receipts r
             join public.logistics_receipt_items ri on ri.receipt_id = r.id
             join public.logistics_inventory_items inv on inv.id = ri.inventory_item_id
            where r.purchase_order_id = poi.purchase_order_id and r.status = 'posted' and inv.procurement_item_id = poi.item_id), 0))), 0)
    from public.sales_order_items soi
    join public.purchase_order_items poi on poi.source_requisition_item_id = soi.purchase_requisition_item_id
   where soi.id = p_order_item and soi.purchase_requisition_item_id is not null;
$$;
revoke all on function public.sf_order_line_delivered(uuid), public.sf_order_line_received(uuid) from public, authenticated;

-- Orders monitor: approved orders of the store with lines, DRs, PR / PO and payment status from AR.
create or replace function public.storefront_orders(p_include_done boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); loc uuid;
begin
  if not public.can_view_storefront() then raise exception 'Storefront access is required.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select location_id into loc from public.storefront_settings where business_id = b;
  return coalesce((
    select jsonb_agg(x.o order by x.d desc) from (
      select so.order_date as d, jsonb_build_object(
        'id', so.id, 'order_number', so.order_number, 'order_date', so.order_date, 'status', so.status, 'quotation_number', q.quotation_number,
        'customer_id', so.customer_id, 'customer', c.legal_name, 'client_po', so.client_po_number, 'payment_terms', so.payment_terms,
        'vat_applied', so.vat_applied, 'total', so.total_amount, 'delivery_address', so.delivery_address, 'requested_delivery_date', so.requested_delivery_date,
        'pr_number', pr.pr_number,
        'po_numbers', coalesce((select jsonb_agg(distinct po.po_number) from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
                                  join public.purchase_requisition_items pri on pri.id = poi.source_requisition_item_id where pri.requisition_id = so.purchase_requisition_id), '[]'::jsonb),
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', soi.id, 'description', soi.description, 'unit', soi.unit, 'ordered', soi.quantity, 'unit_price', soi.unit_price, 'fulfilment', soi.fulfilment,
                   'catalog_item_id', soi.catalog_item_id, 'delivered', dl.delivered, 'released', dl.released,
                   'received', case when soi.fulfilment = 'source' then public.sf_order_line_received(soi.id) end,
                   'on_hand', case when soi.catalog_item_id is null or soi.fulfilment = 'service' then null else coalesce((
                                select sum(bal.on_hand) from public.logistics_inventory_items inv join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id and bal.location_id = loc
                                 where inv.business_id = b and inv.procurement_item_id = soi.catalog_item_id), 0) end
                 ) order by soi.ctid) from public.sales_order_items soi cross join lateral public.sf_order_line_delivered(soi.id) dl where soi.order_id = so.id), '[]'::jsonb),
        'drs', coalesce((select jsonb_agg(jsonb_build_object('sale_id', s.id, 'sale_number', s.sale_number, 'dr_number', s.dr_number, 'si_number', s.si_number,
                   'sale_date', s.sale_date, 'total', s.total, 'release_status', s.release_status, 'released_at', s.released_at,
                   'invoice_number', inv.invoice_number, 'invoice_status', inv.status, 'balance_due', inv.balance_due, 'due_date', inv.due_date) order by s.created_at)
                 from public.storefront_sales s left join public.finance_customer_invoices inv on inv.id = s.ar_invoice_id
                where s.sales_order_id = so.id and s.status = 'completed'), '[]'::jsonb)
      ) as o
      from public.sales_orders so
      join public.finance_customers c on c.id = so.customer_id
      left join public.sales_quotations q on q.id = so.quotation_id
      left join public.purchase_requisitions pr on pr.id = so.purchase_requisition_id
     where so.business_id = b and so.status::text in ('approved','processing') or (so.business_id = b and p_include_done and so.status::text = 'fulfilled')
    ) x), '[]'::jsonb);
end $$;

-- Issue a DR from an approved sales order.
-- p = {order_id, lines:[{sales_order_item_id, quantity}], payments, si_number, notes}
create or replace function public.storefront_order_dr(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); st record; o record; l record; oi record; dl record; v_sale uuid; v_no text; v_tot numeric := 0; v_recv numeric;
        pr record; v_type text; v_any boolean := false;
begin
  select * into st from public.storefront_settings where business_id = b;
  if st.location_id is null then raise exception 'The Storefront has no stock location yet: a Business Admin sets it in Storefront settings.'; end if;
  select * into o from public.sales_orders where id = nullif(p->>'order_id', '')::uuid and business_id = b for update;
  if not found then raise exception 'Sales order not found in this business.'; end if;
  if o.status::text not in ('approved','processing') then raise exception 'Order % is %; DRs are issued for approved orders only.', o.order_number, o.status; end if;

  v_no := public.storefront_next_number('SF', 'storefront_sales', 'sale_number');
  insert into public.storefront_sales(business_id, sale_number, customer_id, location_id, status, notes, created_by, sales_order_id)
  values (b, v_no, o.customer_id, st.location_id, 'pending_approval',
          coalesce(nullif(btrim(p->>'notes'), '') || ' · ', '') || 'Order ' || o.order_number || coalesce(', client PO ' || o.client_po_number, ''), auth.uid(), o.id)
  returning id into v_sale;

  for l in select * from jsonb_to_recordset(coalesce(p->'lines', '[]'::jsonb)) as x(sales_order_item_id uuid, quantity numeric) loop
    if coalesce(l.quantity, 0) <= 0 then continue; end if;
    select * into oi from public.sales_order_items where id = l.sales_order_item_id and order_id = o.id;
    if not found then raise exception 'A line is not on order %.', o.order_number; end if;
    select * into dl from public.sf_order_line_delivered(oi.id);
    if l.quantity > oi.quantity - dl.delivered then
      raise exception '%: only % left to deliver on this order.', oi.description, (oi.quantity - dl.delivered)::text;
    end if;
    if oi.fulfilment = 'source' then
      v_recv := public.sf_order_line_received(oi.id);
      if l.quantity > v_recv - dl.delivered then
        raise exception '%: % received from the supplier so far and % already delivered; deliver the rest after its PO is received.', oi.description, v_recv::text, dl.delivered::text;
      end if;
    end if;
    pr := null;
    if oi.catalog_item_id is not null then select * into pr from public.storefront_item_price(oi.catalog_item_id, b); end if;
    v_type := case when oi.catalog_item_id is null or oi.fulfilment = 'service' then 'service' else coalesce(pr.item_type, 'product') end;
    insert into public.storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, acquisition_cost,
                                             floor_price, below_floor, line_total, sales_order_item_id)
    values (b, v_sale, oi.catalog_item_id, pr.item_code, oi.description, oi.unit, v_type, l.quantity, oi.unit_price, oi.unit_price,
            coalesce(pr.acquisition_cost, oi.estimated_unit_cost), null, false, round(l.quantity * oi.unit_price, 2), oi.id);
    v_tot := v_tot + round(l.quantity * oi.unit_price, 2);
    v_any := true;
  end loop;
  if not v_any then raise exception 'Enter the quantity to deliver on at least one line.'; end if;

  update public.storefront_sales set subtotal = v_tot, total = v_tot where id = v_sale;
  perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', true);
  if o.status::text = 'approved' then update public.sales_orders set status = 'processing', updated_at = now() where id = o.id; end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', v_sale, 'storefront_order_dr_issued', jsonb_build_object('sale_number', v_no, 'order_number', o.order_number, 'total', v_tot));
  return (select jsonb_build_object('id', id, 'sale_number', sale_number, 'dr_number', dr_number, 'total', total, 'balance', balance) from public.storefront_sales where id = v_sale);
end $$;

-- Warehouse confirms the physical release of an order DR: the stock leaves now.
create or replace function public.can_release_dr()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin() or public.has_section_access('logistics')
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'logistics');
$$;

create or replace function public.storefront_release_dr(p_sale uuid, p_location uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); s record; l record; v_loc uuid; v_mov uuid; v_net numeric; v_inv uuid; v_open int;
begin
  if not public.can_release_dr() then raise exception 'The Warehouse (Logistics) confirms the release of a DR.'; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'DR not found in this business.'; end if;
  if s.sales_order_id is null or s.status <> 'completed' then raise exception 'Only a DR issued from a sales order is released by the Warehouse.'; end if;
  if s.release_status = 'released' then raise exception 'DR % was already released.', s.dr_number; end if;
  v_loc := coalesce(p_location, s.location_id);
  if not exists (select 1 from public.logistics_locations where id = v_loc and business_id = b and active) then raise exception 'Choose an active location of this business.'; end if;
  for l in select * from public.storefront_sale_items where sale_id = s.id and item_type <> 'service' and item_id is not null loop
    select l.quantity - coalesce(sum(ri.quantity), 0) into v_net from public.storefront_return_items ri where ri.sale_item_id = l.id;
    if v_net <= 0 then continue; end if;
    v_inv := coalesce(l.inventory_item_id, public.ensure_inventory_link(l.item_id, b));
    insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
    values (b, v_inv, v_loc, (now() at time zone 'Asia/Manila')::date, 'issue', v_net, round(coalesce(l.unit_cost, l.acquisition_cost, 0), 4), 'storefront_sales', s.id, s.dr_number,
            'Released by the Warehouse for DR ' || s.dr_number, auth.uid())
    returning id into v_mov;
    update public.storefront_sale_items set stock_movement_id = v_mov, inventory_item_id = v_inv where id = l.id;
  end loop;
  update public.storefront_sales set release_status = 'released', released_by = auth.uid(), released_at = now() where id = s.id;
  -- order complete when every line is fully delivered and released
  select count(*) into v_open from public.sales_order_items soi cross join lateral public.sf_order_line_delivered(soi.id) dl
   where soi.order_id = s.sales_order_id and dl.released < soi.quantity;
  if v_open = 0 then update public.sales_orders set status = 'fulfilled', fulfilled_at = now(), updated_at = now() where id = s.sales_order_id; end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_dr_released', jsonb_build_object('dr_number', s.dr_number, 'location', v_loc, 'order_complete', v_open = 0));
  return jsonb_build_object('dr_number', s.dr_number, 'order_complete', v_open = 0);
end $$;

-- DRs waiting for the Warehouse (for the Logistics screen)
create or replace function public.storefront_drs_awaiting_release()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not (public.can_release_dr() or public.can_view_storefront()) then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('sale_id', s.id, 'dr_number', s.dr_number, 'sale_date', s.sale_date, 'order_number', so.order_number,
            'customer', c.legal_name, 'delivery_address', so.delivery_address, 'location', l.location_code || ' — ' || l.location_name,
            'lines', (select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity - coalesce((select sum(ri.quantity) from public.storefront_return_items ri where ri.sale_item_id = i.id), 0),
                                                          'unit', i.unit, 'service', i.item_type = 'service' or i.item_id is null)) from public.storefront_sale_items i where i.sale_id = s.id)) order by s.created_at)
     from public.storefront_sales s join public.sales_orders so on so.id = s.sales_order_id join public.finance_customers c on c.id = s.customer_id
     join public.logistics_locations l on l.id = s.location_id
    where s.business_id = b and s.status = 'completed' and s.release_status = 'awaiting_release'), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ SF-20 --
-- Read-only context (Finance opens the Storefront without selling rights)
create or replace function public.storefront_view_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); s record;
begin
  if not public.can_view_storefront() then raise exception 'Storefront access is for Sales, Finance and Business Admins.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" to open the Storefront.'; end if;
  select st.*, l.location_name into s from public.storefront_settings st left join public.logistics_locations l on l.id = st.location_id where st.business_id = b;
  return jsonb_build_object('business_id', b, 'location_id', s.location_id, 'location_name', s.location_name, 'walk_in_customer_id', s.walk_in_customer_id,
    'can_approve', false, 'can_setup', false, 'read_only', true, 'can_handle_checks', public.can_handle_checks(),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'method', a.payment_method, 'name', a.account_name, 'number', coalesce(a.mobile_number, a.account_number_masked)) order by a.account_name)
                            from public.finance_bank_accounts a where a.business_id = b and a.payment_method is not null and a.status = 'active'), '[]'::jsonb));
end $$;

create or replace function public.storefront_closing_journals()
returns table(closing_id uuid, journal_number text, journal_status text)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not public.can_view_storefront() then raise exception 'Storefront access is required.'; end if;
  return query select c.id, j.journal_number, j.status::text from public.storefront_closings c join public.finance_journal_entries j on j.id = c.journal_entry_id where c.business_id = b;
end $$;

-- ------------------------------------------------------------------ grants --
grant execute on function public.storefront_submit_sale(jsonb), public.storefront_approve_sale(uuid), public.storefront_return(jsonb),
  public.storefront_collect_ar(uuid, jsonb), public.storefront_request_cancel(uuid, text), public.storefront_decide_cancel(uuid, boolean, text),
  public.storefront_closing_preview(date), public.storefront_check_action(uuid, text, jsonb), public.storefront_check_reminders(),
  public.can_handle_checks(), public.can_release_dr(), public.storefront_orders(boolean), public.storefront_order_dr(jsonb),
  public.storefront_release_dr(uuid, uuid), public.storefront_drs_awaiting_release(), public.storefront_view_context(),
  public.storefront_closing_journals(), public.storefront_refundable(uuid), public.storefront_add_receiving_account(text, text, text, text) to authenticated;
revoke all on function public.guard_storefront_payment(), public.resolve_storefront_payment_account() from public, authenticated;
