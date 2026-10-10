-- Build 100 (part 2 of the ledger work) — receivables raised in Finance, and payroll:
--   invoice raised in Finance       Dr 1100 Accounts Receivable      Cr 4000 Sales (net of discount, plus other charges) + Cr 2210 Output VAT
--   opening invoice (go-live)       Dr 1100                           Cr 3900 Opening Balance Equity
--   receipt posted in Finance       Dr the bank / cash account        Cr 1100
--   payroll run approved            Dr 5100 Payroll Expense (gross)   Cr 2101 SSS, 2102 PhilHealth, 2103 Pag-IBIG, 2104 Withholding Tax,
--                                                                     2100 other deductions, 2105 Salaries Payable (net)
--   payroll run posted (paid)       Dr 2105                           Cr the bank / cash account it was paid from
--   remitting SSS / PhilHealth / Pag-IBIG / tax   Dr the payable      Cr the bank / cash account
-- Invoices and receipts made at the Storefront (DRs, counter collections, combined SIs, bounced checks) are booked by the
-- daily closing / their own entries already: only documents made in Finance are flagged to post here (nothing counted twice).

alter table public.finance_customer_invoices add column if not exists is_opening boolean not null default false;
alter table public.finance_customer_invoices add column if not exists post_to_ledger boolean not null default false;
alter table public.finance_customer_invoices add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.finance_customer_invoices add column if not exists reversal_journal_id uuid references public.finance_journal_entries(id);
alter table public.finance_customer_receipts add column if not exists post_to_ledger boolean not null default false;
alter table public.finance_customer_receipts add column if not exists bank_account_id uuid references public.finance_bank_accounts(id);
alter table public.finance_customer_receipts add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.finance_customer_receipts add column if not exists reversal_journal_id uuid references public.finance_journal_entries(id);
alter table public.payroll_runs add column if not exists paid_from_bank_account_id uuid references public.finance_bank_accounts(id);
alter table public.payroll_runs add column if not exists accrual_journal_id uuid references public.finance_journal_entries(id);
alter table public.payroll_runs add column if not exists payment_journal_id uuid references public.finance_journal_entries(id);

-- ------------------------------------------------------------------ receivables raised in Finance
create or replace function public.fin_customer_invoice_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_tax numeric; v_who text;
begin
  if not new.post_to_ledger then return new; end if;
  if new.journal_entry_id is null and new.status::text in ('approved', 'partially_paid', 'paid') then
    v_tax := round(coalesce(new.tax_amount, 0), 2);
    v_total := round(coalesce(new.subtotal, 0) + v_tax + coalesce(new.other_charges, 0) - coalesce(new.discount_amount, 0), 2);
    v_who := coalesce((select legal_name from public.finance_customers where id = new.customer_id), 'Customer') || ' — ' || new.invoice_number;
    new.journal_entry_id := public.fin_auto_journal(new.business_id, coalesce(new.invoice_date, (now() at time zone 'Asia/Manila')::date),
      case when new.is_opening then 'Opening customer balance ' else 'Customer invoice ' end || new.invoice_number, 'ar_invoice', new.id,
      case when new.is_opening then jsonb_build_array(jsonb_build_object('code', '1100', 'debit', v_total, 'text', v_who),
                                                     jsonb_build_object('code', '3900', 'credit', v_total, 'text', 'Opening balance: ' || v_who))
           else jsonb_build_array(jsonb_build_object('code', '1100', 'debit', v_total, 'text', v_who),
                                  jsonb_build_object('code', '4000', 'credit', v_total - v_tax, 'text', v_who),
                                  jsonb_build_object('code', '2210', 'credit', v_tax, 'text', 'Output VAT: ' || v_who)) end);
  elsif new.status::text = 'voided' and new.journal_entry_id is not null and new.reversal_journal_id is null then
    new.reversal_journal_id := public.fin_reverse_journal(new.journal_entry_id, (now() at time zone 'Asia/Manila')::date, 'Voided customer invoice ' || new.invoice_number);
  end if;
  return new;
end $$;
drop trigger if exists finance_customer_invoices_ledger on public.finance_customer_invoices;
create trigger finance_customer_invoices_ledger before update of status on public.finance_customer_invoices
  for each row execute function public.fin_customer_invoice_ledger();

create or replace function public.fin_customer_receipt_account() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.bank_account ~ '^[0-9a-f-]{36}$' then
    select * into a from public.finance_bank_accounts where id = new.bank_account::uuid and business_id = new.business_id;
    if found then new.bank_account_id := a.id; new.bank_account := a.account_name; end if;
  end if;
  return new;
