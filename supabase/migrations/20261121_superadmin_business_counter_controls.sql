-- ============================================================================
-- Build 70 — Storefront audit fixes, first batch (punchlist DOC-15):
--   SF-07  A Super Admin always works in the "Acting as" business: pricing,
--          Product Search, quotes, Storefront and the quote chain all used the
--          Super Admin's own business_id first. A Super Admin account never
--          carries a business of its own.
--   SF-10  No self-approval: the person who made a below-floor sale cannot
--          approve its price, and whoever submitted a daily closing cannot
--          approve it (the Super Admin is the only exception).
--   SF-11  Refunds go back the way the customer paid: per payment method, a
--          sale can be refunded up to what was paid by that method (at the
--          counter or later on its AR invoice). Anything else needs a Sales
--          approver / Business Admin to process the return.
--   SF-12  A GCash / Maya / card / bank-transfer reference can be used on
--          one payment only; an approver may record it again (e.g. one bank
--          transfer paying two invoices), and that is audited.
--   SF-16  Daily closing cash: opening change fund (float) and cash taken out
--          of the drawer (bank deposit, petty cash, other) are recorded and
--          counted in the expected cash; the closing's totals are computed
--          from exactly the records it locks (no gap while it is saved).
-- ============================================================================

-- ------------------------------------------------------------------ SF-07 --
create or replace function public.pricing_business_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when public.is_super_admin() then public.super_admin_view_business()
              else public.current_business_id() end;
$$;

create or replace function public.guard_super_admin_business()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'super_admin' then new.business_id := null; end if;
  return new;
end $$;
drop trigger if exists users_super_admin_no_business on public.users;
create trigger users_super_admin_no_business before insert or update of role, business_id on public.users
  for each row execute function public.guard_super_admin_business();
update public.users set business_id = null where role = 'super_admin' and business_id is not null;

