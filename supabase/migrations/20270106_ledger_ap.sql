-- Build 99 (part 1 of the ledger work) — standard double-entry for purchasing, payables and opening balances:
--   goods received into stock      Dr 1200 Inventory                Cr 2010 Goods Received Not Billed (at the receipt cost)
--   supplier bill (with a PO)      Dr 2010 (PO cost of the billed lines) + Dr/Cr 1200 (price difference, freight) + Dr 1320 Input VAT
--                                  Cr 2000 Accounts Payable
--   supplier bill (no PO)          Dr 5200 Operating Expenses + Dr 1320 Input VAT       Cr 2000
--   opening bill (before go-live)  Dr 3900 Opening Balance Equity                      Cr 2000
--   supplier payment on a bill     Dr 2000                          Cr the cash / bank account it was paid from
--   payment on a PO (no bill yet)  Dr 1310 Advances to Suppliers    Cr cash / bank; applied to the bill later: Dr 2000 Cr 1310
--   opening stock count            Dr/Cr 1200 for the stock it adds / removes, against 3900 (first count of the store)
--                                  or 5020 Inventory Count Adjustments (later counts)
--   voiding a bill / payment reverses its entry. Each document posts once (its journal id is kept on it).
-- Existing approved bills, posted payments, posted receipts and approved counts are booked once, at their own dates.