end $$;
drop trigger if exists finance_customer_receipts_account on public.finance_customer_receipts;
create trigger finance_customer_receipts_account before insert or update of bank_account on public.finance_customer_receipts
  for each row execute function public.fin_customer_receipt_account();

create or replace function public.fin_customer_receipt_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v_who text;
begin
  if not new.post_to_ledger or exists (select 1 from public.storefront_payments where ar_receipt_id = new.id) then return new; end if;   -- counter receipts: daily closing
  if new.journal_entry_id is null and new.status::text = 'posted' then
    v_who := coalesce((select c.legal_name from public.finance_customers c join public.finance_customer_invoices i on i.customer_id = c.id where i.id = new.invoice_id), 'Customer')
             || ' — ' || new.receipt_number;
    new.journal_entry_id := public.fin_auto_journal(new.business_id, coalesce(new.receipt_date, (now() at time zone 'Asia/Manila')::date),
      'Customer receipt ' || new.receipt_number, 'ar_receipt', new.id, jsonb_build_array(
        jsonb_build_object('code', public.fin_cash_code(new.business_id, new.bank_account_id, new.payment_method::text), 'debit', new.amount, 'text', v_who),
        jsonb_build_object('code', '1100', 'credit', new.amount, 'text', v_who)));
  elsif new.status::text = 'voided' and new.journal_entry_id is not null and new.reversal_journal_id is null then
    new.reversal_journal_id := public.fin_reverse_journal(new.journal_entry_id, (now() at time zone 'Asia/Manila')::date, 'Voided customer receipt ' || new.receipt_number);
  end if;
  return new;
end $$;
drop trigger if exists finance_customer_receipts_ledger on public.finance_customer_receipts;
create trigger finance_customer_receipts_ledger before update of status on public.finance_customer_receipts
  for each row execute function public.fin_customer_receipt_ledger();

-- ------------------------------------------------------------------ payroll
create or replace function public.fin_payroll_lines(p_run uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_array(
    jsonb_build_object('code', '5100', 'debit', round(coalesce(sum(gross_pay), 0), 2), 'text', 'Gross pay'),
    jsonb_build_object('code', '2101', 'credit', round(coalesce(sum(social_security), 0), 2), 'text', 'SSS withheld'),
    jsonb_build_object('code', '2102', 'credit', round(coalesce(sum(health_contribution), 0), 2), 'text', 'PhilHealth withheld'),
    jsonb_build_object('code', '2103', 'credit', round(coalesce(sum(housing_fund), 0), 2), 'text', 'Pag-IBIG withheld'),
    jsonb_build_object('code', '2104', 'credit', round(coalesce(sum(tax_withheld), 0), 2), 'text', 'Tax withheld'),
    jsonb_build_object('code', '2100', 'credit', round(coalesce(sum(other_deductions), 0), 2), 'text', 'Other deductions'),
    jsonb_build_object('code', '2105', 'credit', round(coalesce(sum(gross_pay), 0), 2) - round(coalesce(sum(social_security), 0), 2) - round(coalesce(sum(health_contribution), 0), 2)
                                                 - round(coalesce(sum(housing_fund), 0), 2) - round(coalesce(sum(tax_withheld), 0), 2) - round(coalesce(sum(other_deductions), 0), 2), 'text', 'Net pay due'))
  from public.payroll_entries where payroll_run_id = p_run;
$$;
revoke all on function public.fin_payroll_lines(uuid) from public;

create or replace function public.fin_payroll_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v_date date; v_net numeric;
begin
  select coalesce(p.pay_date, p.end_date) into v_date from public.payroll_periods p where p.id = new.period_id;
  v_date := coalesce(v_date, (now() at time zone 'Asia/Manila')::date);
  if new.accrual_journal_id is null and new.status::text in ('approved', 'posted') then
    new.accrual_journal_id := public.fin_auto_journal(new.business_id, v_date, 'Payroll ' || new.run_number, 'payroll', new.id, public.fin_payroll_lines(new.id));
  end if;
  if new.payment_journal_id is null and new.status::text = 'posted' and new.accrual_journal_id is not null then
    select round(coalesce(sum(credit), 0), 2) into v_net from public.finance_journal_lines l join public.finance_chart_of_accounts a on a.id = l.account_id
     where l.journal_entry_id = new.accrual_journal_id and a.account_code = '2105';
    new.payment_journal_id := public.fin_auto_journal(new.business_id, v_date, 'Payroll paid ' || new.run_number, 'payroll_payment', new.id, jsonb_build_array(
      jsonb_build_object('code', '2105', 'debit', v_net, 'text', 'Net pay released ' || new.run_number),
      jsonb_build_object('code', public.fin_cash_code(new.business_id, new.paid_from_bank_account_id, 'bank'), 'credit', v_net, 'text', 'Net pay released ' || new.run_number)));
  end if;
  if new.status::text = 'voided' then
    if new.payment_journal_id is not null then perform public.fin_reverse_journal(new.payment_journal_id, (now() at time zone 'Asia/Manila')::date, 'Voided payroll payment ' || new.run_number); end if;
    if new.accrual_journal_id is not null then perform public.fin_reverse_journal(new.accrual_journal_id, (now() at time zone 'Asia/Manila')::date, 'Voided payroll ' || new.run_number); end if;
  end if;
  return new;
end $$;
drop trigger if exists payroll_runs_ledger on public.payroll_runs;
create trigger payroll_runs_ledger before update of status on public.payroll_runs for each row execute function public.fin_payroll_ledger();

-- what is owed to SSS / PhilHealth / Pag-IBIG / BIR, and remitting it
create or replace function public.payroll_liabilities()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')) then raise exception 'Finance access is required.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.account_code, 'name', a.account_name,
            'balance', coalesce((select round(sum(l.credit - l.debit), 2) from public.finance_journal_lines l join public.finance_journal_entries e on e.id = l.journal_entry_id
                                  where l.account_id = a.id and e.status = 'posted'), 0)) order by a.account_code)
    from public.finance_chart_of_accounts a where a.business_id = b and a.account_code in ('2100', '2101', '2102', '2103', '2104')), '[]'::jsonb);
