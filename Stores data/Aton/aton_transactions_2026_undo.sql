-- ATON AIRE — removes the FIRST load of aton_transactions_2026.sql (sales history, history closings and
-- journals, payables and their payments), so the corrected loader can be run.
-- Run ONCE in the Supabase SQL editor, then run the new aton_transactions_2026.sql.
-- Touches only ATON records the loader created (notes "Loaded from 2026 DS / 2026 Purch",
-- closings ATON-CLH-2026-.., journals ATON-SLH-2026-..). Customers the loader created are removed
-- only if nothing else uses them; suppliers it created are kept (the new loader reuses them).
-- One transaction: any error removes nothing.
begin;
do $$
declare b uuid; n_pay int; n_inv int; n_sale int; n_close int; n_je int; n_cust int;
begin
  select id into b from public.businesses where code = 'ATON';
  if b is null then raise exception 'Business ATON not found.'; end if;

  delete from public.finance_supplier_payments where business_id = b and notes like 'Loaded from 2026 Purch%';
  get diagnostics n_pay = row_count;
  if exists (select 1 from public.finance_supplier_payments p join public.finance_supplier_invoices i on i.id = p.invoice_id
              where i.business_id = b and i.notes like 'Loaded from 2026 Purch%') then
    raise exception 'Some loaded payables already have payments recorded in the app; nothing was removed. Tell Claude which ones.';
  end if;
  delete from public.finance_supplier_invoices where business_id = b and notes like 'Loaded from 2026 Purch%';
  get diagnostics n_inv = row_count;

  if exists (select 1 from public.storefront_sales where business_id = b and notes like 'Loaded from 2026 DS%' and (ar_invoice_id is not null or status <> 'completed')) then
    raise exception 'Some loaded sales were changed in the app (charged to AR or cancelled); nothing was removed. Tell Claude which ones.';
  end if;
  delete from public.storefront_sales where business_id = b and notes like 'Loaded from 2026 DS%';
  get diagnostics n_sale = row_count;
  delete from public.storefront_closings where business_id = b and closing_number like 'ATON-CLH-2026-%';
  get diagnostics n_close = row_count;
  delete from public.finance_journal_lines where journal_entry_id in
    (select id from public.finance_journal_entries where business_id = b and journal_number like 'ATON-SLH-2026-%' and notes = 'Loaded from 2026 DS');
  delete from public.finance_journal_entries where business_id = b and journal_number like 'ATON-SLH-2026-%' and notes = 'Loaded from 2026 DS';
  get diagnostics n_je = row_count;

  delete from public.finance_customers c
   where c.business_id = b and c.notes = 'Created from 2026 DS (sales history)'
     and not exists (select 1 from public.storefront_sales s where s.customer_id = c.id)
     and not exists (select 1 from public.finance_customer_invoices i where i.customer_id = c.id)
     and not exists (select 1 from public.sales_quotations q where q.customer_id = c.id)
     and not exists (select 1 from public.sales_orders o where o.customer_id = c.id);
  get diagnostics n_cust = row_count;

  raise notice 'Removed % supplier payments, % payables, % sales, % history closings, % journals, % customers.', n_pay, n_inv, n_sale, n_close, n_je, n_cust;
end $$;
commit;
