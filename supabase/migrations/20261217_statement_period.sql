-- ============================================================================
-- Build 85 — statement of account with a period (owner, 2026-10-03)
--   Customer statement and supplier statement get a period (from – to; default
--   1 January of this year to today) and list EVERY transaction in it, not only
--   what is still open:
--     opening balance (owed before the period)
--     + each DR / invoice (charge), with its status today: Paid / Part paid / Open
--     − each payment (Storefront sales paid at the counter show the charge and
--       the payment on the same line; payments on AR invoices are receipts)
--     = closing balance, with a running balance per line.
--   The open-invoice list and aging stay (as of today). The DR shown is the
--   paper DR no. (hardcopy) when one was written, else the app DR no.
--   Supplier statement: supplier invoices (charges) and posted payments, plus a
--   list of checks issued but not yet posted (pending).
-- ============================================================================

-- AR references: the paper (hardcopy) DR no. first.
create or replace function public.ar_invoice_refs(p_ids uuid[])
returns table(invoice_id uuid, dr_numbers text, si_number text, sale_numbers text)
language sql stable security definer set search_path = public as $$
  select s.ar_invoice_id,
         string_agg(distinct coalesce(nullif(btrim(s.hardcopy_dr_no), ''), s.dr_number), ', ') filter (where coalesce(nullif(btrim(s.hardcopy_dr_no), ''), s.dr_number) is not null),
         string_agg(distinct btrim(s.si_number), ', ') filter (where s.si_number is not null),
         string_agg(distinct s.sale_number, ', ')
    from public.storefront_sales s
   where s.ar_invoice_id = any(p_ids) and s.status <> 'cancelled'
     and s.business_id = public.pricing_business_id()
     and (public.has_section_access('finance') or public.can_view_storefront() or public.is_super_admin() or public.is_business_admin())
   group by s.ar_invoice_id
$$;

