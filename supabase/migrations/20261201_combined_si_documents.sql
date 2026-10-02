-- ============================================================================
-- Build 75 — one SI across several DRs, and the data behind the new printed
-- external documents (user, 2026-09-28):
--   DOC-09 / DOC-10  The Sales Invoice is written in the BIR booklet. For an
--          order delivered over several DRs, the booklet SI number is entered
--          once against all of them and AR keeps ONE invoice: the DRs' AR
--          entries are combined into it (payments already received move with
--          them), the old entries are marked merged (voided, kept on record),
--          and a DR can never be put on a second SI.
--   Documents (PO-07 decision)  statement of account, collection /
--          acknowledgment receipt, return / credit slip (and the PO, which
--          reads its own tables).
-- ============================================================================

-- ------------------------------------------------------------ SI uniqueness --
-- One SI number per booklet, except that all the DRs combined on that SI share
-- it (they point at the same AR invoice).
drop index if exists public.storefront_sales_si_booklet_unique;
create or replace function public.guard_storefront_si()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_booklet uuid;
begin
  if new.si_number is null or new.status = 'cancelled' then return new; end if;
  v_booklet := coalesce(new.si_booklet_business_id, new.business_id);
  perform pg_advisory_xact_lock(hashtext('SI:' || v_booklet::text || ':' || lower(btrim(new.si_number))));
  if exists (select 1 from public.storefront_sales x
              where x.id <> new.id and x.status <> 'cancelled' and x.si_number is not null
                and coalesce(x.si_booklet_business_id, x.business_id) = v_booklet
                and lower(btrim(x.si_number)) = lower(btrim(new.si_number))
                and (new.ar_invoice_id is null or x.ar_invoice_id is distinct from new.ar_invoice_id)) then
    raise exception 'SI number % is already used on this SI booklet.', btrim(new.si_number);
  end if;
  return new;
end $$;
drop trigger if exists storefront_sales_si_guard on public.storefront_sales;
create trigger storefront_sales_si_guard before insert or update of si_number, ar_invoice_id, status, si_booklet_business_id on public.storefront_sales
  for each row execute function public.guard_storefront_si();
revoke all on function public.guard_storefront_si() from public, authenticated;

