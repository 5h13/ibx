-- ============================================================================
-- Build 88 — AR-02: receive a customer payment, applied to the OLDEST open
--   invoices first (owner, 2026-10-03: "DR1 10,000 + DR2 5,000, payment 12,000
--   → DR1 paid, DR2 balance 3,000").
--   * ar_oldest_allocation(customer, amount): the split, for the preview (no
--     change). Receipts already recorded but not yet posted count as taken.
--   * storefront_collect_ar_oldest(customer, payments): the counter's Receive
--     AR payment — each payment line is split over the open invoices oldest
--     first and posted at once (as before, one AR receipt per invoice part).
--     A check that covers several invoices stays ONE check (one row in Checks,
--     full amount) so deposit / clear / bounce work on the whole check.
--   Finance AR uses ar_oldest_allocation and records draft receipts per
--   invoice, which then go through Finance's usual approval and posting.
-- ============================================================================

create or replace function public.ar_oldest_allocation(p_customer uuid, p_amount numeric)
returns table(invoice_id uuid, invoice_number text, invoice_date date, due_date date, dr text, si text, balance numeric, applied numeric, remaining numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); left_amt numeric := round(coalesce(p_amount, 0), 2); r record; v_take numeric;
begin
  if not (public.can_view_storefront() or public.has_section_access('finance') or public.is_super_admin() or public.is_business_admin()) then
    raise exception 'Sales or Finance access is required.';
  end if;
  for r in
    select i.id, i.invoice_number, i.invoice_date, i.due_date, x.dr_numbers, x.si_number,
           i.balance_due - coalesce((select sum(c.amount) from public.finance_customer_receipts c
                                      where c.invoice_id = i.id and c.status not in ('posted','voided')), 0) as open_bal
      from public.finance_customer_invoices i
      left join lateral (select * from public.ar_invoice_refs(array[i.id])) x on true
     where i.business_id = b and i.customer_id = p_customer and i.status in ('approved','partially_paid') and i.balance_due > 0
     order by i.invoice_date, i.invoice_number   -- same order as the counter's open-invoice list
  loop
    continue when r.open_bal <= 0;
    v_take := least(left_amt, r.open_bal);
    left_amt := left_amt - v_take;
    invoice_id := r.id; invoice_number := r.invoice_number; invoice_date := r.invoice_date; due_date := r.due_date;
    dr := r.dr_numbers; si := r.si_number; balance := r.open_bal; applied := v_take; remaining := r.open_bal - v_take;
    return next;
  end loop;
end $$;
grant execute on function public.ar_oldest_allocation(uuid, numeric) to authenticated;

-- payment guard: let the parts of one split payment share its reference
CREATE OR REPLACE FUNCTION public.guard_storefront_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ref text; v_dup text; v_inv uuid; v_paid numeric; v_refunded numeric; v_label text;
begin
  v_label := case new.method when 'cash' then 'cash' when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' when 'check' then 'check' else 'bank transfer' end;
  if new.kind <> 'refund' and new.method <> 'cash' and nullif(regexp_replace(coalesce(new.reference_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null then
    v_ref := lower(regexp_replace(new.reference_number, '[^A-Za-z0-9]', '', 'g'));
    select payment_number into v_dup from public.storefront_payments
     where business_id = new.business_id and method = new.method and kind <> 'refund'
       and lower(regexp_replace(reference_number, '[^A-Za-z0-9]', '', 'g')) = v_ref limit 1;
    -- Build 88: the later parts of one payment split over several invoices (oldest first) share its reference
    if v_dup is not null and coalesce(current_setting('ibx.ar_split_ref', true), '') = v_ref then v_dup := null; end if;
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
end $function$;

create or replace function public.storefront_collect_ar_oldest(p_customer uuid, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.storefront_business(); p jsonb; v_total numeric := 0; v_owed numeric; a record; v_left numeric; v_part numeric;
  v_id uuid; v_first uuid; v_parts uuid[]; v_lines jsonb := '[]'::jsonb; v_inv uuid[] := '{}'; n_inv int; inv_left jsonb := '{}'::jsonb; k text;
begin
  if not exists (select 1 from public.finance_customers where id = p_customer and business_id = b) then raise exception 'Customer not found in this business.'; end if;
  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_total := v_total + round(coalesce((p->>'amount')::numeric, 0), 2);
  end loop;
  if v_total <= 0 then raise exception 'Enter the amount received.'; end if;
  -- lock the customer's open invoices, then take the split
  perform 1 from public.finance_customer_invoices where business_id = b and customer_id = p_customer and status in ('approved','partially_paid') for update;
  select coalesce(sum(balance), 0) into v_owed from public.ar_oldest_allocation(p_customer, 0);
  if v_owed <= 0 then raise exception 'This customer has no unpaid approved invoices.'; end if;
  if v_total > v_owed then
    raise exception 'Payment ₱% is more than what the customer owes (₱%). Record only the amount applied; give change for cash.', v_total, v_owed;
  end if;
  for a in select * from public.ar_oldest_allocation(p_customer, v_owed) loop
    inv_left := inv_left || jsonb_build_object(a.invoice_id::text, a.balance);
    v_inv := v_inv || a.invoice_id;
  end loop;
  n_inv := array_length(v_inv, 1);

  -- each payment line, split over the invoices oldest first
  for p in select * from jsonb_array_elements(p_payments) loop
    v_left := round((p->>'amount')::numeric, 2); v_parts := '{}';
    for k in select unnest(v_inv)::text loop
      exit when v_left <= 0;
      continue when (inv_left->>k)::numeric <= 0;
      v_part := least(v_left, (inv_left->>k)::numeric);
      v_id := public.storefront_record_payment(b, 'ar_collection', p->>'method', v_part, p->>'reference', null, k::uuid, null,
                'Received at the counter (Storefront), applied oldest invoice first: ' || (select invoice_number from public.finance_customer_invoices where id = k::uuid),
                nullif(p->>'account', '')::uuid,
                -- cash tendered only when the line is not split (change is per line)
                case when v_part = round((p->>'amount')::numeric, 2) then public.sf_pay_extra(p) else public.sf_pay_extra(p) - 'tendered' end
                  || jsonb_build_object('customer_id', p_customer));
      v_parts := v_parts || v_id; v_first := coalesce(v_first, v_id);
      perform set_config('ibx.ar_split_ref', lower(regexp_replace(coalesce(p->>'reference', ''), '[^A-Za-z0-9]', '', 'g')), true);
      inv_left := inv_left || jsonb_build_object(k, (inv_left->>k)::numeric - v_part);
      v_left := v_left - v_part;
      v_lines := v_lines || jsonb_build_object('invoice_id', k, 'method', p->>'method', 'amount', v_part);
    end loop;
    perform set_config('ibx.ar_split_ref', '', true);
    -- one physical check = one check record for its full amount
    if p->>'method' = 'check' and array_length(v_parts, 1) > 1 then
      update public.storefront_checks set amount = round((p->>'amount')::numeric, 2) where payment_id = v_parts[1];
      delete from public.storefront_checks where payment_id = any(v_parts[2:]);
    end if;
  end loop;

  for k in select unnest(v_inv)::text loop perform public.recalculate_customer_invoice_received(k::uuid); end loop;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customers', p_customer, 'storefront_ar_collected_oldest_first', jsonb_build_object('amount', v_total, 'parts', v_lines));
  return jsonb_build_object(
    'amount', v_total, 'owed_before', v_owed, 'balance', v_owed - v_total, 'payment_id', v_first,
    'applied', (select coalesce(jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number, 'dr', x.dr_numbers, 'applied', t.amt, 'balance', i.balance_due) order by i.invoice_date, i.invoice_number), '[]'::jsonb)
                  from (select (l->>'invoice_id')::uuid as id, sum((l->>'amount')::numeric) as amt from jsonb_array_elements(v_lines) l group by 1) t
                  join public.finance_customer_invoices i on i.id = t.id
                  left join lateral (select * from public.ar_invoice_refs(array[i.id])) x on true));
end $$;
grant execute on function public.storefront_collect_ar_oldest(uuid, jsonb) to authenticated;