drop function if exists public.customer_statement(uuid);
create or replace function public.customer_statement(p_customer uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.pricing_business_id(); c record; v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from date; v_to date; v_open numeric; v_lines jsonb; v_close numeric; v_chg numeric; v_pay numeric;
begin
  if not public.can_view_storefront() then raise exception 'Sales or Finance access is required.'; end if;
  select * into c from public.finance_customers where id = p_customer and business_id = b;
  if not found then raise exception 'Customer not found in this business.'; end if;
  v_to := coalesce(p_to, v_today);
  v_from := coalesce(p_from, make_date(extract(year from v_to)::int, 1, 1));
  if v_from > v_to then raise exception 'The period start is after its end.'; end if;

  with t(d, k, particulars, dr, si, ref, charge, paid, status) as (
    select s.sale_date, 1, 'Sale' || case when s.notes like 'Loaded from%' then ' (history)' else '' end,
         coalesce(nullif(btrim(s.hardcopy_dr_no), ''), s.dr_number), s.si_number, s.sale_number, s.total, s.amount_paid,
         case when s.amount_paid >= s.total then 'Paid' when s.amount_paid > 0 then 'Part paid' else 'Open' end
    from public.storefront_sales s
   where s.business_id = b and s.customer_id = c.id and s.status = 'completed' and s.ar_invoice_id is null and s.sale_date <= v_to
    union all
    select i.invoice_date, 1, case when r.invoice_id is not null then 'Sale on account' else coalesce(nullif(i.notes, ''), 'Invoice') end,
         case when r.invoice_id is not null then r.dr_numbers end, case when r.invoice_id is not null then r.si_number end, i.invoice_number,
         i.total_amount, 0,
         case when i.balance_due <= 0 then 'Paid' when i.amount_received > 0 then 'Part paid · bal ' || to_char(i.balance_due, 'FM999,999,990.00') else 'Open' end
    from public.finance_customer_invoices i
    left join lateral (select * from public.ar_invoice_refs(array[i.id])) r on true
   where i.business_id = b and i.customer_id = c.id and i.status in ('approved','partially_paid','paid') and i.invoice_date <= v_to
    union all
    select x.receipt_date, 2, 'Payment' || coalesce(' · ' || x.payment_method, '') || coalesce(' · ' || x.reference_number, ''),
         case when r.invoice_id is not null then r.dr_numbers end, case when r.invoice_id is not null then r.si_number end, x.receipt_number,
         0, x.amount, null
    from public.finance_customer_receipts x join public.finance_customer_invoices i on i.id = x.invoice_id
    left join lateral (select * from public.ar_invoice_refs(array[i.id])) r on true
   where i.business_id = b and i.customer_id = c.id and x.status = 'posted' and x.receipt_date <= v_to
  )
  select coalesce(sum(charge - paid) filter (where d < v_from), 0),
         coalesce(sum(charge) filter (where d between v_from and v_to), 0),
         coalesce(sum(paid) filter (where d between v_from and v_to), 0)
    into v_open, v_chg, v_pay from t;
  with t(d, k, particulars, dr, si, ref, charge, paid, status) as (
    select s.sale_date, 1, 'Sale' || case when s.notes like 'Loaded from%' then ' (history)' else '' end,
         coalesce(nullif(btrim(s.hardcopy_dr_no), ''), s.dr_number), s.si_number, s.sale_number, s.total, s.amount_paid,
         case when s.amount_paid >= s.total then 'Paid' when s.amount_paid > 0 then 'Part paid' else 'Open' end
    from public.storefront_sales s
   where s.business_id = b and s.customer_id = c.id and s.status = 'completed' and s.ar_invoice_id is null and s.sale_date <= v_to
    union all
    select i.invoice_date, 1, case when r.invoice_id is not null then 'Sale on account' else coalesce(nullif(i.notes, ''), 'Invoice') end,
         case when r.invoice_id is not null then r.dr_numbers end, case when r.invoice_id is not null then r.si_number end, i.invoice_number,
         i.total_amount, 0,
         case when i.balance_due <= 0 then 'Paid' when i.amount_received > 0 then 'Part paid · bal ' || to_char(i.balance_due, 'FM999,999,990.00') else 'Open' end
    from public.finance_customer_invoices i
    left join lateral (select * from public.ar_invoice_refs(array[i.id])) r on true
   where i.business_id = b and i.customer_id = c.id and i.status in ('approved','partially_paid','paid') and i.invoice_date <= v_to
    union all
    select x.receipt_date, 2, 'Payment' || coalesce(' · ' || x.payment_method, '') || coalesce(' · ' || x.reference_number, ''),
         case when r.invoice_id is not null then r.dr_numbers end, case when r.invoice_id is not null then r.si_number end, x.receipt_number,
         0, x.amount, null
    from public.finance_customer_receipts x join public.finance_customer_invoices i on i.id = x.invoice_id
    left join lateral (select * from public.ar_invoice_refs(array[i.id])) r on true
   where i.business_id = b and i.customer_id = c.id and x.status = 'posted' and x.receipt_date <= v_to
  )
  select coalesce(jsonb_agg(to_jsonb(z) - 'k' order by z.d, z.k, z.ref), '[]'::jsonb) into v_lines
    from (select t.*, v_open + sum(charge - paid) over (order by d, k, ref rows unbounded preceding) as balance from t where d between v_from and v_to) z;
  v_close := v_open + v_chg - v_pay;

  return jsonb_build_object(
    'as_of', v_today, 'from', v_from, 'to', v_to,
    'opening', v_open, 'closing', v_close,
    'charges', v_chg,
    'payments_total', v_pay,
    'lines', v_lines,
    'customer', jsonb_build_object('name', c.legal_name, 'code', c.customer_code, 'address', c.address, 'phone', c.phone, 'tax_id', c.tax_id,
                                   'payment_terms', c.payment_terms, 'credit_limit', c.credit_limit),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', i.invoice_number, 'dr', r.dr_numbers, 'si', r.si_number, 'linked', r.invoice_id is not null,
                                                              'date', i.invoice_date, 'due', i.due_date, 'total', i.total_amount,
                                                              'received', i.amount_received, 'balance', i.balance_due,
                                                              'days_overdue', greatest(v_today - coalesce(i.due_date, i.invoice_date), 0),
                                                              'notes', i.notes) order by i.invoice_date, i.invoice_number)
                            from public.finance_customer_invoices i
                            left join lateral (select * from public.ar_invoice_refs(array[i.id])) r on true
                           where i.customer_id = c.id and i.business_id = b and i.status in ('approved','partially_paid') and i.balance_due > 0), '[]'::jsonb),
    'aging', (select jsonb_build_object(
                'current', coalesce(sum(balance_due) filter (where coalesce(due_date, invoice_date) >= v_today), 0),
                'd1_30',   coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 1 and 30), 0),
                'd31_60',  coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 31 and 60), 0),
                'd61_90',  coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 61 and 90), 0),
                'd90',     coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) > 90), 0),
                'total',   coalesce(sum(balance_due), 0))
                from public.finance_customer_invoices
               where customer_id = c.id and business_id = b and status in ('approved','partially_paid') and balance_due > 0));