-- ------------------------------------------------------------------ accounts (placeholders the accountant may rename)
create or replace function public.fin_ensure_accounts(p_business uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
  select p_business, a.code, a.name, a.type::public.finance_account_type, a.descr
    from (values
      ('1000','Cash on Hand','asset',null), ('1010','Bank Accounts','asset',null), ('1020','E-Wallets (GCash / Maya)','asset',null),
      ('1100','Accounts Receivable','asset',null), ('1200','Inventory','asset',null),
      ('1310','Advances to Suppliers','asset','Payments on purchase orders before the supplier bill'),
      ('1320','Input VAT','asset','VAT on supplier bills'),
      ('2000','Accounts Payable','liability',null),
      ('2010','Goods Received Not Billed','liability','Stock received; supplier bill not yet registered'),
      ('2100','Payroll Liabilities','liability',null),
      ('2101','SSS Payable','liability','SSS contributions withheld'), ('2102','PhilHealth Payable','liability','PhilHealth contributions withheld'),
      ('2103','Pag-IBIG Payable','liability','Pag-IBIG contributions withheld'), ('2104','Withholding Tax Payable','liability','Tax withheld from salaries'),
      ('2105','Salaries Payable','liability','Net pay due to employees'),
      ('2210','Output VAT Payable','liability',null),
      ('3900','Opening Balance Equity','equity','Balances brought in at go-live (AR, AP, stock)'),
      ('4000','Sales Revenue','revenue',null),
      ('5000','Cost of Sales','expense',null),
      ('5020','Inventory Count Adjustments','expense','Stock found / lost in later stock counts'),
      ('5100','Payroll Expense','expense',null),
      ('5200','Operating Expenses','expense',null)
    ) a(code, name, type, descr)
   where p_business is not null
     and not exists (select 1 from public.finance_chart_of_accounts c where c.business_id = p_business and c.account_code = a.code);
$$;
revoke all on function public.fin_ensure_accounts(uuid) from public;
do $$ declare b uuid; begin for b in select id from public.businesses loop perform public.fin_ensure_accounts(b); end loop; end $$;

-- ------------------------------------------------------------------ automatic, posted journal entries
-- p_lines = [{"code":"1200","debit":100,"credit":0,"text":"…"}, …]; posted at once (these are system entries of approved documents)
create or replace function public.fin_auto_journal(p_business uuid, p_date date, p_desc text, p_source text, p_source_id uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_code text; v_jno text; v_je uuid; d numeric := 0; c numeric := 0; x jsonb; v_period text;
begin
  perform public.fin_ensure_accounts(p_business);
  select coalesce(sum(round(coalesce((l->>'debit')::numeric, 0), 2)), 0), coalesce(sum(round(coalesce((l->>'credit')::numeric, 0), 2)), 0)
    into d, c from jsonb_array_elements(p_lines) l;
  if d = 0 and c = 0 then return null; end if;               -- nothing to book
  if d <> c then raise exception 'Ledger entry does not balance (debit % / credit %): %.', d, c, p_desc; end if;
  select status into v_period from public.finance_accounting_periods
   where business_id = p_business and year = extract(year from p_date)::int and month = extract(month from p_date)::int;
  if v_period = 'closed' then raise exception 'The accounting period of % is closed; % cannot be booked.', to_char(p_date, 'FMMonth YYYY'), p_desc; end if;
  select code into v_code from public.businesses where id = p_business;
  v_jno := public.storefront_next_number(coalesce(v_code, 'BIZ') || '-GLJ', 'finance_journal_entries', 'journal_number');
  insert into public.finance_journal_entries(business_id, journal_number, entry_date, description, source_module, source_record_id, section_id, status,
                                             total_debit, total_credit, prepared_by, prepared_at, approved_by, approved_at, posted_by, posted_at, created_by)
  values (p_business, v_jno, p_date, left(p_desc, 300), p_source, p_source_id, (select id from public.sections where code = 'finance'), 'posted',
          d, c, auth.uid(), now(), auth.uid(), now(), auth.uid(), now(), auth.uid())
  returning id into v_je;
  for x in select * from jsonb_array_elements(p_lines) loop
    if round(coalesce((x->>'debit')::numeric, 0), 2) <> 0 or round(coalesce((x->>'credit')::numeric, 0), 2) <> 0 then
      insert into public.finance_journal_lines(business_id, journal_entry_id, account_id, line_description, debit, credit, department)
      values (p_business, v_je, public.sf_gl(p_business, x->>'code'), left(coalesce(x->>'text', p_desc), 300),
              round(coalesce((x->>'debit')::numeric, 0), 2), round(coalesce((x->>'credit')::numeric, 0), 2), 'Finance');
    end if;
  end loop;
  -- the dashboard summary refreshes for a signed-in user; the catch-up below (no user) refreshes on the month's next entry
  if auth.uid() is not null then perform public.refresh_financial_summary_from_ledger(p_date, p_business); end if;
  return v_je;
end $$;
revoke all on function public.fin_auto_journal(uuid, date, text, text, uuid, jsonb) from public;

-- the reverse of an entry (voiding a document)
create or replace function public.fin_reverse_journal(p_je uuid, p_date date, p_desc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare j record; v_lines jsonb;
begin
  select * into j from public.finance_journal_entries where id = p_je;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('code', a.account_code, 'debit', l.credit, 'credit', l.debit, 'text', 'Reversal: ' || coalesce(l.line_description, ''))), '[]'::jsonb)
    into v_lines from public.finance_journal_lines l join public.finance_chart_of_accounts a on a.id = l.account_id where l.journal_entry_id = p_je;
  return public.fin_auto_journal(j.business_id, p_date, p_desc, coalesce(j.source_module, 'journal') || '_reversal', j.source_record_id, v_lines);
end $$;
revoke all on function public.fin_reverse_journal(uuid, date, text) from public;

-- which ledger account money left / came in through: the chosen bank / cash account, else by payment method
create or replace function public.fin_cash_code(p_business uuid, p_bank_account uuid, p_method text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce((select account_code from public.finance_chart_of_accounts where id = a.gl_account_id),
                     case when a.is_cash_on_hand then '1000' when a.account_type::text ilike '%wallet%' or a.payment_method::text ilike any (array['%gcash%','%maya%']) then '1020' else '1010' end)
       from public.finance_bank_accounts a where a.id = p_bank_account and a.business_id = p_business),
    case when lower(coalesce(p_method, '')) like '%cash%' then '1000'
         when lower(coalesce(p_method, '')) similar to '%(gcash|maya|wallet)%' then '1020'
         else '1010' end);
$$;
revoke all on function public.fin_cash_code(uuid, uuid, text) from public;

-- ------------------------------------------------------------------ links from the documents to their entries
alter table public.finance_supplier_invoices add column if not exists is_opening boolean not null default false;
alter table public.finance_supplier_invoices add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.finance_supplier_invoices add column if not exists reversal_journal_id uuid references public.finance_journal_entries(id);
alter table public.finance_supplier_payments add column if not exists bank_account_id uuid references public.finance_bank_accounts(id);
alter table public.finance_supplier_payments add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.finance_supplier_payments add column if not exists reversal_journal_id uuid references public.finance_journal_entries(id);
alter table public.finance_supplier_payment_applications add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.logistics_receipts add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.inventory_opening_counts add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);

