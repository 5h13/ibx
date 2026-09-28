-- ============================================================================
-- Build 71 — Storefront wired into Finance (SF-02) and VAT (SF-03).
-- Decisions (user, 2026-09-28):
--   • VAT follows the document: a sale with an SI from a VAT-registered
--     booklet carries VAT; a DR-only sale has none. Prices are VAT-inclusive
--     (VAT = price × 12/112). A store may issue SIs from another business's
--     booklet (ATON uses ISHABELLA's) — the sale stays in the selling store's
--     books; SI numbers are unique across every store using that booklet.
--   • Counter sales reach Finance when the daily closing is APPROVED: one
--     journal entry (sent to Finance for review / approval / posting — posted
--     journals feed the dashboard) and one Bank/Cash transaction per receiving
--     account.
--   • Every counter payment records the account that received it: the cash
--     drawer, a specific GCash / Maya number (SIM), card clearing or a bank
--     account.
-- Also: chart of accounts and Bank/Cash account codes become unique per
-- business (they were unique across all businesses, so only one business
-- could have "1000 Cash on Hand"), and every business gets the standard
-- accounts.
-- ============================================================================

-- --------------------------------------------------------- per-business COA --
alter table public.finance_chart_of_accounts drop constraint if exists finance_chart_of_accounts_account_code_key;
create unique index if not exists finance_chart_of_accounts_business_code on public.finance_chart_of_accounts (business_id, account_code);

insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
select b.id, a.code, a.name, a.type::public.finance_account_type, a.descr
  from public.businesses b
 cross join (values
   ('1000','Cash on Hand','asset','Store cash drawers and cash on hand'),
   ('1005','Petty Cash Fund','asset','Cash taken from the drawer for petty cash'),
   ('1010','Bank Accounts','asset',null),
   ('1020','E-Wallets (GCash / Maya)','asset','GCash and Maya numbers of the stores'),
   ('1030','Card Receivables (Clearing)','asset','Card payments awaiting settlement'),
   ('1090','Clearing / Suspense','asset','Items to be classified by Finance'),
   ('1100','Accounts Receivable','asset',null),
   ('1200','Inventory','asset',null),
   ('1500','Property & Equipment','asset',null),
   ('2000','Accounts Payable','liability',null),
   ('2100','Payroll Liabilities','liability',null),
   ('2200','Taxes Payable','liability',null),
   ('2210','Output VAT Payable','liability','VAT on sales'),
   ('3000','Owner Equity','equity',null),
   ('4000','Sales Revenue','revenue',null),
   ('4010','Sales Returns and Allowances','revenue','Contra-revenue: returns (debit balance)'),
   ('4100','Other Revenue','revenue',null),
   ('5000','Cost of Sales','expense',null),
   ('5010','Cash Short / Over','expense','Daily closing cash variances'),
   ('5100','Payroll Expense','expense',null),
   ('5200','Operating Expenses','expense',null),
   ('5300','Bank Charges','expense',null)
 ) a(code, name, type, descr)
 where not exists (select 1 from public.finance_chart_of_accounts c where c.business_id = b.id and c.account_code = a.code);

create or replace function public.sf_gl(p_business uuid, p_code text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.finance_chart_of_accounts where business_id = p_business and account_code = p_code and active;
  if v is null then raise exception 'Account % is missing in this business''s chart of accounts.', p_code; end if;
  return v;
end $$;
revoke all on function public.sf_gl(uuid, text) from public, authenticated;

-- ---------------------------------------------- Bank/Cash receiving accounts --
alter table public.finance_bank_accounts drop constraint if exists finance_bank_accounts_account_code_key;
create unique index if not exists finance_bank_accounts_business_code on public.finance_bank_accounts (business_id, account_code);
alter table public.finance_bank_accounts
  add column if not exists payment_method text check (payment_method in ('cash','gcash','maya','card','bank_transfer')),
  add column if not exists mobile_number text,
  add column if not exists gl_account_id uuid references public.finance_chart_of_accounts(id);

-- every business: a store cash drawer and a card clearing account
insert into public.finance_bank_accounts(business_id, account_code, account_name, account_type, is_cash_on_hand, payment_method, gl_account_id, notes)
select b.id, 'SF-CASH', 'Store cash drawer', 'cash', true, 'cash', public.sf_gl(b.id, '1000'), 'Storefront cash drawer'
  from public.businesses b
 where not exists (select 1 from public.finance_bank_accounts x where x.business_id = b.id and x.account_code = 'SF-CASH');
insert into public.finance_bank_accounts(business_id, account_code, account_name, account_type, payment_method, gl_account_id, notes)
select b.id, 'SF-CARD', 'Card payments (clearing)', 'clearing', 'card', public.sf_gl(b.id, '1030'), 'Card payments until the bank settles them'
  from public.businesses b
 where not exists (select 1 from public.finance_bank_accounts x where x.business_id = b.id and x.account_code = 'SF-CARD');

create or replace function public.sf_default_gl(p_business uuid, p_method text)
returns uuid language sql stable security definer set search_path = public as $$
  select public.sf_gl(p_business, case p_method when 'cash' then '1000' when 'gcash' then '1020' when 'maya' then '1020' when 'card' then '1030' else '1010' end);
$$;
revoke all on function public.sf_default_gl(uuid, text) from public, authenticated;

-- ---------------------------------------------------------------- VAT setup --
alter table public.businesses add column if not exists vat_registered boolean not null default false;
alter table public.storefront_settings add column if not exists si_booklet_business_id uuid references public.businesses(id);

alter table public.storefront_sales
  add column if not exists si_booklet_business_id uuid references public.businesses(id),
  add column if not exists vat_applied boolean not null default false,
  add column if not exists vat_amount numeric(14,2) not null default 0,
  add column if not exists cost_total numeric(14,2) not null default 0;
update public.storefront_sales set si_booklet_business_id = business_id where si_number is not null and si_booklet_business_id is null;
update public.storefront_sales s set cost_total = coalesce((select round(sum(i.quantity * coalesce(i.acquisition_cost, 0)), 2) from public.storefront_sale_items i
                                                              where i.sale_id = s.id and i.item_type <> 'service'), 0)
 where s.status = 'completed' and s.cost_total = 0;
drop index if exists public.storefront_sales_si_unique;
create unique index if not exists storefront_sales_si_booklet_unique on public.storefront_sales (coalesce(si_booklet_business_id, business_id), lower(btrim(si_number)))
  where si_number is not null and status <> 'cancelled';

alter table public.storefront_returns
  add column if not exists vat_amount numeric(14,2) not null default 0,
  add column if not exists cost_total numeric(14,2) not null default 0;

alter table public.storefront_payments add column if not exists bank_account_id uuid references public.finance_bank_accounts(id);
alter table public.storefront_cash_movements add column if not exists bank_account_id uuid references public.finance_bank_accounts(id);

alter table public.storefront_closings
  add column if not exists vat_total numeric(14,2) not null default 0,
  add column if not exists journal_entry_id uuid references public.finance_journal_entries(id),
  add column if not exists posted_at timestamptz;

-- The business whose booklet a store's SIs come from (own by default)
create or replace function public.sf_booklet_business(p_business uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((select si_booklet_business_id from public.storefront_settings where business_id = p_business), p_business);
$$;
revoke all on function public.sf_booklet_business(uuid) from public, authenticated;

-- --------------------------------------- receiving account on each payment --
-- A payment names the account that received it; when it does not, the only
-- active account of that method is used. Runs before the Build 70 guard.
create or replace function public.resolve_storefront_payment_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int; v uuid; v_label text;
begin
  v_label := case new.method when 'cash' then 'cash drawer' when 'gcash' then 'GCash number' when 'maya' then 'Maya number' when 'card' then 'card account' else 'bank account' end;
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
drop trigger if exists storefront_payments_account on public.storefront_payments;
create trigger storefront_payments_account before insert on public.storefront_payments
  for each row execute function public.resolve_storefront_payment_account();
revoke all on function public.resolve_storefront_payment_account() from public, authenticated;

-- existing payments: give them the store's account for the method when there is exactly one
update public.storefront_payments p set bank_account_id = (
  select min(a.id::text)::uuid from public.finance_bank_accounts a where a.business_id = p.business_id and a.payment_method = p.method and a.status = 'active'
  having count(*) = 1)
 where p.bank_account_id is null;

-- ---------------------------------------------- store settings (UI calls) --
create or replace function public.storefront_receiving_accounts()
returns table(id uuid, payment_method text, account_code text, account_name text, mobile_number text, bank_name text, account_number_masked text, active boolean)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return query select a.id, a.payment_method, a.account_code, a.account_name, a.mobile_number, a.bank_name, a.account_number_masked, a.status = 'active'
    from public.finance_bank_accounts a where a.business_id = b and a.payment_method is not null
   order by a.payment_method, a.account_name;
end $$;

-- Business Admin: add a GCash / Maya number, a bank account for transfers, or another drawer / card account
create or replace function public.storefront_add_receiving_account(p_method text, p_name text, p_number text default null, p_bank text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v uuid; n int; v_code text; v_digits text;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can set up receiving accounts.'; end if;
  if p_method not in ('cash','gcash','maya','card','bank_transfer') then raise exception 'Choose the payment method.'; end if;
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
          case p_method when 'cash' then 'cash' when 'card' then 'clearing' when 'bank_transfer' then 'checking' else 'ewallet' end, p_method = 'cash',
          p_method, case when p_method in ('gcash','maya') then v_digits end, public.sf_default_gl(b, p_method), 'Storefront receiving account', auth.uid())
  returning id into v;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_bank_accounts', v, 'storefront_receiving_account_added', jsonb_build_object('method', p_method, 'name', p_name, 'code', v_code));
  return v;
end $$;

create or replace function public.storefront_set_receiving_account_active(p_account uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can change receiving accounts.'; end if;
  update public.finance_bank_accounts set status = case when p_active then 'active' else 'inactive' end::public.bank_account_status, updated_at = now()
   where id = p_account and business_id = b and payment_method is not null;
  if not found then raise exception 'Account not found in this store.'; end if;
end $$;

-- SI booklet: every active business, for the booklet choice
create or replace function public.storefront_booklet_options()
returns table(id uuid, code text, name text, vat_registered boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.storefront_business();
  return query select b.id, b.code, coalesce(b.trade_name, b.legal_name), b.vat_registered from public.businesses b where b.is_active order by b.code;
end $$;

create or replace function public.storefront_set_booklet(p_booklet_business uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can change Storefront settings.'; end if;
  if not exists (select 1 from public.businesses where id = p_booklet_business and is_active) then raise exception 'Business not found.'; end if;
  perform public.storefront_walk_in(b);
  update public.storefront_settings set si_booklet_business_id = nullif(p_booklet_business, b), updated_by = auth.uid(), updated_at = now() where business_id = b;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_settings', b, 'storefront_booklet_set', jsonb_build_object('booklet_business', p_booklet_business));
end $$;

-- Super Admin: VAT registration of the "Acting as" business
create or replace function public.storefront_set_vat_registered(p_registered boolean)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  if not public.is_super_admin() then raise exception 'Only the Super Admin can change a business''s VAT registration.'; end if;
  update public.businesses set vat_registered = p_registered, updated_at = now() where id = b;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'businesses', b, 'vat_registration_set', jsonb_build_object('vat_registered', p_registered));
end $$;

-- context: add the SI booklet, VAT and receiving accounts
create or replace function public.storefront_context()
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; bk record;
begin
  perform public.storefront_walk_in(b);
  select st.*, l.location_name, l.location_code into s
    from public.storefront_settings st left join public.logistics_locations l on l.id = st.location_id
   where st.business_id = b;
  select id, code, coalesce(trade_name, legal_name) as name, vat_registered into bk from public.businesses where id = public.sf_booklet_business(b);
  return jsonb_build_object('business_id', b, 'location_id', s.location_id, 'location_name', s.location_name,
    'walk_in_customer_id', s.walk_in_customer_id, 'can_approve', public.can_approve_storefront(),
    'can_setup', public.is_super_admin() or public.is_business_admin(), 'is_super_admin', public.is_super_admin(),
    'booklet_business_id', bk.id, 'booklet_code', bk.code, 'booklet_name', bk.name, 'booklet_vat', bk.vat_registered,
    'own_vat', (select vat_registered from public.businesses where id = b),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'method', a.payment_method, 'name', a.account_name, 'number', coalesce(a.mobile_number, a.account_number_masked)) order by a.account_name)
                            from public.finance_bank_accounts a where a.business_id = b and a.payment_method is not null and a.status = 'active'), '[]'::jsonb));
end $$;

-- ------------------------------------------------- payments with an account --
drop function if exists public.storefront_record_payment(uuid, text, text, numeric, text, uuid, uuid, uuid, text);
create or replace function public.storefront_record_payment(p_business uuid, p_kind text, p_method text, p_amount numeric, p_reference text,
                                                            p_sale uuid, p_invoice uuid, p_return uuid, p_note text, p_account uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_no text; v_rec uuid; v_code text; v_id uuid;
begin
  if p_method not in ('cash','gcash','maya','card','bank_transfer') then raise exception 'Unknown payment method %.', p_method; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
  if p_method <> 'cash' and coalesce(btrim(p_reference), '') = '' then raise exception 'Enter the reference number for the % payment.', case p_method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' else 'bank transfer' end; end if;
  select code into v_code from public.businesses where id = p_business;
  v_no := public.storefront_next_number(case when p_kind = 'refund' then 'SFX' else 'SFP' end, 'storefront_payments', 'payment_number');
  -- the counter payment first (its triggers check the account, the reference and refund limits)
  insert into public.storefront_payments(business_id, payment_number, kind, sale_id, ar_invoice_id, return_id, method, amount, reference_number, received_by, bank_account_id)
  values (p_business, v_no, p_kind, p_sale, p_invoice, p_return, p_method, round(p_amount, 2), nullif(btrim(p_reference), ''), auth.uid(), p_account)
  returning id into v_id;
  if p_invoice is not null and p_kind <> 'refund' then
    insert into public.finance_customer_receipts(business_id, receipt_number, invoice_id, receipt_date, amount, payment_method, reference_number, notes, status,
                                                 prepared_by, prepared_at, approved_by, approved_at, posted_by, posted_at, created_by)
    values (p_business, v_code || '-' || v_no, p_invoice, (now() at time zone 'Asia/Manila')::date, round(p_amount, 2), p_method, nullif(btrim(p_reference), ''), p_note,
            'posted', auth.uid(), now(), auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_rec;
    update public.storefront_payments set ar_receipt_id = v_rec where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.storefront_record_payment(uuid, text, text, numeric, text, uuid, uuid, uuid, text, uuid) from public, authenticated;

create or replace function public.storefront_collect_ar(p_invoice uuid, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); inv record; p record; v_total numeric := 0;
begin
  select * into inv from public.finance_customer_invoices where id = p_invoice and business_id = b for update;
  if not found then raise exception 'Invoice not found in this business.'; end if;
  if inv.status in ('paid','voided') then raise exception 'Invoice % is already %.', inv.invoice_number, inv.status; end if;
  if inv.status not in ('approved','partially_paid') then raise exception 'Invoice % is not approved yet; Finance must approve it first.', inv.invoice_number; end if;
  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text, account uuid) loop
    v_total := v_total + round(coalesce(p.amount, 0), 2);
  end loop;
  if v_total <= 0 then raise exception 'Enter the amount received.'; end if;
  if v_total > inv.balance_due then raise exception 'Payment ₱% is more than the invoice balance ₱%.', v_total, inv.balance_due; end if;
  for p in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric, reference text, account uuid) loop
    perform public.storefront_record_payment(b, 'ar_collection', p.method, p.amount, p.reference, null, inv.id, null,
                                             'Received at the counter (Storefront) for invoice ' || inv.invoice_number, p.account);
  end loop;
  perform public.recalculate_customer_invoice_received(inv.id);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customer_invoices', inv.id, 'storefront_ar_collected', jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total));
  return jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total, 'balance', inv.balance_due - v_total);
