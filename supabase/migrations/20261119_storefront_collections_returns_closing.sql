-- ============================================================================
-- Build 68 — DOC-15 Storefront / Counter Sales, part 2 (user, 2026-09-28):
--   1. Payments on existing (old) AR invoices received at the counter.
--   2. Returns and refunds at the counter — staff may process them without
--      approval, always linked to the original sale with a reason.
--   3. In-app daily closing: expected vs counted cash, a summary per payment
--      method, the day's sales / returns / AR charges, approved by an
--      approver (Sales approver or Business Admin) or returned for a recount.
-- Same security model as part 1: read-only RLS, writes only through the
-- SECURITY DEFINER functions below (role + business checked, amounts
-- recomputed on the server).
-- ============================================================================

-- --------------------------------------------------------- payments: kinds --
alter table public.storefront_payments
  add column if not exists kind text not null default 'sale' check (kind in ('sale','ar_collection','refund')),
  add column if not exists ar_invoice_id uuid references public.finance_customer_invoices(id),
  add column if not exists return_id uuid,
  add column if not exists closing_id uuid;

-- ----------------------------------------------------------------- returns --
create table if not exists public.storefront_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  return_number text not null unique,
  return_date date not null default ((now() at time zone 'Asia/Manila')::date),
  sale_id uuid not null references public.storefront_sales(id),
  reason text not null,
  total numeric(14,2) not null default 0,          -- value of returned goods (at the price charged)
  credit_to_ar numeric(14,2) not null default 0,   -- part that reduced the sale's unpaid AR balance
  refund_total numeric(14,2) not null default 0,   -- part paid back to the customer
  closing_id uuid,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.storefront_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  return_id uuid not null references public.storefront_returns(id) on delete cascade,
  sale_item_id uuid not null references public.storefront_sale_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null,
  line_total numeric(14,2) not null,
  stock_movement_id uuid references public.logistics_stock_movements(id)
);
alter table public.storefront_payments drop constraint if exists storefront_payments_return_fk;
alter table public.storefront_payments add constraint storefront_payments_return_fk foreign key (return_id) references public.storefront_returns(id);

