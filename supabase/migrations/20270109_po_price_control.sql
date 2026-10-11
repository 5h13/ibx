-- Build 103 — purchase price control.
--   * Every PO line is one of: priced (a price above zero), "To be quoted", or "Free / no charge" (with a reason).
--     A line with no price and neither tick cannot go past draft (prepare / review / approve are refused).
--   * "To be quoted" lines: the supplier's quote is entered on the line ("Enter quote", Finance preparer / reviewer /
--     approver) and confirmed by a Finance approver or the Business Admin (not the person who entered it, unless
--     Business Admin). Goods may be received before the price is confirmed; on confirmation the received quantity
--     is costed (Dr 1200 Inventory / Cr 2010 Received not billed, the item's average cost and its lots).
--   * Supplier bills: a line of a not-yet-confirmed quote cannot be approved; a billed price above the PO price by
--     more than the store's tolerance (default 2 %), or any charge on a free line, needs the Business Admin.
--   * The PO review shows each priced line against the last purchase price from that supplier; more than the
--     store's flag level (default 10 %) above it is flagged for the approver.
--   * Purchase price history: "to be quoted" and free lines are not recorded at approval (so a ₱0 never becomes the
--     "last price"); a confirmed quote is recorded when it is confirmed.

-- ── PO line columns ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.purchase_order_items add column if not exists price_status text not null default 'priced';
alter table public.purchase_order_items add column if not exists price_note text;
alter table public.purchase_order_items add column if not exists quote_price numeric(14,4);
alter table public.purchase_order_items add column if not exists quote_reference text;
alter table public.purchase_order_items add column if not exists quote_entered_by uuid references public.users(id);
alter table public.purchase_order_items add column if not exists quote_entered_at timestamptz;
alter table public.purchase_order_items add column if not exists quote_approved_by uuid references public.users(id);
alter table public.purchase_order_items add column if not exists quote_approved_at timestamptz;
alter table public.purchase_order_items add column if not exists quote_journal_id uuid references public.finance_journal_entries(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_order_items_price_status_check') then
    alter table public.purchase_order_items add constraint purchase_order_items_price_status_check
      check (price_status in ('priced', 'to_be_quoted', 'quoted', 'free'));
  end if;
end $$;

-- ── per-store settings ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.procurement_price_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  po_increase_flag_pct numeric(7,2) not null default 10,
  bill_tolerance_pct numeric(7,2) not null default 2,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.procurement_price_settings enable row level security;
drop policy if exists procurement_price_settings_read on public.procurement_price_settings;
create policy procurement_price_settings_read on public.procurement_price_settings for select
  using (public.is_super_admin() or business_id = public.current_business_id());
grant select on public.procurement_price_settings to authenticated;

create or replace function public.procurement_price_setting(p_business uuid)
returns public.procurement_price_settings language sql stable security definer set search_path = public as $$
  select coalesce((select s from public.procurement_price_settings s where s.business_id = p_business),
                  row(p_business, 10, 2, null, now())::public.procurement_price_settings);
$$;
revoke all on function public.procurement_price_setting(uuid) from public;

create or replace function public.fin_role(p_role text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or public.has_workflow_role((select id from public.sections where code = 'finance'), p_role::public.workflow_role);
$$;
revoke all on function public.fin_role(text) from public;
grant execute on function public.fin_role(text) to authenticated;

-- ── PO line guard: no back doors around the quote confirmation ─────────────────────────────────────────────────
create or replace function public.po_item_price_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_api boolean := current_user in ('authenticated', 'anon'); v_status text;
begin
  new.price_status := coalesce(new.price_status, 'priced');
  if new.price_status in ('to_be_quoted', 'free') then new.unit_cost := 0; end if;
  if new.price_status = 'free' then new.price_note := nullif(btrim(coalesce(new.price_note, '')), ''); end if;
  if not v_api then return new; end if;
  select status::text into v_status from public.purchase_orders where id = new.purchase_order_id;
  if tg_op = 'INSERT' then
    if new.price_status = 'quoted' or new.quote_approved_at is not null or new.quote_price is not null then
      raise exception 'A quoted price is entered with "Enter quote" on an approved PO and confirmed by the approver.';
    end if;
    return new;
  end if;
  if (new.quote_price, new.quote_reference, new.quote_entered_by, new.quote_entered_at, new.quote_approved_by, new.quote_approved_at, new.quote_journal_id)
     is distinct from (old.quote_price, old.quote_reference, old.quote_entered_by, old.quote_entered_at, old.quote_approved_by, old.quote_approved_at, old.quote_journal_id)
     or (new.price_status = 'quoted' and old.price_status <> 'quoted') then
    raise exception 'Quotes are entered with "Enter quote" and confirmed with "Approve quote".';
  end if;
  if v_status in ('approved', 'posted', 'paid')
     and (new.unit_cost is distinct from old.unit_cost or new.price_status is distinct from old.price_status) then
    raise exception 'The prices of an approved PO cannot be changed here. A "To be quoted" line gets its price with "Enter quote".';
  end if;
  return new;
end $$;
drop trigger if exists purchase_order_items_price_guard on public.purchase_order_items;
create trigger purchase_order_items_price_guard before insert or update on public.purchase_order_items
  for each row execute function public.po_item_price_guard();

-- ── PO status guard: every line priced, to be quoted, or free with a reason ────────────────────────────────────
create or replace function public.po_price_complete_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_bad text;
begin
  if new.status::text in ('prepared', 'reviewed', 'approved') and new.status is distinct from old.status then
    select string_agg(coalesce(nullif(description, ''), 'a line'), ', ') into v_bad from public.purchase_order_items
     where purchase_order_id = new.id and price_status = 'priced' and coalesce(unit_cost, 0) <= 0;
    if v_bad is not null then
      raise exception 'No price on: %. Enter the price, or mark the line "To be quoted" or "Free / no charge".', v_bad;
    end if;
    select string_agg(coalesce(nullif(description, ''), 'a line'), ', ') into v_bad from public.purchase_order_items
     where purchase_order_id = new.id and price_status = 'free' and price_note is null;
    if v_bad is not null then
      raise exception 'Give the reason the line is free of charge: %.', v_bad;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_price_complete on public.purchase_orders;
create trigger purchase_orders_price_complete before update of status on public.purchase_orders
  for each row execute function public.po_price_complete_guard();

-- the subtotal follows the lines (quoted prices change it after approval)
create or replace function public.po_refresh_subtotal(p_po uuid) returns void language sql security definer set search_path = public as $$
  update public.purchase_orders set subtotal = coalesce((select round(sum(amount), 2) from public.purchase_order_items where purchase_order_id = p_po), 0),
         updated_at = now() where id = p_po;
$$;
revoke all on function public.po_refresh_subtotal(uuid) from public;

-- ── price history: no ₱0 "last price" from quotes or free lines ────────────────────────────────────────────────
create or replace function public.capture_po_price_history(p_po_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.finance_item_supplier_price_history(
    business_id, item_id, supplier_id, supplier_item_code, purchase_order_id, purchase_order_item_id,
    purchase_date, quantity, unit, po_unit_price)
  select po.business_id, i.item_id, po.supplier_id,
         coalesce(i.supplier_item_code, s.supplier_item_code),
         po.id, i.id, po.order_date, i.quantity, i.unit, coalesce(i.unit_cost, 0)
    from public.purchase_orders po
    join public.purchase_order_items i on i.purchase_order_id = po.id
    left join public.finance_procurement_item_suppliers s on s.supplier_id = po.supplier_id and s.item_id = i.item_id
   where po.id = p_po_id and po.supplier_id is not null and i.item_id is not null
     and i.price_status in ('priced', 'quoted') and coalesce(i.unit_cost, 0) > 0     -- Build 103
  on conflict (purchase_order_item_id) do nothing;
end $$;

-- ── received quantity of a PO line (posted receipts) ───────────────────────────────────────────────────────────
create or replace function public.po_line_received(p_item uuid, p_uncosted_only boolean default false)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(ri.accepted_qty), 0)
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    join public.logistics_receipts r on r.purchase_order_id = po.id and r.status::text = 'posted'
    join public.logistics_receipt_items ri on ri.receipt_id = r.id
    join public.logistics_inventory_items ii on ii.id = ri.inventory_item_id and ii.procurement_item_id = poi.item_id
   where poi.id = p_item and (not p_uncosted_only or coalesce(ri.unit_cost, 0) = 0);
$$;
revoke all on function public.po_line_received(uuid, boolean) from public;

-- ── Enter quote (purchasing) ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.po_quote_enter(p_item uuid, p_price numeric, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
declare i record;
begin
  select poi.*, po.status::text as po_status, po.issuance_status, po.business_id as po_business, po.po_number
    into i from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id where poi.id = p_item for update of poi;
  if not found then raise exception 'PO line not found.'; end if;
  if not (public.is_super_admin() or i.po_business = public.current_business_id()) then raise exception 'This PO belongs to another store.'; end if;
  if not (public.fin_role('preparer') or public.fin_role('reviewer') or public.fin_role('approver')) then
    raise exception 'A Finance preparer, reviewer or approver enters supplier quotes.';
  end if;
  if i.price_status <> 'to_be_quoted' then raise exception 'This line is not waiting for a quote.'; end if;
  if i.po_status not in ('approved', 'posted') or i.issuance_status = 'cancelled' then
    raise exception 'Quotes are entered on approved POs. On a draft PO, just type the price on the line.';
  end if;
  if coalesce(p_price, 0) <= 0 then raise exception 'Enter the quoted unit price (above zero).'; end if;
  if nullif(btrim(coalesce(p_reference, '')), '') is null then raise exception 'Enter the quote reference (quotation no., message or email date).'; end if;
  update public.purchase_order_items set quote_price = round(p_price, 4), quote_reference = btrim(p_reference),
         quote_entered_by = auth.uid(), quote_entered_at = now(), quote_approved_by = null, quote_approved_at = null, updated_at = now()
   where id = p_item;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'purchase_order_items', p_item, 'quote_entered',
          jsonb_build_object('po', i.po_number, 'description', i.description, 'price', round(p_price, 4), 'reference', btrim(p_reference)));
end $$;
revoke all on function public.po_quote_enter(uuid, numeric, text) from public;
grant execute on function public.po_quote_enter(uuid, numeric, text) to authenticated;

-- ── Approve / reject quote (approver) ──────────────────────────────────────────────────────────────────────────
create or replace function public.po_quote_decide(p_item uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i record; ii record; v_qty numeric := 0; v_onhand numeric; v_amount numeric := 0; v_je uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select poi.*, po.status::text as po_status, po.business_id as po_business, po.po_number, po.supplier_id as po_supplier, po.order_date
    into i from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id where poi.id = p_item for update of poi;
  if not found then raise exception 'PO line not found.'; end if;
  if not (public.is_super_admin() or i.po_business = public.current_business_id()) then raise exception 'This PO belongs to another store.'; end if;
  if not public.fin_role('approver') then raise exception 'A Finance approver or the Business Admin confirms quoted prices.'; end if;
  if i.price_status <> 'to_be_quoted' or i.quote_price is null then raise exception 'There is no quote waiting for approval on this line.'; end if;
  if i.quote_entered_by = auth.uid() and not (public.is_super_admin() or public.is_business_admin()) then
    raise exception 'The quote must be confirmed by someone other than the person who entered it.';
  end if;

  if not p_approve then
    if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for rejecting the quote.'; end if;
    update public.purchase_order_items set quote_price = null, quote_reference = null, quote_entered_by = null, quote_entered_at = null,
           price_note = 'Quote rejected: ' || btrim(p_reason), updated_at = now() where id = p_item;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'purchase_order_items', p_item, 'quote_rejected', jsonb_build_object('po', i.po_number, 'price', i.quote_price, 'reason', btrim(p_reason)));
    return jsonb_build_object('approved', false);
  end if;

  -- the line now has its price
  update public.purchase_order_items set unit_cost = i.quote_price, price_status = 'quoted', price_note = null,
         quote_approved_by = auth.uid(), quote_approved_at = now(), updated_at = now() where id = p_item;
  perform public.po_refresh_subtotal(i.purchase_order_id);

  -- price history (the confirmed price is this supplier's latest)
  if i.item_id is not null and i.po_supplier is not null then
    insert into public.finance_item_supplier_price_history(business_id, item_id, supplier_id, supplier_item_code, purchase_order_id,
           purchase_order_item_id, purchase_date, quantity, unit, po_unit_price)
    values (i.po_business, i.item_id, i.po_supplier, i.supplier_item_code, i.purchase_order_id, i.id, i.order_date, i.quantity, i.unit, i.quote_price)
    on conflict (purchase_order_item_id) do nothing;
  end if;

  -- goods already received at no cost: cost them now
  select * into ii from public.logistics_inventory_items where procurement_item_id = i.item_id and business_id = i.po_business limit 1;
  if found then
    v_qty := public.po_line_received(p_item, true);
    -- receipts not yet posted pick up the price
    update public.logistics_receipt_items ri set unit_cost = i.quote_price
      from public.logistics_receipts r
     where r.id = ri.receipt_id and r.purchase_order_id = i.purchase_order_id and r.status::text <> 'posted'
       and ri.inventory_item_id = ii.id and coalesce(ri.unit_cost, 0) = 0;
    if v_qty > 0 then
      v_amount := round(v_qty * i.quote_price, 2);
      v_je := public.fin_auto_journal(i.po_business, v_today, 'Quoted price confirmed ' || i.po_number || ' — ' || coalesce(i.description, ''),
        'po_quote', p_item, public.fin_norm_lines(jsonb_build_array(
          jsonb_build_object('code', '1200', 'debit', v_amount, 'text', 'Received before price: ' || i.po_number),
          jsonb_build_object('code', '2010', 'credit', v_amount, 'text', 'Received, not yet billed ' || i.po_number))));
      update public.purchase_order_items set quote_journal_id = v_je where id = p_item;
      v_onhand := public.inventory_business_on_hand(i.po_business, ii.id);
      perform public.inventory_cost_receive(i.po_business, ii.id, v_qty, i.quote_price, 'po_quote_confirm', p_item, v_today, greatest(v_onhand - v_qty, 0));
      update public.inventory_lots set unit_cost = i.quote_price
       where purchase_order_id = i.purchase_order_id and inventory_item_id = ii.id and coalesce(unit_cost, 0) = 0;
    end if;
  end if;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'purchase_order_items', p_item, 'quote_approved',
          jsonb_build_object('po', i.po_number, 'description', i.description, 'price', i.quote_price, 'reference', i.quote_reference,
                             'received_costed', v_qty, 'inventory_value', v_amount));
  return jsonb_build_object('approved', true, 'received_costed', v_qty, 'inventory_value', v_amount);
end $$;
revoke all on function public.po_quote_decide(uuid, boolean, text) from public;
grant execute on function public.po_quote_decide(uuid, boolean, text) to authenticated;

-- ── open quotes list ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.po_open_quotes()
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (select coalesce(public.current_business_id(), public.super_admin_view_business()) as id)
  select coalesce(jsonb_agg(x order by x->>'po_approved_at', x->>'po_number'), '[]'::jsonb) from (
    select jsonb_build_object('id', poi.id, 'po_id', po.id, 'po_number', po.po_number, 'supplier', s.legal_name,
             'description', poi.description, 'quantity', poi.quantity, 'unit', poi.unit,
             'received', public.po_line_received(poi.id), 'quote_price', poi.quote_price, 'quote_reference', poi.quote_reference,
             'entered_by', ue.full_name, 'entered_by_id', poi.quote_entered_by, 'entered_at', poi.quote_entered_at, 'note', poi.price_note,
             'po_approved_at', po.approved_at, 'days_open', (now() at time zone 'Asia/Manila')::date - coalesce(po.approved_at, po.created_at)::date,
             'state', case when poi.quote_price is null then 'waiting' else 'to_approve' end) as x
      from public.purchase_order_items poi
      join public.purchase_orders po on po.id = poi.purchase_order_id
      left join public.finance_suppliers s on s.id = po.supplier_id
      left join public.users ue on ue.id = poi.quote_entered_by, b
     where poi.price_status = 'to_be_quoted' and po.status::text in ('approved', 'posted') and coalesce(po.issuance_status, '') <> 'cancelled'
       and (b.id is null and public.is_super_admin() or po.business_id = b.id)
  ) q;
$$;
revoke all on function public.po_open_quotes() from public;
grant execute on function public.po_open_quotes() to authenticated;

-- ── PO review: each priced line against the last price from the supplier ───────────────────────────────────────
create or replace function public.po_review_lines(p_po uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare po record; v_flag numeric;
begin
  select * into po from public.purchase_orders where id = p_po;
  if not found or not (public.is_super_admin() or po.business_id = public.current_business_id()) then return '[]'::jsonb; end if;
  v_flag := (public.procurement_price_setting(po.business_id)).po_increase_flag_pct;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'last_price', h.price, 'last_date', h.purchase_date, 'last_po', h.po_number,
           'change_pct', case when h.price > 0 and i.price_status in ('priced', 'quoted') then round((i.unit_cost - h.price) / h.price * 100, 1) end,
           'flag', h.price > 0 and i.price_status in ('priced', 'quoted') and i.unit_cost > h.price * (1 + v_flag / 100), 'flag_pct', v_flag))
    from public.purchase_order_items i
    left join lateral (select ph.effective_unit_price as price, ph.purchase_date, p2.po_number
                         from public.finance_item_supplier_price_history ph left join public.purchase_orders p2 on p2.id = ph.purchase_order_id
                        where ph.business_id = po.business_id and ph.item_id = i.item_id and ph.supplier_id = po.supplier_id
                          and ph.purchase_order_id is distinct from po.id and ph.effective_unit_price > 0
                        order by ph.purchase_date desc, ph.created_at desc limit 1) h on true
   where i.purchase_order_id = p_po), '[]'::jsonb);