end $$;

-- ------------------------------------------- post a sale: VAT, cost, accounts --
create or replace function public.storefront_post_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record; l record; p record; v_paid numeric := 0; v_inv uuid; v_code text; v_walk uuid; v_mov uuid; v_inv_item uuid;
        v_booklet uuid; v_vat_reg boolean; v_vat numeric := 0; v_cost numeric := 0;
begin
  select * into s from public.storefront_sales where id = p_sale for update;
  select code into v_code from public.businesses where id = s.business_id;
  select walk_in_customer_id into v_walk from public.storefront_settings where business_id = s.business_id;
  v_booklet := public.sf_booklet_business(s.business_id);
  select vat_registered into v_vat_reg from public.businesses where id = v_booklet;

  -- documents
  p_si := nullif(btrim(coalesce(p_si, '')), '');
  if not coalesce(p_issue_dr, false) and p_si is null then raise exception 'Choose at least one document: DR and/or SI (enter the SI booklet number).'; end if;
  if p_si is not null and exists (select 1 from public.storefront_sales where coalesce(si_booklet_business_id, business_id) = v_booklet and id <> s.id
                                    and status <> 'cancelled' and lower(btrim(si_number)) = lower(p_si)) then
    raise exception 'SI number % is already used on this SI booklet.', p_si;
  end if;
  if p_si is not null and coalesce(v_vat_reg, false) then v_vat := round(s.total * 12 / 112, 2); end if;

  -- payments (checked again by the payment triggers)
  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text, account uuid) loop
    if p.method not in ('cash','gcash','maya','card','bank_transfer') then raise exception 'Unknown payment method %.', p.method; end if;
    if coalesce(p.amount, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
    if p.method <> 'cash' and coalesce(btrim(p.reference), '') = '' then raise exception 'Enter the reference number for the % payment.', case p.method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' else 'bank transfer' end; end if;
    v_paid := v_paid + round(p.amount, 2);
  end loop;
  if v_paid > s.total then raise exception 'Payments (₱%) are more than the sale total (₱%). Record only the amount applied; give change for cash.', v_paid, s.total; end if;
  if s.total - v_paid > 0 and s.customer_id = v_walk then
    raise exception 'A charge or partly paid sale needs a named customer, not Walk-in.';
  end if;

  select coalesce(round(sum(quantity * coalesce(acquisition_cost, 0)), 2), 0) into v_cost from public.storefront_sale_items where sale_id = s.id and item_type <> 'service';
  update public.storefront_sales
     set status = 'completed', si_number = p_si, issue_dr = coalesce(p_issue_dr, false),
         si_booklet_business_id = case when p_si is not null then v_booklet end, vat_applied = v_vat > 0, vat_amount = v_vat, cost_total = v_cost,
         dr_number = case when coalesce(p_issue_dr, false) then public.storefront_next_number('DR', 'storefront_sales', 'dr_number') end,
         amount_paid = v_paid, balance = s.total - v_paid, completed_by = auth.uid(), completed_at = now()
   where id = s.id;

  -- stock issue from the store's location
  for l in select * from public.storefront_sale_items where sale_id = s.id and item_type <> 'service' loop
    v_inv_item := public.ensure_inventory_link(l.item_id, s.business_id);
    insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
    values (s.business_id, v_inv_item, s.location_id, s.sale_date, 'issue', l.quantity, round(coalesce(l.acquisition_cost, 0), 4), 'storefront_sales', s.id, s.sale_number, 'Storefront sale', auth.uid())
    returning id into v_mov;
    update public.storefront_sale_items set inventory_item_id = v_inv_item, stock_movement_id = v_mov where id = l.id;
  end loop;

  -- AR invoice for a charge / partly paid sale; with VAT the invoice shows it
  -- (subtotal net of VAT + tax = the same VAT-inclusive total)
  if s.total - v_paid > 0 then
    insert into public.finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, subtotal, tax_amount, discount_amount, amount_received, status, notes, prepared_by, prepared_at, approved_by, approved_at, created_by)
    values (s.business_id, v_code || '-' || coalesce('SI-' || p_si, s.sale_number), s.customer_id, s.sale_date, s.total - v_vat, v_vat, 0, v_paid, 'approved',
            'Storefront sale ' || s.sale_number || coalesce(', SI ' || p_si, '') || case when v_vat > 0 then ' (VAT-inclusive; VAT ₱' || v_vat || ')' else '' end,
            auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_inv;
    insert into public.finance_customer_invoice_items(business_id, invoice_id, description, quantity, unit, unit_price)
    select s.business_id, v_inv, description, quantity, unit,
           case when v_vat > 0 then round(unit_price * 100 / 112, 2) else unit_price end
      from public.storefront_sale_items where sale_id = s.id;
    update public.storefront_sales set ar_invoice_id = v_inv where id = s.id;
  end if;

  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text, account uuid) loop
    perform public.storefront_record_payment(s.business_id, 'sale', p.method, p.amount, p.reference, s.id, v_inv, null,
                                             'Paid at the counter, Storefront sale ' || s.sale_number, p.account);
  end loop;
  if v_inv is not null then perform public.recalculate_customer_invoice_received(v_inv); end if;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_completed',
          jsonb_build_object('sale_number', s.sale_number, 'total', s.total, 'paid', v_paid, 'ar_invoice_id', v_inv, 'si_number', p_si, 'vat', v_vat));