-- ---------------------------------------------------------------- closings --
create table if not exists public.storefront_closings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  closing_number text not null unique,
  closing_date date not null,
  status text not null default 'submitted' check (status in ('submitted','approved','returned')),
  sales_count int not null default 0,
  sales_total numeric(14,2) not null default 0,
  returns_total numeric(14,2) not null default 0,
  charged_to_ar numeric(14,2) not null default 0,
  ar_collected numeric(14,2) not null default 0,
  by_method jsonb not null default '{}'::jsonb,   -- net received per method: {cash: .., gcash: ..}
  expected_cash numeric(14,2) not null default 0,
  counted_cash numeric(14,2) not null,
  variance numeric(14,2) not null default 0,      -- counted - expected
  notes text,
  submitted_by uuid references public.users(id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index if not exists storefront_closings_one_per_day on public.storefront_closings (business_id, closing_date) where status <> 'returned';
alter table public.storefront_payments drop constraint if exists storefront_payments_closing_fk;
alter table public.storefront_payments add constraint storefront_payments_closing_fk foreign key (closing_id) references public.storefront_closings(id);
alter table public.storefront_returns drop constraint if exists storefront_returns_closing_fk;
alter table public.storefront_returns add constraint storefront_returns_closing_fk foreign key (closing_id) references public.storefront_closings(id);
alter table public.storefront_sales add column if not exists closing_id uuid references public.storefront_closings(id);

do $$
declare t text;
begin
  foreach t in array array['storefront_returns','storefront_return_items','storefront_closings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_business_isolation', t);
    execute format('create policy %I on public.%I as restrictive for all using (public.business_row_visible(business_id)) with check (public.business_row_visible(business_id))', t || '_business_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.can_view_storefront())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- helper: record one counter payment (optionally as a posted AR receipt)
create or replace function public.storefront_record_payment(p_business uuid, p_kind text, p_method text, p_amount numeric, p_reference text,
                                                            p_sale uuid, p_invoice uuid, p_return uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_no text; v_rec uuid; v_code text; v_id uuid;
begin
  if p_method not in ('cash','gcash','maya','card','bank_transfer') then raise exception 'Unknown payment method %.', p_method; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
  if p_method <> 'cash' and coalesce(btrim(p_reference), '') = '' then raise exception 'Enter the reference number for the % payment.', case p_method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' else 'bank transfer' end; end if;
  select code into v_code from public.businesses where id = p_business;
  v_no := public.storefront_next_number(case when p_kind = 'refund' then 'SFX' else 'SFP' end, 'storefront_payments', 'payment_number');
  if p_invoice is not null and p_kind <> 'refund' then
    insert into public.finance_customer_receipts(business_id, receipt_number, invoice_id, receipt_date, amount, payment_method, reference_number, notes, status,
                                                 prepared_by, prepared_at, approved_by, approved_at, posted_by, posted_at, created_by)
    values (p_business, v_code || '-' || v_no, p_invoice, (now() at time zone 'Asia/Manila')::date, round(p_amount, 2), p_method, nullif(btrim(p_reference), ''), p_note,
            'posted', auth.uid(), now(), auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_rec;
  end if;
  insert into public.storefront_payments(business_id, payment_number, kind, sale_id, ar_invoice_id, return_id, method, amount, reference_number, ar_receipt_id, received_by)
  values (p_business, v_no, p_kind, p_sale, p_invoice, p_return, p_method, round(p_amount, 2), nullif(btrim(p_reference), ''), v_rec, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.storefront_record_payment(uuid, text, text, numeric, text, uuid, uuid, uuid, text) from public, authenticated;

-- ------------------------------------------------ 1. old AR at the counter --
-- Open invoices of a customer (Sales cannot read AR directly).
create or replace function public.storefront_open_invoices(p_customer uuid)
returns table(invoice_id uuid, invoice_number text, invoice_date date, due_date date, total_amount numeric, amount_received numeric, balance_due numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return query
  select i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.amount_received, i.balance_due
    from public.finance_customer_invoices i
   where i.business_id = b and i.customer_id = p_customer and i.status in ('approved','partially_paid') and i.balance_due > 0
   order by i.invoice_date, i.invoice_number;
end $$;

create or replace function public.storefront_collect_ar(p_invoice uuid, p_payments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); inv record; p record; v_total numeric := 0;
begin
  select * into inv from public.finance_customer_invoices where id = p_invoice and business_id = b for update;
  if not found then raise exception 'Invoice not found in this business.'; end if;
  if inv.status in ('paid','voided') then raise exception 'Invoice % is already %.', inv.invoice_number, inv.status; end if;
  if inv.status not in ('approved','partially_paid') then raise exception 'Invoice % is not approved yet; Finance must approve it first.', inv.invoice_number; end if;
  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text) loop
    v_total := v_total + round(coalesce(p.amount, 0), 2);
  end loop;
  if v_total <= 0 then raise exception 'Enter the amount received.'; end if;
  if v_total > inv.balance_due then raise exception 'Payment ₱% is more than the invoice balance ₱%.', v_total, inv.balance_due; end if;
  for p in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric, reference text) loop
    perform public.storefront_record_payment(b, 'ar_collection', p.method, p.amount, p.reference, null, inv.id, null,
                                             'Received at the counter (Storefront) for invoice ' || inv.invoice_number);
  end loop;
  -- amount_received and status (partially_paid / paid) follow the posted receipts
  perform public.recalculate_customer_invoice_received(inv.id);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customer_invoices', inv.id, 'storefront_ar_collected', jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total));
  return jsonb_build_object('invoice_number', inv.invoice_number, 'amount', v_total, 'balance', inv.balance_due - v_total);
end $$;

-- ------------------------------------------------------- 2. returns/refunds --
-- A completed sale with what can still be returned per line.
create or replace function public.storefront_sale_for_return(p_sale_number text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; v_bal numeric := 0;
begin
  select ss.*, c.legal_name into s from public.storefront_sales ss join public.finance_customers c on c.id = ss.customer_id
   where ss.business_id = b and upper(btrim(ss.sale_number)) = upper(btrim(p_sale_number));
  if not found then raise exception 'Sale % not found in this store.', p_sale_number; end if;
  if s.status <> 'completed' then raise exception 'Only a completed sale can be returned (this one is %).', replace(s.status, '_', ' '); end if;
  if s.ar_invoice_id is not null then select balance_due into v_bal from public.finance_customer_invoices where id = s.ar_invoice_id; end if;
  return jsonb_build_object('id', s.id, 'sale_number', s.sale_number, 'sale_date', s.sale_date, 'customer', s.legal_name, 'total', s.total,
    'ar_balance', coalesce(v_bal, 0),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sale_item_id', i.id, 'description', i.description, 'unit', i.unit, 'item_type', i.item_type,
                'sold', i.quantity, 'unit_price', i.unit_price,
                'returned', coalesce((select sum(ri.quantity) from public.storefront_return_items ri where ri.sale_item_id = i.id), 0)) order by i.description)
              from public.storefront_sale_items i where i.sale_id = s.id), '[]'::jsonb));
end $$;

-- p = {sale_id, reason, lines:[{sale_item_id, quantity}], refunds:[{method, amount, reference}]}
-- Value returned first reduces the sale's unpaid AR balance; the rest must be refunded exactly.
create or replace function public.storefront_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record; l record; si record; r record; v_ret uuid; v_no text;
        v_total numeric := 0; v_credit numeric := 0; v_refund numeric := 0; v_paid_refund numeric := 0; v_bal numeric := 0; v_mov uuid; v_inv_item uuid; v_done numeric;
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
    end if;
    insert into public.storefront_return_items(business_id, return_id, sale_item_id, quantity, unit_price, line_total, stock_movement_id)
    values (b, v_ret, si.id, l.quantity, si.unit_price, round(l.quantity * si.unit_price, 2), v_mov);
    v_total := v_total + round(l.quantity * si.unit_price, 2);
  end loop;
  if v_total <= 0 then raise exception 'Choose at least one item to return.'; end if;

  -- credit the unpaid AR balance of this sale first (as a return discount on the invoice)
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

  for r in select * from jsonb_to_recordset(coalesce(p->'refunds', '[]'::jsonb)) as x(method text, amount numeric, reference text) loop
    if coalesce(r.amount, 0) <= 0 then continue; end if;
    perform public.storefront_record_payment(b, 'refund', r.method, r.amount, r.reference, s.id, null, v_ret, 'Refund for return ' || v_no);
    v_paid_refund := v_paid_refund + round(r.amount, 2);
  end loop;
  if v_paid_refund <> v_refund then
    raise exception 'Refund to give is ₱% (returned ₱%, of which ₱% reduces the unpaid balance); the refund entered is ₱%.', v_refund, v_total, v_credit, v_paid_refund;
  end if;

  update public.storefront_returns set total = v_total, credit_to_ar = v_credit, refund_total = v_refund where id = v_ret;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_returns', v_ret, 'storefront_return', jsonb_build_object('return_number', v_no, 'sale_number', s.sale_number, 'total', v_total, 'credit_to_ar', v_credit, 'refund', v_refund, 'reason', btrim(p->>'reason')));
  return jsonb_build_object('id', v_ret, 'return_number', v_no, 'total', v_total, 'credit_to_ar', v_credit, 'refund', v_refund);
end $$;

-- ------------------------------------------------------- 3. daily closing --
-- Everything received / sold on or before the date and not yet in a closing.
create or replace function public.storefront_closing_preview(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v jsonb; m jsonb;
begin
  select coalesce(jsonb_object_agg(method, net), '{}'::jsonb) into m from (
    select method, sum(case when kind = 'refund' then -amount else amount end) as net
      from public.storefront_payments
     where business_id = b and closing_id is null and (received_at at time zone 'Asia/Manila')::date <= p_date
     group by method) x;
  select jsonb_build_object(
    'date', p_date,
    'by_method', m,
    'expected_cash', coalesce((m->>'cash')::numeric, 0),
    'sales_count', (select count(*) from public.storefront_sales where business_id = b and status = 'completed' and closing_id is null and sale_date <= p_date),
    'sales_total', coalesce((select sum(total) from public.storefront_sales where business_id = b and status = 'completed' and closing_id is null and sale_date <= p_date), 0),
    'charged_to_ar', coalesce((select sum(balance) from public.storefront_sales where business_id = b and status = 'completed' and closing_id is null and sale_date <= p_date), 0),
    'returns_total', coalesce((select sum(total) from public.storefront_returns where business_id = b and closing_id is null and return_date <= p_date), 0),
    'ar_collected', coalesce((select sum(amount) from public.storefront_payments where business_id = b and closing_id is null and kind = 'ar_collection' and (received_at at time zone 'Asia/Manila')::date <= p_date), 0),
    'already_closed', exists (select 1 from public.storefront_closings where business_id = b and closing_date = p_date and status <> 'returned'),
    'awaiting_approval', (select count(*) from public.storefront_sales where business_id = b and status in ('pending_approval','approved'))
  ) into v;
  return v;
end $$;

create or replace function public.storefront_close_day(p_date date, p_counted_cash numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); pv jsonb; v_id uuid; v_no text;
begin
  if p_date is null or p_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Choose today or an earlier date.'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Enter the cash counted in the drawer.'; end if;
  if exists (select 1 from public.storefront_closings where business_id = b and closing_date = p_date and status <> 'returned') then
    raise exception 'This day is already closed (or waiting for approval).';
  end if;
  pv := public.storefront_closing_preview(p_date);
  v_no := public.storefront_next_number('SFC', 'storefront_closings', 'closing_number');
  insert into public.storefront_closings(business_id, closing_number, closing_date, sales_count, sales_total, returns_total, charged_to_ar, ar_collected,
                                          by_method, expected_cash, counted_cash, variance, notes, submitted_by)
  values (b, v_no, p_date, (pv->>'sales_count')::int, (pv->>'sales_total')::numeric, (pv->>'returns_total')::numeric, (pv->>'charged_to_ar')::numeric,
          (pv->>'ar_collected')::numeric, pv->'by_method', (pv->>'expected_cash')::numeric, round(p_counted_cash, 2),
          round(p_counted_cash, 2) - (pv->>'expected_cash')::numeric, nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;
  update public.storefront_payments set closing_id = v_id where business_id = b and closing_id is null and (received_at at time zone 'Asia/Manila')::date <= p_date;
  update public.storefront_sales set closing_id = v_id where business_id = b and status = 'completed' and closing_id is null and sale_date <= p_date;
  update public.storefront_returns set closing_id = v_id where business_id = b and closing_id is null and return_date <= p_date;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', v_id, 'storefront_day_closed', jsonb_build_object('closing_number', v_no, 'date', p_date, 'expected_cash', pv->>'expected_cash', 'counted_cash', p_counted_cash));
  return jsonb_build_object('id', v_id, 'closing_number', v_no, 'variance', round(p_counted_cash, 2) - (pv->>'expected_cash')::numeric);
end $$;

-- Approver: approve, or return for a recount (unlocks the day's records)
create or replace function public.storefront_decide_closing(p_closing uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); c record;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver or Business Admin can approve a daily closing.'; end if;
  select * into c from public.storefront_closings where id = p_closing and business_id = b for update;
  if not found then raise exception 'Closing not found.'; end if;
  if c.status <> 'submitted' then raise exception 'This closing was already decided.'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Say why the closing is returned (e.g. recount the cash).'; end if;
  if p_approve then
    update public.storefront_closings set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = c.id;
  else
    update public.storefront_closings set status = 'returned', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where id = c.id;
    update public.storefront_payments set closing_id = null where closing_id = c.id;
    update public.storefront_sales set closing_id = null where closing_id = c.id;
    update public.storefront_returns set closing_id = null where closing_id = c.id;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', c.id, case when p_approve then 'storefront_closing_approved' else 'storefront_closing_returned' end,
          jsonb_build_object('closing_number', c.closing_number, 'variance', c.variance, 'note', p_note));
end $$;

grant execute on function public.storefront_open_invoices(uuid), public.storefront_collect_ar(uuid, jsonb), public.storefront_sale_for_return(text),
  public.storefront_return(jsonb), public.storefront_closing_preview(date), public.storefront_close_day(date, numeric, text),
  public.storefront_decide_closing(uuid, boolean, text) to authenticated;
