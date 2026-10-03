-- ============================================================================
-- Build 81 — AR-01 / AP-01 (owner, 2026-10-03)
--   AR: show the DR no. and SI no. behind every AR invoice (a sale without an
--       SI shows its DR; several DRs combined on one SI show on one line), in
--       the AR list and on the statement of account.
--   AP: a supplier invoice can be recorded from the supplier's DR when no SI
--       was given (supplier_dr_number); the AP list shows the supplier SI /
--       invoice no., the supplier DR no. (entered, or from the goods receipts
--       of the PO) and our PO no.; a supplier statement (open invoices, aging,
--       payments made) for reconciling with the supplier's own statement.
--   Customer edit and opening balances need no database change (opening
--   balances are ordinary approved invoices, one per customer / supplier).
-- ============================================================================

alter table public.finance_supplier_invoices add column if not exists supplier_dr_number text;

-- ------------------------------------------------------------- AR references --
-- DR / SI numbers of the Storefront sales behind each AR invoice of the store.
create or replace function public.ar_invoice_refs(p_ids uuid[])
returns table(invoice_id uuid, dr_numbers text, si_number text, sale_numbers text)
language sql stable security definer set search_path = public as $$
  select s.ar_invoice_id,
         string_agg(distinct s.dr_number, ', ') filter (where s.dr_number is not null),
         string_agg(distinct btrim(s.si_number), ', ') filter (where s.si_number is not null),
         string_agg(distinct s.sale_number, ', ')
    from public.storefront_sales s
   where s.ar_invoice_id = any(p_ids) and s.status <> 'cancelled'
     and s.business_id = public.pricing_business_id()
     and (public.has_section_access('finance') or public.can_view_storefront() or public.is_super_admin() or public.is_business_admin())
   group by s.ar_invoice_id
$$;
grant execute on function public.ar_invoice_refs(uuid[]) to authenticated;

-- Statement of account: each open invoice carries its DR and SI numbers.
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
               where customer_id = c.id and business_id = b and status in ('approved','partially_paid') and balance_due > 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('date', r.receipt_date, 'number', r.receipt_number, 'method', r.payment_method,
                                                              'reference', r.reference_number, 'amount', r.amount,
                                                              'invoice', coalesce('DR ' || x.dr_numbers, '') || coalesce(case when x.dr_numbers is not null then ', ' else '' end || 'SI ' || x.si_number, '')
                                                                         || case when x.invoice_id is null then i.invoice_number else '' end)
                                             order by r.receipt_date desc, r.receipt_number desc)
                            from public.finance_customer_receipts r join public.finance_customer_invoices i on i.id = r.invoice_id
                            left join lateral (select * from public.ar_invoice_refs(array[i.id])) x on true
                           where i.customer_id = c.id and r.business_id = b and r.status = 'posted' and r.receipt_date >= v_today - 90), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------- AP references --
-- Supplier SI / invoice no., supplier DR no. (entered, else from the PO's goods receipts) and our PO no.
create or replace function public.ap_invoice_refs(p_ids uuid[])
returns table(invoice_id uuid, supplier_si text, supplier_dr text, po_number text)
language sql stable security definer set search_path = public as $$
  select i.id,
         case when i.supplier_dr_number is not null and i.invoice_number = 'DR ' || i.supplier_dr_number then null else i.invoice_number end,
         coalesce(i.supplier_dr_number,
                  (select string_agg(distinct btrim(r.delivery_reference), ', ') from public.logistics_receipts r
                    where r.purchase_order_id = i.purchase_order_id and nullif(btrim(r.delivery_reference), '') is not null)),
         po.po_number
    from public.finance_supplier_invoices i
    left join public.purchase_orders po on po.id = i.purchase_order_id
   where i.id = any(p_ids) and i.business_id = public.pricing_business_id()
     and (public.has_section_access('finance') or public.is_super_admin() or public.is_business_admin())
$$;
grant execute on function public.ap_invoice_refs(uuid[]) to authenticated;

-- Supplier statement: what this store owes the supplier, aging, payments made (last 90 days).
create or replace function public.supplier_statement(p_supplier uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); s record; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not (public.has_section_access('finance') or public.is_super_admin() or public.is_business_admin()) then
    raise exception 'Finance access is required.';
  end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  select * into s from public.finance_suppliers where id = p_supplier;
  if not found then raise exception 'Supplier not found.'; end if;
  return jsonb_build_object(
    'as_of', v_today,
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
    'payments', coalesce((select jsonb_agg(jsonb_build_object('date', p.payment_date, 'number', p.payment_number, 'method', p.payment_method,
                                                              'reference', p.reference_number, 'amount', p.amount,
                                                              'against', case when p.invoice_id is not null then coalesce('SI ' || r.supplier_si, '') || coalesce(case when r.supplier_si is not null then ', ' else '' end || 'DR ' || r.supplier_dr, '')
                                                                              else 'PO ' || po.po_number end)
                                             order by p.payment_date desc, p.payment_number desc)
                            from public.finance_supplier_payments p
                            left join public.finance_supplier_invoices i on i.id = p.invoice_id
                            left join public.purchase_orders po on po.id = p.purchase_order_id
                            left join lateral (select * from public.ap_invoice_refs(array[i.id])) r on true
                           where p.business_id = b and p.status::text = 'posted' and p.payment_date >= v_today - 90
                             and (i.supplier_id = s.id or po.supplier_id = s.id)), '[]'::jsonb));
end $$;
grant execute on function public.supplier_statement(uuid) to authenticated;