end $$;
revoke all on function public.storefront_post_sale(uuid, jsonb, text, boolean) from public, authenticated;

-- ------------------------------------------------ returns: VAT, cost, account --
create or replace function public.storefront_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; l record; si record; r record; v_ret uuid; v_no text;
        v_total numeric := 0; v_credit numeric := 0; v_refund numeric := 0; v_paid_refund numeric := 0; v_bal numeric := 0; v_mov uuid; v_inv_item uuid; v_done numeric;
        v_cost numeric := 0; v_vat numeric := 0;
begin
  select * into s from public.storefront_sales where id = (p->>'sale_id')::uuid and business_id = b for update;
  if not found then raise exception 'Sale not found in this store.'; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be returned.'; end if;
  if coalesce(btrim(p->>'reason'), '') = '' then raise exception 'Enter the reason for the return.'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Choose at least one item to return.'; end if;

  v_no := public.storefront_next_number('SFR', 'storefront_returns', 'return_number');
  insert into public.storefront_returns(business_id, return_number, sale_id, reason, created_by)
  values (b, v_no, s.id, btrim(p->>'reason'), auth.uid()) returning id into v_ret;

  for l in select * from jsonb_to_recordset(p->'lines') as x(sale_item_id uuid, quantity numeric) loop
    if coalesce(l.quantity, 0) <= 0 then continue; end if;
    select * into si from public.storefront_sale_items where id = l.sale_item_id and sale_id = s.id;
    if not found then raise exception 'An item on the return is not on sale %.', s.sale_number; end if;
    select coalesce(sum(quantity), 0) into v_done from public.storefront_return_items where sale_item_id = si.id;
    if l.quantity > si.quantity - v_done then
      raise exception 'Only % of % can still be returned.', (si.quantity - v_done)::text, si.description;
    end if;
    v_mov := null;
    if si.item_type <> 'service' then
      v_inv_item := coalesce(si.inventory_item_id, public.ensure_inventory_link(si.item_id, b));
      insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
      values (b, v_inv_item, s.location_id, (now() at time zone 'Asia/Manila')::date, 'adjustment', l.quantity, round(coalesce(si.acquisition_cost, 0), 4), 'storefront_returns', v_ret, v_no,
              'Storefront return of ' || s.sale_number || ': ' || btrim(p->>'reason'), auth.uid())
      returning id into v_mov;
      v_cost := v_cost + round(l.quantity * coalesce(si.acquisition_cost, 0), 2);
    end if;
    insert into public.storefront_return_items(business_id, return_id, sale_item_id, quantity, unit_price, line_total, stock_movement_id)
    values (b, v_ret, si.id, l.quantity, si.unit_price, round(l.quantity * si.unit_price, 2), v_mov);
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

  for r in select * from jsonb_to_recordset(coalesce(p->'refunds', '[]'::jsonb)) as x(method text, amount numeric, reference text, account uuid) loop
    if coalesce(r.amount, 0) <= 0 then continue; end if;
    perform public.storefront_record_payment(b, 'refund', r.method, r.amount, r.reference, s.id, null, v_ret, 'Refund for return ' || v_no, r.account);
    v_paid_refund := v_paid_refund + round(r.amount, 2);
  end loop;
  if v_paid_refund <> v_refund then
    raise exception 'Refund to give is ₱% (returned ₱%, of which ₱% reduces the unpaid balance); the refund entered is ₱%.', v_refund, v_total, v_credit, v_paid_refund;
  end if;

  update public.storefront_returns set total = v_total, credit_to_ar = v_credit, refund_total = v_refund, vat_amount = v_vat, cost_total = v_cost where id = v_ret;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_returns', v_ret, 'storefront_return', jsonb_build_object('return_number', v_no, 'sale_number', s.sale_number, 'total', v_total, 'credit_to_ar', v_credit, 'refund', v_refund, 'vat', v_vat, 'reason', btrim(p->>'reason')));
  return jsonb_build_object('id', v_ret, 'return_number', v_no, 'total', v_total, 'credit_to_ar', v_credit, 'refund', v_refund);