end $$;
grant execute on function public.customer_statement(uuid, date, date) to authenticated;

drop function if exists public.supplier_statement(uuid);
create or replace function public.supplier_statement(p_supplier uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.pricing_business_id(); s record; v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from date; v_to date; v_open numeric; v_lines jsonb; v_close numeric; v_chg numeric; v_pay numeric;
begin
  if not (public.has_section_access('finance') or public.is_super_admin() or public.is_business_admin()) then
    raise exception 'Finance access is required.';
  end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select * into s from public.finance_suppliers where id = p_supplier;
  if not found then raise exception 'Supplier not found.'; end if;
  v_to := coalesce(p_to, v_today);
  v_from := coalesce(p_from, make_date(extract(year from v_to)::int, 1, 1));
  if v_from > v_to then raise exception 'The period start is after its end.'; end if;

  with t(d, k, particulars, si, dr, po, ref, charge, paid, status) as (
    select i.invoice_date, 1, 'Purchase', r.supplier_si, r.supplier_dr, r.po_number, null, i.total_amount, 0,
         case when i.balance_due <= 0 then 'Paid' when i.amount_paid > 0 then 'Part paid · bal ' || to_char(i.balance_due, 'FM999,999,990.00') else 'Open' end
    from public.finance_supplier_invoices i
    left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
   where i.business_id = b and i.supplier_id = s.id and i.status::text in ('approved','partially_paid','paid') and i.invoice_date <= v_to
    union all
    select p.payment_date, 2, 'Payment' || coalesce(' · ' || p.payment_method, '') || coalesce(' · ' || p.reference_number, ''),
         r.supplier_si, r.supplier_dr, coalesce(r.po_number, po.po_number), p.payment_number, 0, p.amount, null
    from public.finance_supplier_payments p
    left join public.finance_supplier_invoices i on i.id = p.invoice_id
    left join public.purchase_orders po on po.id = p.purchase_order_id
    left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
   where p.business_id = b and p.status::text = 'posted' and p.payment_date <= v_to
     and (i.supplier_id = s.id or po.supplier_id = s.id)
  )
  select coalesce(sum(charge - paid) filter (where d < v_from), 0),
         coalesce(sum(charge) filter (where d between v_from and v_to), 0),
         coalesce(sum(paid) filter (where d between v_from and v_to), 0)
    into v_open, v_chg, v_pay from t;
  with t(d, k, particulars, si, dr, po, ref, charge, paid, status) as (
    select i.invoice_date, 1, 'Purchase', r.supplier_si, r.supplier_dr, r.po_number, null, i.total_amount, 0,
         case when i.balance_due <= 0 then 'Paid' when i.amount_paid > 0 then 'Part paid · bal ' || to_char(i.balance_due, 'FM999,999,990.00') else 'Open' end
    from public.finance_supplier_invoices i
    left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
   where i.business_id = b and i.supplier_id = s.id and i.status::text in ('approved','partially_paid','paid') and i.invoice_date <= v_to
    union all
    select p.payment_date, 2, 'Payment' || coalesce(' · ' || p.payment_method, '') || coalesce(' · ' || p.reference_number, ''),
         r.supplier_si, r.supplier_dr, coalesce(r.po_number, po.po_number), p.payment_number, 0, p.amount, null
    from public.finance_supplier_payments p
    left join public.finance_supplier_invoices i on i.id = p.invoice_id
    left join public.purchase_orders po on po.id = p.purchase_order_id
    left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
   where p.business_id = b and p.status::text = 'posted' and p.payment_date <= v_to
     and (i.supplier_id = s.id or po.supplier_id = s.id)
  )
  select coalesce(jsonb_agg(to_jsonb(z) - 'k' order by z.d, z.k, z.ref), '[]'::jsonb) into v_lines
    from (select t.*, v_open + sum(charge - paid) over (order by d, k, ref rows unbounded preceding) as balance from t where d between v_from and v_to) z;
  v_close := v_open + v_chg - v_pay;

  return jsonb_build_object(
    'as_of', v_today, 'from', v_from, 'to', v_to,
    'opening', v_open, 'closing', v_close,
    'charges', v_chg,
    'payments_total', v_pay,
    'lines', v_lines,
    'supplier', jsonb_build_object('name', s.legal_name, 'code', s.supplier_code, 'address', s.address, 'phone', s.phone, 'tax_id', s.tax_id),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('si', r.supplier_si, 'dr', r.supplier_dr, 'po', r.po_number,
                                                              'date', i.invoice_date, 'due', i.due_date, 'total', i.total_amount, 'paid', i.amount_paid,
                                                              'balance', i.balance_due, 'days_overdue', greatest(v_today - coalesce(i.due_date, i.invoice_date), 0))
                                             order by i.invoice_date, i.invoice_number)
                            from public.finance_supplier_invoices i
                            left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
                           where i.supplier_id = s.id and i.business_id = b and i.status::text in ('approved','partially_paid') and i.balance_due > 0), '[]'::jsonb),
    'aging', (select jsonb_build_object(
                'current', coalesce(sum(balance_due) filter (where coalesce(due_date, invoice_date) >= v_today), 0),
                'd1_30',   coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 1 and 30), 0),
                'd31_60',  coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 31 and 60), 0),
                'd61_90',  coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) between 61 and 90), 0),
                'd90',     coalesce(sum(balance_due) filter (where v_today - coalesce(due_date, invoice_date) > 90), 0),
                'total',   coalesce(sum(balance_due), 0))
                from public.finance_supplier_invoices
               where supplier_id = s.id and business_id = b and status::text in ('approved','partially_paid') and balance_due > 0),
    -- checks / payments recorded but not yet posted (e.g. post-dated checks)
    'pending', coalesce((select jsonb_agg(jsonb_build_object('date', p.payment_date, 'number', p.payment_number, 'method', p.payment_method,
                                                             'reference', p.reference_number, 'amount', p.amount, 'status', p.status,
                                                             'against', coalesce('DR ' || r.supplier_dr, 'SI ' || r.supplier_si, 'PO ' || po.po_number))
                                            order by p.payment_date, p.payment_number)
                           from public.finance_supplier_payments p
                           left join public.finance_supplier_invoices i on i.id = p.invoice_id
                           left join public.purchase_orders po on po.id = p.purchase_order_id
                           left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
                          where p.business_id = b and p.status::text in ('prepared','reviewed','approved')
                            and (i.supplier_id = s.id or po.supplier_id = s.id)), '[]'::jsonb));
end $$;
grant execute on function public.supplier_statement(uuid, date, date) to authenticated;