-- ------------------------------------------------------ one SI, several DRs --
-- p = {sale_ids: [..], si_number, si_date}
create or replace function public.storefront_combined_si(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v_ids uuid[]; v_si text; v_date date; v_today date := (now() at time zone 'Asia/Manila')::date;
        n int; n_cust int; n_order int; v_cust uuid; v_order uuid; o record; s record; v_booklet uuid; v_vat_reg boolean; v_code text;
        v_old uuid[]; v_inv uuid; v_no text; v_drs text; v_sub numeric; v_tax numeric; v_disc numeric; v_other numeric;
begin
  v_si := nullif(btrim(coalesce(p->>'si_number', '')), '');
  if v_si is null then raise exception 'Enter the SI number from the booklet.'; end if;
  v_date := coalesce(nullif(p->>'si_date', '')::date, v_today);
  if v_date > v_today then raise exception 'The SI date cannot be in the future.'; end if;
  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'sale_ids', '[]'::jsonb)) x;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Choose the DRs this SI covers.'; end if;

  perform 1 from public.storefront_sales where id = any(v_ids) for update;
  select count(*), count(distinct customer_id), count(distinct sales_order_id), min(customer_id::text)::uuid, min(sales_order_id::text)::uuid
    into n, n_cust, n_order, v_cust, v_order
    from public.storefront_sales where id = any(v_ids) and business_id = b;
  if n <> cardinality(v_ids) then raise exception 'A chosen DR was not found in this store.'; end if;
  for s in select * from public.storefront_sales where id = any(v_ids) order by dr_number loop
    if s.status <> 'completed' or s.dr_number is null then raise exception 'Sale % is not a completed DR.', s.sale_number; end if;
    if s.sales_order_id is null then raise exception 'DR % is a counter sale; one SI across several DRs is for sales-order deliveries.', s.dr_number; end if;
    if s.si_number is not null then raise exception 'DR % already has SI %; a DR cannot be invoiced twice.', s.dr_number, s.si_number; end if;
    if s.ar_invoice_id is null then raise exception 'DR % has no AR entry to combine.', s.dr_number; end if;
    if s.cancel_status = 'approved' then raise exception 'DR % was cancelled.', s.dr_number; end if;
  end loop;
  if n_cust <> 1 or n_order <> 1 then raise exception 'All the DRs on one SI must be from the same sales order.'; end if;

  select * into o from public.sales_orders where id = v_order;
  v_booklet := public.sf_booklet_business(b);
  select vat_registered into v_vat_reg from public.businesses where id = v_booklet;
  if coalesce(v_vat_reg, false) <> o.vat_applied then
    raise exception '%', 'Order ' || o.order_number || case when o.vat_applied then ' is with VAT: its SI must come from a VAT-registered booklet.' else ' is without VAT: its SI must come from a non-VAT booklet.' end;
  end if;
  if exists (select 1 from public.storefront_sales where coalesce(si_booklet_business_id, business_id) = v_booklet and status <> 'cancelled'
              and lower(btrim(si_number)) = lower(v_si)) then
    raise exception 'SI number % is already used on this SI booklet.', v_si;
  end if;

  select code into v_code from public.businesses where id = b;
  v_no := v_code || '-SI-' || v_si;
  if exists (select 1 from public.finance_customer_invoices where invoice_number = v_no) then raise exception 'Invoice % already exists.', v_no; end if;
  select array_agg(ar_invoice_id), string_agg(dr_number, ', ' order by dr_number) into v_old, v_drs from public.storefront_sales where id = any(v_ids);
  select coalesce(sum(subtotal), 0), coalesce(sum(tax_amount), 0), coalesce(sum(discount_amount), 0), coalesce(sum(other_charges), 0)
    into v_sub, v_tax, v_disc, v_other from public.finance_customer_invoices where id = any(v_old);

  insert into public.finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, due_date, subtotal, tax_amount, discount_amount, other_charges,
                                               amount_received, status, notes, prepared_by, prepared_at, approved_by, approved_at, created_by)
  values (b, v_no, v_cust, v_date, v_date + public.payment_terms_days(o.payment_terms), v_sub, v_tax, v_disc, v_other, 0, 'approved',
          'Sales invoice SI ' || v_si || ' covering ' || v_drs || ' (order ' || o.order_number || coalesce(', ' || o.payment_terms, '') || ')'
            || case when v_tax > 0 then ' (VAT-inclusive; VAT ₱' || v_tax || ')' else '' end,
          auth.uid(), now(), auth.uid(), now(), auth.uid())
  returning id into v_inv;
  insert into public.finance_customer_invoice_items(business_id, invoice_id, description, quantity, unit, unit_price)
  select b, v_inv, ss.dr_number || ': ' || it.description, it.quantity, it.unit, it.unit_price
    from public.finance_customer_invoice_items it join public.storefront_sales ss on ss.ar_invoice_id = it.invoice_id
   where it.invoice_id = any(v_old) and ss.id = any(v_ids);

  -- payments already received move to the combined invoice
  update public.finance_customer_receipts set invoice_id = v_inv, updated_at = now() where invoice_id = any(v_old);
  update public.storefront_payments set ar_invoice_id = v_inv where ar_invoice_id = any(v_old);
  update public.finance_customer_invoices
     set status = 'voided', updated_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Merged into ' || v_no || ' (SI ' || v_si || ') on ' || v_date || '.'
   where id = any(v_old);
  update public.storefront_sales set ar_invoice_id = v_inv where id = any(v_ids);
  update public.storefront_sales set si_number = v_si, si_booklet_business_id = v_booklet where id = any(v_ids);
  perform public.recalculate_customer_invoice_received(v_inv);

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customer_invoices', v_inv, 'storefront_combined_si',
          jsonb_build_object('si_number', v_si, 'invoice_number', v_no, 'drs', v_drs, 'order', o.order_number, 'merged_invoices', to_jsonb(v_old)));
  return (select jsonb_build_object('invoice_number', invoice_number, 'total', total_amount, 'received', amount_received, 'balance', balance_due, 'drs', v_drs)
            from public.finance_customer_invoices where id = v_inv);
end $$;

-- the AR collection returns the first payment, for its printed receipt
create or replace function public.storefront_collect_ar(p_invoice uuid, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); inv record; p jsonb; v_total numeric := 0; v_first uuid; v_id uuid;
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
    v_id := public.storefront_record_payment(b, 'ar_collection', p->>'method', (p->>'amount')::numeric, p->>'reference', null, inv.id, null,
                                             'Received at the counter (Storefront) for invoice ' || inv.invoice_number, nullif(p->>'account', '')::uuid,
                                             public.sf_pay_extra(p) || jsonb_build_object('customer_id', inv.customer_id));
    v_first := coalesce(v_first, v_id);
  end loop;
  perform public.recalculate_customer_invoice_received(inv.id);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customer_invoices', inv.id, 'storefront_ar_collected', jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total));
  return jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total, 'balance', inv.balance_due - v_total, 'payment_id', v_first);
end $$;