end $$;
revoke all on function public.po_review_lines(uuid) from public;
grant execute on function public.po_review_lines(uuid) to authenticated;

-- ── supplier bill check at approval ────────────────────────────────────────────────────────────────────────────
create or replace function public.supplier_bill_price_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tol numeric; v_line record; v_list text; v_msgs text[] := '{}';
begin
  if new.status::text <> 'approved' or old.status::text = 'approved' or coalesce(new.is_opening, false) then return new; end if;
  -- quotes must be confirmed first (no one can approve around this)
  select string_agg(coalesce(nullif(poi.description, ''), 'a line'), ', ') into v_list
    from public.finance_supplier_invoice_items it join public.purchase_order_items poi on poi.id = it.purchase_order_item_id
   where it.invoice_id = new.id and poi.price_status = 'to_be_quoted';
  if v_list is not null then
    raise exception 'The quoted price of % is not confirmed yet. Enter and approve the quote on the PO first.', v_list;
  end if;
  if public.is_super_admin() or public.is_business_admin() then return new; end if;
  v_tol := (public.procurement_price_setting(new.business_id)).bill_tolerance_pct;
  for v_line in
    select coalesce(nullif(poi.description, ''), it.description, 'a line') as d, it.unit_cost as billed, poi.unit_cost as po_price, poi.price_status
      from public.finance_supplier_invoice_items it join public.purchase_order_items poi on poi.id = it.purchase_order_item_id
     where it.invoice_id = new.id
  loop
    if v_line.price_status = 'free' and coalesce(v_line.billed, 0) > 0 then
      v_msgs := v_msgs || format('%s is free of charge on the PO but billed at ₱%s', v_line.d, to_char(v_line.billed, 'FM999,999,990.00'));
    elsif coalesce(v_line.po_price, 0) > 0 and coalesce(v_line.billed, 0) > round(v_line.po_price * (1 + v_tol / 100), 4) then
      v_msgs := v_msgs || format('%s billed at ₱%s, PO price ₱%s (+%s%%)', v_line.d, to_char(v_line.billed, 'FM999,999,990.00'),
                                 to_char(v_line.po_price, 'FM999,999,990.00'), round((v_line.billed - v_line.po_price) / v_line.po_price * 100, 1));
    end if;
  end loop;
  if array_length(v_msgs, 1) > 0 then
    raise exception 'This bill needs the Business Admin''s approval: %. (Bills may be up to % %% above the PO price.)',
      array_to_string(v_msgs, '; '), rtrim(rtrim(v_tol::text, '0'), '.');
  end if;
  return new;