end $$;

-- cash taken out: a bank deposit names the bank account it went into
drop function if exists public.storefront_cash_movement(text, numeric, text, text);
create or replace function public.storefront_cash_movement(p_kind text, p_amount numeric, p_category text default null, p_note text default null, p_bank_account uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v_no text; v_id uuid; v_bank uuid := p_bank_account; n int;
begin
  if p_kind not in ('float','cash_out') then raise exception 'Unknown drawer entry.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if p_kind = 'cash_out' then
    if coalesce(p_category, '') not in ('bank_deposit','petty_cash','other') then raise exception 'Choose what the cash was taken out for.'; end if;
    if p_category = 'other' and coalesce(btrim(p_note), '') = '' then raise exception 'Explain what the cash was taken out for.'; end if;
    if p_category = 'bank_deposit' then
      if v_bank is null then
        select count(*), min(id::text)::uuid into n, v_bank from public.finance_bank_accounts where business_id = b and payment_method = 'bank_transfer' and status = 'active';
        if n = 0 then raise exception 'Set up the store''s bank account first (Store settings → Receiving accounts, "Bank transfer").'; end if;
        if n > 1 then raise exception 'Choose the bank account the cash was deposited to.'; end if;
      elsif not exists (select 1 from public.finance_bank_accounts where id = v_bank and business_id = b and payment_method = 'bank_transfer' and status = 'active') then
        raise exception 'Choose an active bank account of this store.';
      end if;
    else v_bank := null;
    end if;
  else v_bank := null;
  end if;
  v_no := public.storefront_next_number('SFM', 'storefront_cash_movements', 'movement_number');
  insert into public.storefront_cash_movements(business_id, movement_number, kind, category, amount, note, bank_account_id, created_by)
  values (b, v_no, p_kind, case when p_kind = 'cash_out' then p_category end, round(p_amount, 2), nullif(btrim(coalesce(p_note, '')), ''), v_bank, auth.uid())
  returning id into v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_cash_movements', v_id, 'storefront_' || p_kind, jsonb_build_object('number', v_no, 'amount', p_amount, 'category', p_category, 'note', p_note));
  return jsonb_build_object('id', v_id, 'movement_number', v_no);
end $$;

-- ------------------------------------------------------ closing totals + VAT --
create or replace function public.storefront_closing_totals(p_business uuid, p_date date, p_closing uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m jsonb; v_float numeric; v_out numeric; v_sales_vat numeric; v_ret_vat numeric;
begin
  select coalesce(jsonb_object_agg(method, net), '{}'::jsonb) into m from (
    select method, sum(case when kind = 'refund' then -amount else amount end) as net
      from public.storefront_payments
     where business_id = p_business
       and case when p_closing is null then closing_id is null and (received_at at time zone 'Asia/Manila')::date <= p_date else closing_id = p_closing end
     group by method) x;
  select coalesce(sum(amount) filter (where kind = 'float'), 0), coalesce(sum(amount) filter (where kind = 'cash_out'), 0) into v_float, v_out
    from public.storefront_cash_movements
   where business_id = p_business
     and case when p_closing is null then closing_id is null and movement_date <= p_date else closing_id = p_closing end;
  select coalesce(sum(vat_amount), 0) into v_sales_vat from public.storefront_sales where business_id = p_business and status = 'completed'
     and case when p_closing is null then closing_id is null and sale_date <= p_date else closing_id = p_closing end;
  select coalesce(sum(vat_amount), 0) into v_ret_vat from public.storefront_returns where business_id = p_business
     and case when p_closing is null then closing_id is null and return_date <= p_date else closing_id = p_closing end;
  return jsonb_build_object(
    'by_method', m,
    'float_total', v_float,
    'cash_out_total', v_out,
    'expected_cash', v_float + coalesce((m->>'cash')::numeric, 0) - v_out,
    'vat_total', v_sales_vat - v_ret_vat,
    'sales_count', (select count(*) from public.storefront_sales where business_id = p_business and status = 'completed'
                      and case when p_closing is null then closing_id is null and sale_date <= p_date else closing_id = p_closing end),
    'sales_total', coalesce((select sum(total) from public.storefront_sales where business_id = p_business and status = 'completed'
                      and case when p_closing is null then closing_id is null and sale_date <= p_date else closing_id = p_closing end), 0),
    'charged_to_ar', coalesce((select sum(balance) from public.storefront_sales where business_id = p_business and status = 'completed'
                      and case when p_closing is null then closing_id is null and sale_date <= p_date else closing_id = p_closing end), 0),
    'returns_total', coalesce((select sum(total) from public.storefront_returns where business_id = p_business
                      and case when p_closing is null then closing_id is null and return_date <= p_date else closing_id = p_closing end), 0),
    'ar_collected', coalesce((select sum(amount) from public.storefront_payments where business_id = p_business and kind = 'ar_collection'
                      and case when p_closing is null then closing_id is null and (received_at at time zone 'Asia/Manila')::date <= p_date else closing_id = p_closing end), 0));
end $$;
revoke all on function public.storefront_closing_totals(uuid, date, uuid) from public, authenticated;

create or replace function public.storefront_close_day(p_date date, p_counted_cash numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); t jsonb; v_id uuid; v_no text; v_var numeric;
begin
  if p_date is null or p_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Choose today or an earlier date.'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the cash counted in the drawer.'; end if;
  if exists (select 1 from public.storefront_closings where business_id = b and closing_date = p_date and status <> 'returned') then
    raise exception 'This day is already closed (or waiting for approval).';
  end if;
  v_no := public.storefront_next_number('SFC', 'storefront_closings', 'closing_number');
  insert into public.storefront_closings(business_id, closing_number, closing_date, counted_cash, notes, submitted_by)
  values (b, v_no, p_date, round(p_counted_cash, 2), nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;
  update public.storefront_payments set closing_id = v_id where business_id = b and closing_id is null and (received_at at time zone 'Asia/Manila')::date <= p_date;
  update public.storefront_sales set closing_id = v_id where business_id = b and status = 'completed' and closing_id is null and sale_date <= p_date;
  update public.storefront_returns set closing_id = v_id where business_id = b and closing_id is null and return_date <= p_date;
  update public.storefront_cash_movements set closing_id = v_id where business_id = b and closing_id is null and movement_date <= p_date;
  t := public.storefront_closing_totals(b, p_date, v_id);
  v_var := round(p_counted_cash, 2) - (t->>'expected_cash')::numeric;
  update public.storefront_closings
     set sales_count = (t->>'sales_count')::int, sales_total = (t->>'sales_total')::numeric, returns_total = (t->>'returns_total')::numeric,
         charged_to_ar = (t->>'charged_to_ar')::numeric, ar_collected = (t->>'ar_collected')::numeric, by_method = t->'by_method',
         float_total = (t->>'float_total')::numeric, cash_out_total = (t->>'cash_out_total')::numeric, vat_total = (t->>'vat_total')::numeric,
         expected_cash = (t->>'expected_cash')::numeric, variance = v_var
   where id = v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', v_id, 'storefront_day_closed', jsonb_build_object('closing_number', v_no, 'date', p_date, 'expected_cash', t->>'expected_cash', 'counted_cash', p_counted_cash));
  return jsonb_build_object('id', v_id, 'closing_number', v_no, 'variance', v_var);
end $$;

-- ---------------------------------------------- posting an approved closing --
create or replace function public.sf_jadd(j jsonb, k uuid, v numeric)
returns jsonb language sql immutable as $$
  select case when coalesce(v, 0) = 0 then j else j || jsonb_build_object(k::text, coalesce((j->>k::text)::numeric, 0) + v) end;
$$;
-- key: bank account (Bank/Cash) and its signed amount, for the Bank/Cash transactions
create or replace function public.sf_badd(j jsonb, k uuid, v numeric)
returns jsonb language sql immutable as $$
  select case when k is null or coalesce(v, 0) = 0 then j else j || jsonb_build_object(k::text, coalesce((j->>k::text)::numeric, 0) + v) end;
$$;

create or replace function public.storefront_post_closing(p_closing uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; b uuid; v_code text; gl jsonb := '{}'; bank jsonb := '{}'; p record; x record; v_je uuid; v_jno text;
        v_rev_net numeric; v_vat numeric; v_ret_net numeric; v_ret_vat numeric; v_ar_charged numeric; v_ar_credit numeric; v_ar_coll numeric;
        v_cogs numeric; v_ret_cost numeric; v_drawer uuid; v_drawer_gl uuid; d numeric; cr numeric; v_section uuid; v_tno text;
begin
  select * into c from public.storefront_closings where id = p_closing for update;
  if c.journal_entry_id is not null then return c.journal_entry_id; end if;
  b := c.business_id;
  select code into v_code from public.businesses where id = b;
  select id into v_section from public.sections where code = 'sales';
  select id, coalesce(gl_account_id, public.sf_gl(b, '1000')) into v_drawer, v_drawer_gl
    from public.finance_bank_accounts where business_id = b and payment_method = 'cash' and status = 'active' order by (account_code = 'SF-CASH') desc limit 1;
  if v_drawer_gl is null then v_drawer_gl := public.sf_gl(b, '1000'); end if;

  -- money in / out by receiving account
  for p in select sp.*, a.gl_account_id from public.storefront_payments sp left join public.finance_bank_accounts a on a.id = sp.bank_account_id
            where sp.closing_id = c.id loop
    gl := public.sf_jadd(gl, coalesce(p.gl_account_id, public.sf_default_gl(b, p.method)), case when p.kind = 'refund' then -p.amount else p.amount end);
    bank := public.sf_badd(bank, p.bank_account_id, case when p.kind = 'refund' then -p.amount else p.amount end);
  end loop;

  -- sales, VAT, AR
  select coalesce(sum(total - vat_amount), 0), coalesce(sum(vat_amount), 0), coalesce(sum(balance), 0), coalesce(sum(cost_total), 0)
    into v_rev_net, v_vat, v_ar_charged, v_cogs from public.storefront_sales where closing_id = c.id and status = 'completed';
  select coalesce(sum(total - vat_amount), 0), coalesce(sum(vat_amount), 0), coalesce(sum(credit_to_ar), 0), coalesce(sum(cost_total), 0)
    into v_ret_net, v_ret_vat, v_ar_credit, v_ret_cost from public.storefront_returns where closing_id = c.id;
  select coalesce(sum(amount), 0) into v_ar_coll from public.storefront_payments where closing_id = c.id and kind = 'ar_collection';

  gl := public.sf_jadd(gl, public.sf_gl(b, '4000'), -v_rev_net);          -- Cr sales (net of VAT)
  gl := public.sf_jadd(gl, public.sf_gl(b, '2210'), -v_vat);              -- Cr output VAT
  gl := public.sf_jadd(gl, public.sf_gl(b, '4010'), v_ret_net);           -- Dr sales returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '2210'), v_ret_vat);           -- Dr output VAT on returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '1100'), v_ar_charged - v_ar_coll - v_ar_credit); -- AR: charged − collected − credited by returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '5000'), v_cogs - v_ret_cost); -- Dr cost of sales
  gl := public.sf_jadd(gl, public.sf_gl(b, '1200'), v_ret_cost - v_cogs); -- Cr inventory

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