-- ------------------------------------------------------------------ the entries
create or replace function public.fin_supplier_invoice_lines(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i record; v_total numeric; v_tax numeric; v_po numeric; v_who text;
begin
  select si.*, s.legal_name as supplier into i from public.finance_supplier_invoices si left join public.finance_suppliers s on s.id = si.supplier_id where si.id = p_invoice;
  v_tax := round(coalesce(i.tax_amount, 0), 2);
  v_total := round(coalesce(i.subtotal, 0) + v_tax + coalesce(i.other_charges, 0), 2);
  v_who := coalesce(i.supplier, 'Supplier') || ' — ' || i.invoice_number;
  if i.is_opening then
    return jsonb_build_array(jsonb_build_object('code', '3900', 'debit', v_total, 'text', 'Opening balance: ' || v_who),
                             jsonb_build_object('code', '2000', 'credit', v_total, 'text', v_who));
  end if;
  if i.purchase_order_id is not null then
    -- the PO cost of the billed lines clears "received not billed"; any price difference and freight go to inventory
    select round(coalesce(sum(it.quantity * coalesce(pi.unit_cost, it.unit_cost)), 0), 2) into v_po
      from public.finance_supplier_invoice_items it left join public.purchase_order_items pi on pi.id = it.purchase_order_item_id
     where it.invoice_id = i.id and it.purchase_order_item_id is not null;
    if coalesce(v_po, 0) = 0 then v_po := round(v_total - v_tax - coalesce(i.other_charges, 0), 2); end if;
    return jsonb_build_array(jsonb_build_object('code', '2010', 'debit', v_po, 'text', 'Received goods billed: ' || v_who),
                             jsonb_build_object('code', '1200', 'debit', v_total - v_tax - v_po, 'text', 'Price difference / freight: ' || v_who),
                             jsonb_build_object('code', '1320', 'debit', v_tax, 'text', 'Input VAT: ' || v_who),
                             jsonb_build_object('code', '2000', 'credit', v_total, 'text', v_who));
  end if;
  return jsonb_build_array(jsonb_build_object('code', '5200', 'debit', v_total - v_tax, 'text', v_who),
                           jsonb_build_object('code', '1320', 'debit', v_tax, 'text', 'Input VAT: ' || v_who),
                           jsonb_build_object('code', '2000', 'credit', v_total, 'text', v_who));
end $$;
revoke all on function public.fin_supplier_invoice_lines(uuid) from public;

-- a negative amount on a line flips it to the other side (e.g. a bill cheaper than the PO credits inventory)
create or replace function public.fin_norm_lines(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(case when coalesce((l->>'debit')::numeric, 0) < 0 or coalesce((l->>'credit')::numeric, 0) < 0
                                 then jsonb_build_object('code', l->>'code', 'text', l->>'text',
                                        'debit', greatest(-coalesce((l->>'credit')::numeric, 0), 0) + greatest(coalesce((l->>'debit')::numeric, 0), 0),
                                        'credit', greatest(-coalesce((l->>'debit')::numeric, 0), 0) + greatest(coalesce((l->>'credit')::numeric, 0), 0))
                                 else l end), '[]'::jsonb)
    from jsonb_array_elements(p) l;
$$;

create or replace function public.fin_supplier_invoice_ledger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.journal_entry_id is null and new.status::text in ('approved', 'partially_paid', 'paid') then
    new.journal_entry_id := public.fin_auto_journal(new.business_id, coalesce(new.invoice_date, (now() at time zone 'Asia/Manila')::date),
      case when new.is_opening then 'Opening supplier balance ' else 'Supplier bill ' end || new.invoice_number, 'ap_invoice', new.id,
      public.fin_norm_lines(public.fin_supplier_invoice_lines(new.id)));
  elsif new.status::text = 'voided' and new.journal_entry_id is not null and new.reversal_journal_id is null then
    new.reversal_journal_id := public.fin_reverse_journal(new.journal_entry_id, (now() at time zone 'Asia/Manila')::date, 'Voided supplier bill ' || new.invoice_number);
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_invoices_ledger on public.finance_supplier_invoices;
create trigger finance_supplier_invoices_ledger before update of status on public.finance_supplier_invoices
  for each row execute function public.fin_supplier_invoice_ledger();

-- a chosen bank / cash account arrives in the old text field too (its id): keep the link and show the name
create or replace function public.fin_supplier_payment_account() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.bank_account ~ '^[0-9a-f-]{36}$' then
    select * into a from public.finance_bank_accounts where id = new.bank_account::uuid and business_id = new.business_id;
    if found then new.bank_account_id := a.id; new.bank_account := a.account_name; end if;
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_payments_account on public.finance_supplier_payments;
create trigger finance_supplier_payments_account before insert or update of bank_account on public.finance_supplier_payments
  for each row execute function public.fin_supplier_payment_account();

create or replace function public.fin_supplier_payment_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  v_who := coalesce((select legal_name from public.finance_suppliers s join public.finance_supplier_invoices i on i.supplier_id = s.id where i.id = new.invoice_id),
                    (select legal_name from public.finance_suppliers s join public.purchase_orders o on o.supplier_id = s.id where o.id = new.purchase_order_id), 'Supplier')
           || ' — ' || new.payment_number;
  if new.journal_entry_id is null and new.status::text = 'posted' then
    new.journal_entry_id := public.fin_auto_journal(new.business_id, coalesce(new.payment_date, (now() at time zone 'Asia/Manila')::date),
      'Supplier payment ' || new.payment_number, 'ap_payment', new.id, jsonb_build_array(
        jsonb_build_object('code', case when new.invoice_id is not null then '2000' else '1310' end, 'debit', new.amount,
                           'text', case when new.invoice_id is not null then v_who else 'Advance on PO: ' || v_who end),
        jsonb_build_object('code', public.fin_cash_code(new.business_id, new.bank_account_id, new.payment_method::text), 'credit', new.amount, 'text', v_who)));
  elsif new.status::text = 'voided' and new.journal_entry_id is not null and new.reversal_journal_id is null then
    new.reversal_journal_id := public.fin_reverse_journal(new.journal_entry_id, (now() at time zone 'Asia/Manila')::date, 'Voided supplier payment ' || new.payment_number);
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_payments_ledger on public.finance_supplier_payments;
create trigger finance_supplier_payments_ledger before update of status on public.finance_supplier_payments
  for each row execute function public.fin_supplier_payment_ledger();

-- a PO payment applied to the bill: the advance becomes a payment of the payable
create or replace function public.fin_payment_application_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if tg_op = 'INSERT' then
    select * into p from public.finance_supplier_payments where id = new.payment_id;
    if p.invoice_id is null and p.journal_entry_id is not null and new.amount <> 0 then
      new.journal_entry_id := public.fin_auto_journal(new.business_id, (now() at time zone 'Asia/Manila')::date, 'Advance applied to bill — ' || p.payment_number,
        'ap_advance_applied', new.id, jsonb_build_array(jsonb_build_object('code', '2000', 'debit', new.amount, 'text', 'Advance ' || p.payment_number || ' applied'),
                                                         jsonb_build_object('code', '1310', 'credit', new.amount, 'text', 'Advance ' || p.payment_number || ' applied')));
    end if;
    return new;
  end if;
  if old.journal_entry_id is not null then
    perform public.fin_reverse_journal(old.journal_entry_id, (now() at time zone 'Asia/Manila')::date, 'Advance released from bill');
  end if;
  return old;
end $$;
drop trigger if exists finance_payment_applications_ledger on public.finance_supplier_payment_applications;
create trigger finance_payment_applications_ledger before insert on public.finance_supplier_payment_applications
  for each row execute function public.fin_payment_application_ledger();
drop trigger if exists finance_payment_applications_ledger_del on public.finance_supplier_payment_applications;
create trigger finance_payment_applications_ledger_del after delete on public.finance_supplier_payment_applications
  for each row execute function public.fin_payment_application_ledger();

-- goods received into stock
create or replace function public.fin_receipt_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if new.journal_entry_id is null and new.status::text = 'posted' then
    select round(coalesce(sum(coalesce(accepted_qty, 0) * coalesce(unit_cost, 0)), 0), 2) into v from public.logistics_receipt_items where receipt_id = new.id;
    if v <> 0 then
      new.journal_entry_id := public.fin_auto_journal(new.business_id, coalesce(new.receipt_date, (now() at time zone 'Asia/Manila')::date),
        'Goods received ' || new.receipt_number, 'goods_receipt', new.id, public.fin_norm_lines(jsonb_build_array(
          jsonb_build_object('code', '1200', 'debit', v, 'text', 'Stock received ' || new.receipt_number),
          jsonb_build_object('code', '2010', 'credit', v, 'text', 'Received, not yet billed ' || new.receipt_number))));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists logistics_receipts_ledger on public.logistics_receipts;
create trigger logistics_receipts_ledger before update of status on public.logistics_receipts
  for each row execute function public.fin_receipt_ledger();

-- stock counts: the value the count adds or removes; the store's first count is its opening stock
create or replace function public.fin_count_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v numeric; v_first boolean; v_other text;
begin
  if new.journal_entry_id is null and new.status::text = 'approved' then
    select round(coalesce(sum((coalesce(counted_qty, 0) - coalesce(on_hand_before, 0)) * coalesce(unit_cost, 0)), 0), 2) into v
      from public.inventory_opening_count_lines where count_id = new.id;
    v_first := not exists (select 1 from public.inventory_opening_counts where business_id = new.business_id and status::text = 'approved' and id <> new.id);
    v_other := case when v_first then '3900' else '5020' end;
    if v <> 0 then
      new.journal_entry_id := public.fin_auto_journal(new.business_id, coalesce(new.count_date, (now() at time zone 'Asia/Manila')::date),
        case when v_first then 'Opening stock ' else 'Stock count ' end || new.count_number, 'stock_count', new.id, public.fin_norm_lines(jsonb_build_array(
          jsonb_build_object('code', '1200', 'debit', v, 'text', 'Stock count ' || new.count_number),
          jsonb_build_object('code', v_other, 'credit', v, 'text', case when v_first then 'Opening stock' else 'Count difference' end || ' ' || new.count_number))));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists inventory_opening_counts_ledger on public.inventory_opening_counts;
create trigger inventory_opening_counts_ledger before update of status on public.inventory_opening_counts
  for each row execute function public.fin_count_ledger();

do $$ declare f text; begin
  foreach f in array array['public.fin_supplier_invoice_ledger()', 'public.fin_supplier_payment_account()', 'public.fin_supplier_payment_ledger()',
                           'public.fin_payment_application_ledger()', 'public.fin_receipt_ledger()', 'public.fin_count_ledger()',
                           'public.fin_supplier_invoice_lines(uuid)', 'public.fin_ensure_accounts(uuid)', 'public.fin_auto_journal(uuid, date, text, text, uuid, jsonb)',
                           'public.fin_reverse_journal(uuid, date, text)', 'public.fin_cash_code(uuid, uuid, text)'] loop
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ book what is already there, once, at its own date
-- (a document in a closed accounting period is skipped and listed in the notices)
do $$
declare r record; v uuid; v_po numeric; n int := 0; s int := 0;
begin
  for r in select 'receipt' k, id, receipt_date d from public.logistics_receipts where status::text = 'posted' and journal_entry_id is null
           union all select 'count', id, count_date from public.inventory_opening_counts where status::text = 'approved' and journal_entry_id is null
           union all select 'invoice', id, invoice_date from public.finance_supplier_invoices where status::text in ('approved','partially_paid','paid') and journal_entry_id is null
           union all select 'payment', id, payment_date from public.finance_supplier_payments where status::text = 'posted' and journal_entry_id is null
           order by 3 nulls first, 1 loop
    begin
      if r.k = 'receipt' then update public.logistics_receipts set status = status where id = r.id;   -- fires the entry
      elsif r.k = 'count' then update public.inventory_opening_counts set status = status where id = r.id;
      elsif r.k = 'invoice' then update public.finance_supplier_invoices set status = status where id = r.id;
      else update public.finance_supplier_payments set status = status where id = r.id;
      end if;
      n := n + 1;
    exception when others then s := s + 1; raise notice 'Not booked (% %): %', r.k, r.id, sqlerrm;
    end;
  end loop;
  -- PO advances already applied to bills
  for r in select a.id, a.amount, a.business_id, p.payment_number from public.finance_supplier_payment_applications a join public.finance_supplier_payments p on p.id = a.payment_id
            where a.journal_entry_id is null and p.invoice_id is null and p.journal_entry_id is not null loop
    begin
      update public.finance_supplier_payment_applications set journal_entry_id = public.fin_auto_journal(r.business_id, (now() at time zone 'Asia/Manila')::date,
        'Advance applied to bill — ' || r.payment_number, 'ap_advance_applied', r.id, jsonb_build_array(jsonb_build_object('code', '2000', 'debit', r.amount),
                                                                                                         jsonb_build_object('code', '1310', 'credit', r.amount))) where id = r.id;
    exception when others then s := s + 1; raise notice 'Not booked (application %): %', r.id, sqlerrm;
    end;
  end loop;
  raise notice 'Ledger catch-up: % documents booked, % skipped.', n, s;
end $$;