end $$;
drop trigger if exists finance_supplier_invoices_price_guard on public.finance_supplier_invoices;
create trigger finance_supplier_invoices_price_guard before update of status on public.finance_supplier_invoices
  for each row execute function public.supplier_bill_price_guard();

-- ── settings get / save ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.procurement_price_settings_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.pricing_business_id() is null then null else
    (select jsonb_build_object('po_increase_flag_pct', s.po_increase_flag_pct, 'bill_tolerance_pct', s.bill_tolerance_pct)
       from public.procurement_price_setting(public.pricing_business_id()) s) end;
$$;
revoke all on function public.procurement_price_settings_get() from public;
grant execute on function public.procurement_price_settings_get() to authenticated;

create or replace function public.procurement_price_settings_save(p_flag numeric, p_tolerance numeric)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'The Business Admin sets the price-control levels.'; end if;
  if p_flag is null or p_flag < 0 or p_flag > 100 or p_tolerance is null or p_tolerance < 0 or p_tolerance > 100 then
    raise exception 'Enter percentages from 0 to 100.';
  end if;
  insert into public.procurement_price_settings(business_id, po_increase_flag_pct, bill_tolerance_pct, updated_by, updated_at)
  values (b, p_flag, p_tolerance, auth.uid(), now())
  on conflict (business_id) do update set po_increase_flag_pct = excluded.po_increase_flag_pct, bill_tolerance_pct = excluded.bill_tolerance_pct,
    updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.procurement_price_settings_save(numeric, numeric) from public;
grant execute on function public.procurement_price_settings_save(numeric, numeric) to authenticated;