create or replace function public.storefront_decide_closing(p_closing uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); c record;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver or Business Admin can approve a daily closing.'; end if;
  select * into c from public.storefront_closings where id = p_closing and business_id = b for update;
  if not found then raise exception 'Closing not found.'; end if;
  if c.status <> 'submitted' then raise exception 'This closing was already decided.'; end if;
  if c.submitted_by = auth.uid() and not public.is_super_admin() then
    raise exception 'You submitted this closing, so another approver must review it.';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Say why the closing is returned (e.g. recount the cash).'; end if;
  if p_approve then
    update public.storefront_closings set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = c.id;
    perform public.storefront_post_closing(c.id);
  else
    update public.storefront_closings set status = 'returned', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where id = c.id;
    update public.storefront_payments set closing_id = null where closing_id = c.id;
    update public.storefront_sales set closing_id = null where closing_id = c.id;
    update public.storefront_returns set closing_id = null where closing_id = c.id;
    update public.storefront_cash_movements set closing_id = null where closing_id = c.id;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', c.id, case when p_approve then 'storefront_closing_approved' else 'storefront_closing_returned' end,
          jsonb_build_object('closing_number', c.closing_number, 'variance', c.variance, 'note', p_note));
end $$;

-- Journal number of each closing, for the Storefront screen (Sales cannot read journals)
create or replace function public.storefront_closing_journals()
returns table(closing_id uuid, journal_number text, journal_status text)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return query select c.id, j.journal_number, j.status::text from public.storefront_closings c join public.finance_journal_entries j on j.id = c.journal_entry_id where c.business_id = b;
end $$;