-- ------------------------------------------------------ statement of account --
create or replace function public.customer_statement(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); c record; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.can_view_storefront() then raise exception 'Sales or Finance access is required.'; end if;
  select * into c from public.finance_customers where id = p_customer and business_id = b;
  if not found then raise exception 'Customer not found in this business.'; end if;
  return jsonb_build_object(
    'as_of', v_today,
    'customer', jsonb_build_object('name', c.legal_name, 'code', c.customer_code, 'address', c.address, 'phone', c.phone, 'tax_id', c.tax_id,
                                   'payment_terms', c.payment_terms, 'credit_limit', c.credit_limit),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', i.invoice_number, 'date', i.invoice_date, 'due', i.due_date, 'total', i.total_amount,
                                                              'received', i.amount_received, 'balance', i.balance_due,
                                                              'days_overdue', greatest(v_today - coalesce(i.due_date, i.invoice_date), 0),
                                                              'notes', i.notes) order by i.invoice_date, i.invoice_number)
                            from public.finance_customer_invoices i
                           where i.customer_id = c.id and i.business_id = b and i.status in ('approved','partially_paid') and i.balance_due > 0), '[]'::jsonb),
    'aging', (select jsonb_build_object(
                'current', coalesce(sum(balance_due) filter (where coalesce(due_date, invoice_date) >= v_today), 0),
                'd1_30',   coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 1 and 30), 0),
                'd31_60',  coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 31 and 60), 0),
                'd61_90',  coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 61 and 90), 0),
                'd90',     coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) > 90), 0),
                'total',   coalesce(sum(balance_due), 0))
                from public.finance_customer_invoices
               where customer_id = c.id and business_id = b and status in ('approved','partially_paid') and balance_due > 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('date', r.receipt_date, 'number', r.receipt_number, 'method', r.payment_method,
                                                              'reference', r.reference_number, 'amount', r.amount, 'invoice', i.invoice_number) order by r.receipt_date desc, r.receipt_number desc)
                            from public.finance_customer_receipts r join public.finance_customer_invoices i on i.id = r.invoice_id
                           where i.customer_id = c.id and r.business_id = b and r.status = 'posted' and r.receipt_date >= v_today - 90), '[]'::jsonb));
end $$;

-- ------------------------------------------- collection / acknowledgment receipt --
-- One receipt for the payment lines recorded together (same sale or invoice, same
-- cashier, within a few seconds), e.g. cash + GCash on one sale.
create or replace function public.storefront_payment_receipt(p_payment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); p record; v_cust record; v_for text; v_bal numeric;
begin
  if not public.can_view_storefront() then raise exception 'Sales or Finance access is required.'; end if;
  select * into p from public.storefront_payments where id = p_payment and business_id = b;
  if not found or p.kind = 'refund' then raise exception 'Payment not found in this store.'; end if;
  if p.sale_id is not null then
    select c.legal_name, c.address, c.phone, s.sale_number, s.dr_number, s.si_number into v_cust
      from public.storefront_sales s join public.finance_customers c on c.id = s.customer_id where s.id = p.sale_id;
    v_for := coalesce('DR ' || v_cust.dr_number, 'Sale ' || v_cust.sale_number) || coalesce(', SI ' || v_cust.si_number, '');
  else
    select c.legal_name, c.address, c.phone, i.invoice_number into v_cust
      from public.finance_customer_invoices i join public.finance_customers c on c.id = i.customer_id where i.id = p.ar_invoice_id;
    v_for := 'Invoice ' || v_cust.invoice_number;
  end if;
  if p.ar_invoice_id is not null then select balance_due into v_bal from public.finance_customer_invoices where id = p.ar_invoice_id; end if;
  return jsonb_build_object(
    'number', (select min(x.payment_number) from public.storefront_payments x
                where x.business_id = b and x.kind = p.kind and x.received_by is not distinct from p.received_by
                  and coalesce(x.sale_id, x.ar_invoice_id) = coalesce(p.sale_id, p.ar_invoice_id)
                  and abs(extract(epoch from x.received_at - p.received_at)) < 5),
    'date', (p.received_at at time zone 'Asia/Manila'),
    'kind', p.kind, 'for', v_for,
    'customer', jsonb_build_object('name', v_cust.legal_name, 'address', v_cust.address, 'phone', v_cust.phone),
    'received_by', (select full_name from public.users where id = p.received_by),
    'balance_after', v_bal,
    'lines', (select jsonb_agg(jsonb_build_object('number', x.payment_number, 'method', x.method, 'amount', x.amount, 'reference', x.reference_number,
                                                  'tendered', x.tendered, 'change', x.change_given,
                                                  'check_bank', k.bank_name, 'check_date', k.check_date, 'check_status', k.status) order by x.payment_number)
                from public.storefront_payments x left join public.storefront_checks k on k.payment_id = x.id
               where x.business_id = b and x.kind = p.kind and x.received_by is not distinct from p.received_by
                 and coalesce(x.sale_id, x.ar_invoice_id) = coalesce(p.sale_id, p.ar_invoice_id)
                 and abs(extract(epoch from x.received_at - p.received_at)) < 5));
end $$;

grant execute on function public.storefront_combined_si(jsonb), public.storefront_collect_ar(uuid, jsonb), public.customer_statement(uuid),
  public.storefront_payment_receipt(uuid) to authenticated;