end $$;
revoke all on function public.payroll_liabilities() from public;
grant execute on function public.payroll_liabilities() to authenticated;

create or replace function public.payroll_remit(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v_code text := p->>'code'; v_amt numeric := round((p->>'amount')::numeric, 2); v_acc uuid := nullif(p->>'bank_account_id', '')::uuid;
        v_date date := coalesce(nullif(p->>'date', '')::date, (now() at time zone 'Asia/Manila')::date); v_name text;
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not (public.is_super_admin() or public.is_business_admin() or public.has_workflow_role((select id from public.sections where code = 'finance'), 'approver')) then
    raise exception 'A Finance approver records remittances.';
  end if;
  if v_code not in ('2100', '2101', '2102', '2103', '2104') then raise exception 'Choose what is being remitted.'; end if;
  if not (v_amt > 0) then raise exception 'Enter the amount remitted.'; end if;
  if v_acc is null or not exists (select 1 from public.finance_bank_accounts where id = v_acc and business_id = b and status = 'active') then
    raise exception 'Choose the bank / cash account it was paid from.';
  end if;
  perform public.fin_ensure_accounts(b);
  select account_name into v_name from public.finance_chart_of_accounts where business_id = b and account_code = v_code;
  return public.fin_auto_journal(b, v_date, 'Remitted ' || v_name || coalesce(' — ' || nullif(btrim(p->>'reference'), ''), ''), 'payroll_remittance', null,
    jsonb_build_array(jsonb_build_object('code', v_code, 'debit', v_amt, 'text', 'Remitted ' || v_name),
                      jsonb_build_object('code', public.fin_cash_code(b, v_acc, 'bank'), 'credit', v_amt, 'text', 'Remitted ' || v_name)));
end $$;
revoke all on function public.payroll_remit(jsonb) from public;
grant execute on function public.payroll_remit(jsonb) to authenticated;

do $$ declare f text; begin
  foreach f in array array['public.fin_customer_invoice_ledger()', 'public.fin_customer_receipt_account()', 'public.fin_customer_receipt_ledger()',
                           'public.fin_payroll_lines(uuid)', 'public.fin_payroll_ledger()'] loop
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ payroll already approved / posted: booked once, at the pay date
do $$
declare r record; n int := 0; s int := 0;
begin
  for r in select id from public.payroll_runs where status::text in ('approved', 'posted') and accrual_journal_id is null order by created_at loop
    begin update public.payroll_runs set status = status where id = r.id; n := n + 1;
    exception when others then s := s + 1; raise notice 'Payroll run % not booked: %', r.id, sqlerrm; end;
  end loop;
  raise notice 'Payroll catch-up: % runs booked, % skipped.', n, s;
end $$;