-- ------------------------------------------------------------------ SF-10 --
create or replace function public.storefront_approve_sale(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver or Business Admin can approve a price below the floor.'; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status <> 'pending_approval' then raise exception 'This sale is not waiting for approval.'; end if;
  if s.created_by = auth.uid() and not public.is_super_admin() then
    raise exception 'You made this sale, so another approver must sign off its price.';
  end if;
  update public.storefront_sales set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_price_approved', jsonb_build_object('sale_number', s.sale_number, 'total', s.total));
end $$;

-- ------------------------------------------------------------ SF-11/SF-12 --
-- Checked on every counter payment, whichever function records it.
create or replace function public.guard_storefront_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text; v_dup text; v_inv uuid; v_paid numeric; v_refunded numeric; v_label text;
begin
  v_label := case new.method when 'cash' then 'cash' when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' else 'bank transfer' end;
  -- SF-12: one reference, one payment (compared ignoring spaces, dashes and case)
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
  -- SF-11: refund per method up to what was paid by that method
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
drop trigger if exists storefront_payments_guard on public.storefront_payments;
create trigger storefront_payments_guard before insert on public.storefront_payments
  for each row execute function public.guard_storefront_payment();

-- What the customer paid, per method, and what can still be refunded (for the return screen).
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
    from (values ('cash'),('gcash'),('maya'),('card'),('bank_transfer')) m(method)
    left join public.storefront_payments p on p.business_id = b and p.method = m.method
         and ((p.kind = 'sale' and p.sale_id = p_sale) or (p.kind = 'refund' and p.sale_id = p_sale)
              or (p.kind = 'ar_collection' and v_inv is not null and p.ar_invoice_id = v_inv))
   group by m.method
  having coalesce(sum(p.amount), 0) > 0;
end $$;

-- ------------------------------------------------------------------ SF-16 --
create table if not exists public.storefront_cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  movement_number text not null unique,
  movement_date date not null default ((now() at time zone 'Asia/Manila')::date),
  kind text not null check (kind in ('float','cash_out')),
  category text check (category in ('bank_deposit','petty_cash','other')),
  amount numeric(14,2) not null check (amount > 0),
  note text,
  closing_id uuid references public.storefront_closings(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  check (kind = 'float' or category is not null)
);
create index if not exists storefront_cash_movements_business_day on public.storefront_cash_movements (business_id, movement_date);
alter table public.storefront_cash_movements enable row level security;
drop policy if exists storefront_cash_movements_business_isolation on public.storefront_cash_movements;
create policy storefront_cash_movements_business_isolation on public.storefront_cash_movements as restrictive for all
  using (public.business_row_visible(business_id)) with check (public.business_row_visible(business_id));
drop policy if exists storefront_cash_movements_read on public.storefront_cash_movements;
create policy storefront_cash_movements_read on public.storefront_cash_movements for select using (public.can_view_storefront());
grant select on public.storefront_cash_movements to authenticated;

alter table public.storefront_closings
  add column if not exists float_total numeric(14,2) not null default 0,
  add column if not exists cash_out_total numeric(14,2) not null default 0;

-- Record the opening change fund, or cash taken out of the drawer.
create or replace function public.storefront_cash_movement(p_kind text, p_amount numeric, p_category text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); v_no text; v_id uuid;
begin
  if p_kind not in ('float','cash_out') then raise exception 'Unknown drawer entry.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero.'; end if;
  if p_kind = 'cash_out' then
    if coalesce(p_category, '') not in ('bank_deposit','petty_cash','other') then raise exception 'Choose what the cash was taken out for.'; end if;
    if p_category = 'other' and coalesce(btrim(p_note), '') = '' then raise exception 'Explain what the cash was taken out for.'; end if;
  end if;
  v_no := public.storefront_next_number('SFM', 'storefront_cash_movements', 'movement_number');
  insert into public.storefront_cash_movements(business_id, movement_number, kind, category, amount, note, created_by)
  values (b, v_no, p_kind, case when p_kind = 'cash_out' then p_category end, round(p_amount, 2), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_cash_movements', v_id, 'storefront_' || p_kind, jsonb_build_object('number', v_no, 'amount', p_amount, 'category', p_category, 'note', p_note));
  return jsonb_build_object('id', v_id, 'movement_number', v_no);
end $$;

-- Totals of a closing: of the records not yet closed up to p_date (preview),
-- or of exactly the records locked by closing p_closing.
create or replace function public.storefront_closing_totals(p_business uuid, p_date date, p_closing uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m jsonb; v_float numeric; v_out numeric;
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
  return jsonb_build_object(
    'by_method', m,
    'float_total', v_float,
    'cash_out_total', v_out,
    'expected_cash', v_float + coalesce((m->>'cash')::numeric, 0) - v_out,
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

create or replace function public.storefront_closing_preview(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return public.storefront_closing_totals(b, p_date, null) || jsonb_build_object(
    'date', p_date,
    'already_closed', exists (select 1 from public.storefront_closings where business_id = b and closing_date = p_date and status <> 'returned'),
    'awaiting_approval', (select count(*) from public.storefront_sales where business_id = b and status in ('pending_approval','approved')),
    'cash_movements', coalesce((select jsonb_agg(jsonb_build_object('number', movement_number, 'date', movement_date, 'kind', kind, 'category', category, 'amount', amount, 'note', note) order by created_at)
                                  from public.storefront_cash_movements where business_id = b and closing_id is null and movement_date <= p_date), '[]'::jsonb));
end $$;

-- Lock first, then total exactly what was locked.
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
         float_total = (t->>'float_total')::numeric, cash_out_total = (t->>'cash_out_total')::numeric,
         expected_cash = (t->>'expected_cash')::numeric, variance = v_var
   where id = v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', v_id, 'storefront_day_closed', jsonb_build_object('closing_number', v_no, 'date', p_date, 'expected_cash', t->>'expected_cash', 'counted_cash', p_counted_cash));
  return jsonb_build_object('id', v_id, 'closing_number', v_no, 'variance', v_var);
end $$;

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

grant execute on function public.storefront_refundable(uuid), public.storefront_cash_movement(text, numeric, text, text) to authenticated;
revoke all on function public.guard_storefront_payment(), public.guard_super_admin_business() from public, authenticated;