-- ------------------------------------------------ monthly sales: counter sales --
alter table public.sales_monthly_revenue_summary
  add column if not exists counter_sales numeric(14,2) not null default 0,
  add column if not exists counter_collected numeric(14,2) not null default 0;

create or replace function public.refresh_sales_monthly_revenue_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_section uuid; v_start date; v_end date; v_orders integer; v_revenue numeric(14,2); v_ar numeric(14,2); v_cash numeric(14,2); v_comm numeric(14,2); v_comm_approved numeric(14,2); b uuid;
        v_counter numeric(14,2); v_counter_cash numeric(14,2);
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
    select coalesce(sum(sc.commission_amount),0), coalesce(sum(sc.commission_amount) filter(where sc.status in ('approved','paid')),0) into v_comm,v_comm_approved
      from public.sales_commissions sc join public.sales_orders so on so.id=sc.sales_order_id
      where so.business_id=b and so.order_date >= v_start and so.order_date < v_end;
    -- Build 71: counter sales (completed, less returns) and the money received at the counter
    select coalesce((select sum(total) from public.storefront_sales where business_id=b and status='completed' and sale_date >= v_start and sale_date < v_end), 0)
         - coalesce((select sum(total) from public.storefront_returns where business_id=b and return_date >= v_start and return_date < v_end), 0)
      into v_counter;
    select coalesce(sum(case when kind='refund' then -amount else amount end), 0) into v_counter_cash
      from public.storefront_payments where business_id=b and (received_at at time zone 'Asia/Manila')::date >= v_start and (received_at at time zone 'Asia/Manila')::date < v_end;
    insert into public.sales_monthly_revenue_summary(business_id,section_id,year,month,fulfilled_orders,gross_revenue,ar_invoiced,cash_collected,commission_accrued,commission_approved,counter_sales,counter_collected,updated_at)
    values(b,v_section,p_year,p_month,v_orders,v_revenue+v_counter,v_ar,v_cash+v_counter_cash,v_comm,v_comm_approved,v_counter,v_counter_cash,now())
    on conflict(business_id,section_id,year,month) do update set
      fulfilled_orders=excluded.fulfilled_orders,gross_revenue=excluded.gross_revenue,ar_invoiced=excluded.ar_invoiced,
      cash_collected=excluded.cash_collected,commission_accrued=excluded.commission_accrued,commission_approved=excluded.commission_approved,
      counter_sales=excluded.counter_sales,counter_collected=excluded.counter_collected,updated_at=now();
  end loop;
end; $$;

grant execute on function public.storefront_receiving_accounts(), public.storefront_add_receiving_account(text, text, text, text),
  public.storefront_set_receiving_account_active(uuid, boolean), public.storefront_booklet_options(), public.storefront_set_booklet(uuid),
  public.storefront_set_vat_registered(boolean), public.storefront_cash_movement(text, numeric, text, text, uuid), public.storefront_closing_journals()
  to authenticated;
