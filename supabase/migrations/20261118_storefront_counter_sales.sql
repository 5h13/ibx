-- ============================================================================
-- Build 67 — DOC-15 Storefront / Counter Sales, part 1: the counter sale.
-- Requirements (user, 2026-09-27/28): see punchlist DOC-15.
--
--   * Per store (business): the stock location it sells from and a generic
--     "Walk-in" customer (created automatically).
--   * A sale: customer (existing, added at the counter, or Walk-in), catalog
--     lines at this store's price (editable), payments split across cash,
--     GCash, Maya, card and bank transfer, and a DR (system-numbered) and/or
--     an SI (number typed from the BIR booklet, unique per business).
--   * Price floor: a line priced below acquisition cost + 7% needs an
--     approver's sign-off (Sales approver or Business Admin) before the sale
--     can be completed.
--   * Completing a sale, in ONE transaction: stock issued from the store's
--     location, payments recorded, and for a charge / partly paid sale an AR
--     invoice for the balance (Finance sees it in AR), with the counter
--     payments recorded as posted receipts against it.
--   * Until opening stock exists (LOG-46), a sale may issue more than is on
--     hand (user decision); the screen warns.
--
-- Security: users never write these tables directly (no insert/update
-- policies); every change goes through the SECURITY DEFINER functions below,
-- which check the caller's role and business and recompute every price on
-- the server. Reads: storefront users (Sales, Business Admin) and Finance,
-- own business only (restrictive isolation policy).
-- ============================================================================

-- ------------------------------------------------------------------ access --
create or replace function public.can_use_storefront()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.is_active)
     and (public.is_super_admin() or public.is_business_admin()
          or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'sales')
          or public.has_section_access('sales'));
$$;

create or replace function public.can_approve_storefront()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                  where ua.user_id = auth.uid() and s.code = 'sales' and ua.workflow_role = 'approver');
$$;

create or replace function public.can_view_storefront()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_storefront()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'finance')
      or public.has_section_access('finance');
$$;
grant execute on function public.can_use_storefront(), public.can_approve_storefront(), public.can_view_storefront() to authenticated;

-- ------------------------------------------------------------------ tables --
create table if not exists public.storefront_settings (
  business_id uuid primary key references public.businesses(id),
  location_id uuid references public.logistics_locations(id),
  walk_in_customer_id uuid references public.finance_customers(id),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.storefront_sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  sale_number text not null unique,
  sale_date date not null default ((now() at time zone 'Asia/Manila')::date),  -- store day (Philippine time)
  status text not null default 'completed' check (status in ('pending_approval','approved','completed','cancelled')),
  customer_id uuid not null references public.finance_customers(id),
  location_id uuid not null references public.logistics_locations(id),
  issue_dr boolean not null default true,
  dr_number text unique,
  si_number text,
  subtotal numeric(14,2) not null default 0,       -- at this store's list prices
  discount_total numeric(14,2) not null default 0, -- list minus charged
  total numeric(14,2) not null default 0,          -- charged
  amount_paid numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,        -- charged to AR
  ar_invoice_id uuid references public.finance_customer_invoices(id),
  below_floor boolean not null default false,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  completed_by uuid references public.users(id),
  completed_at timestamptz,
  cancelled_by uuid references public.users(id),
  cancelled_at timestamptz,
  check (total >= 0 and amount_paid >= 0 and balance >= 0)
);
create unique index if not exists storefront_sales_si_unique on public.storefront_sales (business_id, lower(btrim(si_number)))
  where si_number is not null and status <> 'cancelled';
create index if not exists storefront_sales_business_date on public.storefront_sales (business_id, sale_date desc);

create table if not exists public.storefront_sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  sale_id uuid not null references public.storefront_sales(id) on delete cascade,
  item_id uuid not null references public.finance_procurement_items(id),
  inventory_item_id uuid references public.logistics_inventory_items(id),
  item_code text, description text not null, unit text,
  item_type text not null default 'product',
  quantity numeric(14,3) not null check (quantity > 0),
  list_price numeric(14,2) not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  acquisition_cost numeric(14,4),
  floor_price numeric(14,2),
  below_floor boolean not null default false,
  line_total numeric(14,2) not null,
  stock_movement_id uuid references public.logistics_stock_movements(id)
);
create index if not exists storefront_sale_items_sale on public.storefront_sale_items (sale_id);

create table if not exists public.storefront_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  payment_number text not null unique,
  sale_id uuid references public.storefront_sales(id),
  method text not null check (method in ('cash','gcash','maya','card','bank_transfer')),
  amount numeric(14,2) not null check (amount > 0),
  reference_number text,
  ar_receipt_id uuid references public.finance_customer_receipts(id),
  received_by uuid references public.users(id),
  received_at timestamptz not null default now()
);
create index if not exists storefront_payments_business_day on public.storefront_payments (business_id, received_at);

-- RLS: read only; writes only through the functions below
do $$
declare t text;
begin
  foreach t in array array['storefront_settings','storefront_sales','storefront_sale_items','storefront_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_business_isolation', t);
    execute format('create policy %I on public.%I as restrictive for all using (public.business_row_visible(business_id)) with check (public.business_row_visible(business_id))', t || '_business_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.can_view_storefront())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ----------------------------------------------------------------- numbers --
create or replace function public.storefront_next_number(p_prefix text, p_table text, p_column text)
returns text language plpgsql security definer set search_path = public as $$
declare n bigint; yr text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYY');
begin
  perform pg_advisory_xact_lock(hashtext(p_prefix || ':' || yr));
  execute format('select coalesce(max(substring(%I from %s)::bigint), 0) + 1 from public.%I where %I ~ %L',
                 p_column, length(p_prefix) + 7, p_table, p_column, '^' || p_prefix || '-' || yr || '-[0-9]{6,}$')
     into n;
  return p_prefix || '-' || yr || '-' || lpad(n::text, 6, '0');
end $$;
revoke all on function public.storefront_next_number(text, text, text) from public, authenticated;

-- ----------------------------------------------------------------- helpers --
-- The business the caller sells for: own business, or the Super Admin's
-- "Acting as" business. Raises when there is none or the caller may not sell.
create or replace function public.storefront_business()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not public.can_use_storefront() then raise exception 'Storefront access is for Sales staff and Business Admins.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" to use the Storefront.'; end if;
  return b;
end $$;

-- Walk-in customer for a business (created on first use)
create or replace function public.storefront_walk_in(p_business uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; code text;
begin
  select walk_in_customer_id into v from public.storefront_settings where business_id = p_business;
  if v is not null then return v; end if;
  select b.code into code from public.businesses b where b.id = p_business;
  select id into v from public.finance_customers where customer_code = 'WALKIN-' || code;
  if v is null then
    insert into public.finance_customers(business_id, customer_code, legal_name, payment_terms, active, notes)
    values (p_business, 'WALKIN-' || code, 'Walk-in customer', 'Cash', true, 'Generic customer for anonymous counter sales (Storefront).')
    returning id into v;
  end if;
  insert into public.storefront_settings(business_id, walk_in_customer_id) values (p_business, v)
  on conflict (business_id) do update set walk_in_customer_id = excluded.walk_in_customer_id;
  return v;
end $$;
revoke all on function public.storefront_walk_in(uuid) from public, authenticated;

-- Price of one catalog item for a business: list (store) price, acquisition
-- cost and the 7% floor. Same formula as get_catalog_sales_price().
create or replace function public.storefront_item_price(p_item uuid, p_business uuid)
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, acquisition_cost numeric, floor_price numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.item_code, i.item_name, i.unit, i.item_type,
         round(base * (1 + coalesce(cp.addon_percent,0)/100) * (1 + coalesce(ip.markup_percent,0)/100), 2),
         base * (1 + coalesce(cp.addon_percent,0)/100),
         round(base * (1 + coalesce(cp.addon_percent,0)/100) * 1.07, 2)
    from public.finance_procurement_items i
    cross join lateral (select case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end::numeric as base) b
    left join public.finance_catalog_categories cat on lower(trim(cat.name)) = lower(trim(i.category))
    left join public.finance_catalog_category_pricing cp on cp.category_id = cat.id and cp.active and cp.business_id = p_business
    left join public.finance_catalog_item_pricing ip on ip.item_id = i.id and ip.active and ip.business_id = p_business
   where i.id = p_item and i.active;
$$;
revoke all on function public.storefront_item_price(uuid, uuid) from public, authenticated;

-- ------------------------------------------------------ functions for the UI --
-- Store context: settings, walk-in customer, whether the caller may approve.
create or replace function public.storefront_context()
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  perform public.storefront_walk_in(b);
  select st.*, l.location_name, l.location_code into s
    from public.storefront_settings st left join public.logistics_locations l on l.id = st.location_id
   where st.business_id = b;
  return jsonb_build_object('business_id', b, 'location_id', s.location_id, 'location_name', s.location_name,
    'walk_in_customer_id', s.walk_in_customer_id, 'can_approve', public.can_approve_storefront(),
    'can_setup', public.is_super_admin() or public.is_business_admin());
end $$;

-- Business Admin / Super Admin: choose the store's selling location
create or replace function public.storefront_set_location(p_location uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can change Storefront settings.'; end if;
  if not exists (select 1 from public.logistics_locations where id = p_location and business_id = b and active) then
    raise exception 'Choose an active stock location of this business.';
  end if;
  perform public.storefront_walk_in(b);
  update public.storefront_settings set location_id = p_location, updated_by = auth.uid(), updated_at = now() where business_id = b;
end $$;

-- Lines for the sale screen: store price, floor and stock on hand at the store.
create or replace function public.storefront_price_lines(p_items uuid[])
returns table(item_id uuid, item_code text, item_name text, unit text, item_type text, list_price numeric, floor_price numeric, on_hand numeric)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business(); loc uuid;
begin
  select location_id into loc from public.storefront_settings where business_id = b;
  return query
  select p.item_id, p.item_code, p.item_name, p.unit, p.item_type, p.list_price, p.floor_price,
         case when p.item_type = 'service' then null else coalesce((
           select sum(bal.on_hand) from public.logistics_inventory_items inv
             join public.logistics_stock_balance bal on bal.inventory_item_id = inv.id and bal.location_id = loc
            where inv.business_id = b and inv.procurement_item_id = p.item_id), 0) end
    from unnest(p_items) x(id) cross join lateral public.storefront_item_price(x.id, b) p;
end $$;

-- Add a customer at the counter
create or replace function public.storefront_add_customer(p_name text, p_phone text default null, p_address text default null, p_tax_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); code text; n int; v uuid;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Customer name is required.'; end if;
  if exists (select 1 from public.finance_customers where business_id = b and lower(btrim(legal_name)) = lower(btrim(p_name)) and active) then
    raise exception 'A customer named "%" already exists; pick it from the list.', btrim(p_name);
  end if;
  select bz.code into code from public.businesses bz where bz.id = b;
  perform pg_advisory_xact_lock(hashtext('CUS:' || code));
  select coalesce(max(substring(customer_code from length(code) + 6)::int), 0) + 1 into n
    from public.finance_customers where customer_code ~ ('^CUS-' || code || '-[0-9]+$');
  insert into public.finance_customers(business_id, customer_code, legal_name, phone, address, tax_id, active, created_by)
  values (b, 'CUS-' || code || '-' || lpad(n::text, 5, '0'), btrim(p_name), nullif(btrim(p_phone),''), nullif(btrim(p_address),''), nullif(btrim(p_tax_id),''), true, auth.uid())
  returning id into v;
  return v;
end $$;

-- Post a sale (internal): stock issue, payments, AR invoice for the balance.
create or replace function public.storefront_post_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s record; l record; p record; v_paid numeric := 0; v_inv uuid; v_code text; v_walk uuid; v_mov uuid; v_inv_item uuid;
begin
  select * into s from public.storefront_sales where id = p_sale for update;
  select code into v_code from public.businesses where id = s.business_id;
  select walk_in_customer_id into v_walk from public.storefront_settings where business_id = s.business_id;

  -- documents
  p_si := nullif(btrim(coalesce(p_si, '')), '');
  if not coalesce(p_issue_dr, false) and p_si is null then raise exception 'Choose at least one document: DR and/or SI (enter the SI booklet number).'; end if;
  if p_si is not null and exists (select 1 from public.storefront_sales where business_id = s.business_id and id <> s.id
                                    and status <> 'cancelled' and lower(btrim(si_number)) = lower(p_si)) then
    raise exception 'SI number % is already used in this store.', p_si;
  end if;

  -- payments
  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text) loop
    if p.method not in ('cash','gcash','maya','card','bank_transfer') then raise exception 'Unknown payment method %.', p.method; end if;
    if coalesce(p.amount, 0) <= 0 then raise exception 'Each payment must be more than zero.'; end if;
    if p.method <> 'cash' and coalesce(btrim(p.reference), '') = '' then raise exception 'Enter the reference number for the % payment.', replace(p.method, '_', ' '); end if;
    v_paid := v_paid + round(p.amount, 2);
  end loop;
  if v_paid > s.total then raise exception 'Payments (₱%) are more than the sale total (₱%). Record only the amount applied; give change for cash.', v_paid, s.total; end if;
  if s.total - v_paid > 0 and s.customer_id = v_walk then
    raise exception 'A charge or partly paid sale needs a named customer, not Walk-in.';
  end if;

  update public.storefront_sales
     set status = 'completed', si_number = p_si, issue_dr = coalesce(p_issue_dr, false),
         dr_number = case when coalesce(p_issue_dr, false) then public.storefront_next_number('DR', 'storefront_sales', 'dr_number') end,
         amount_paid = v_paid, balance = s.total - v_paid, completed_by = auth.uid(), completed_at = now()
   where id = s.id;

  -- stock issue from the store's location
  for l in select * from public.storefront_sale_items where sale_id = s.id and item_type <> 'service' loop
    v_inv_item := public.ensure_inventory_link(l.item_id, s.business_id);
    insert into public.logistics_stock_movements(business_id, inventory_item_id, location_id, movement_date, movement_type, quantity, unit_cost, source_table, source_record_id, reference_number, notes, created_by)
    values (s.business_id, v_inv_item, s.location_id, s.sale_date, 'issue', l.quantity, round(coalesce(l.acquisition_cost, 0), 4), 'storefront_sales', s.id, s.sale_number, 'Storefront sale', auth.uid())
    returning id into v_mov;
    update public.storefront_sale_items set inventory_item_id = v_inv_item, stock_movement_id = v_mov where id = l.id;
  end loop;

  -- AR invoice for a charge / partly paid sale (total_amount, balance_due and
  -- line amounts are generated columns: subtotal - discount; minus amount_received)
  if s.total - v_paid > 0 then
    insert into public.finance_customer_invoices(business_id, invoice_number, customer_id, invoice_date, subtotal, discount_amount, amount_received, status, notes, prepared_by, prepared_at, approved_by, approved_at, created_by)
    values (s.business_id, v_code || '-' || coalesce('SI-' || p_si, s.sale_number), s.customer_id, s.sale_date, s.total, 0, v_paid, 'approved',
            'Storefront sale ' || s.sale_number || coalesce(', SI ' || p_si, ''), auth.uid(), now(), auth.uid(), now(), auth.uid())
    returning id into v_inv;
    insert into public.finance_customer_invoice_items(business_id, invoice_id, description, quantity, unit, unit_price)
    select s.business_id, v_inv, description, quantity, unit, unit_price from public.storefront_sale_items where sale_id = s.id;
    update public.storefront_sales set ar_invoice_id = v_inv where id = s.id;
  end if;

  -- payments (and, for an AR sale, posted receipts against its invoice)
  for p in select * from jsonb_to_recordset(coalesce(p_payments, '[]'::jsonb)) as x(method text, amount numeric, reference text) loop
    declare v_no text := public.storefront_next_number('SFP', 'storefront_payments', 'payment_number'); v_rec uuid;
    begin
      if v_inv is not null then
        insert into public.finance_customer_receipts(business_id, receipt_number, invoice_id, receipt_date, amount, payment_method, reference_number, notes, status, prepared_by, prepared_at, approved_by, approved_at, posted_by, posted_at, created_by)
        values (s.business_id, v_code || '-' || v_no, v_inv, s.sale_date, round(p.amount, 2), p.method, nullif(btrim(p.reference), ''), 'Paid at the counter, Storefront sale ' || s.sale_number,
                'posted', auth.uid(), now(), auth.uid(), now(), auth.uid(), now(), auth.uid())
        returning id into v_rec;
      end if;
      insert into public.storefront_payments(business_id, payment_number, sale_id, method, amount, reference_number, ar_receipt_id, received_by)
      values (s.business_id, v_no, s.id, p.method, round(p.amount, 2), nullif(btrim(p.reference), ''), v_rec, auth.uid());
    end;
  end loop;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_completed',
          jsonb_build_object('sale_number', s.sale_number, 'total', s.total, 'paid', v_paid, 'ar_invoice_id', v_inv, 'si_number', p_si));
end $$;
revoke all on function public.storefront_post_sale(uuid, jsonb, text, boolean) from public, authenticated;

-- Create a sale. p = {customer_id, lines:[{item_id, quantity, unit_price}], payments:[{method, amount, reference}],
--                    si_number, issue_dr, notes}
-- Completes it at once, or — when a line is below the 7% floor — saves it for an approver.
create or replace function public.storefront_submit_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); st record; v_sale uuid; v_no text; v_customer uuid;
        l record; pr record; v_sub numeric := 0; v_tot numeric := 0; v_below boolean := false; v_status text;
begin
  select * into st from public.storefront_settings where business_id = b;
  if st.location_id is null then raise exception 'The Storefront has no stock location yet: a Business Admin sets it in Storefront settings.'; end if;
  v_customer := coalesce(nullif(p->>'customer_id', '')::uuid, public.storefront_walk_in(b));
  if not exists (select 1 from public.finance_customers where id = v_customer and business_id = b and active) then
    raise exception 'Customer not found in this business.';
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;

  v_no := public.storefront_next_number('SF', 'storefront_sales', 'sale_number');
  insert into public.storefront_sales(business_id, sale_number, customer_id, location_id, status, notes, created_by)
  values (b, v_no, v_customer, st.location_id, 'pending_approval', nullif(btrim(p->>'notes'), ''), auth.uid())
  returning id into v_sale;

  for l in select * from jsonb_to_recordset(p->'lines') as x(item_id uuid, quantity numeric, unit_price numeric) loop
    select * into pr from public.storefront_item_price(l.item_id, b);
    if not found then raise exception 'An item on the sale is not an active catalog item.'; end if;
    if coalesce(l.quantity, 0) <= 0 then raise exception 'Quantity for % must be more than zero.', pr.item_name; end if;
    l.unit_price := round(coalesce(l.unit_price, pr.list_price), 2);
    if l.unit_price < 0 then raise exception 'Price for % cannot be negative.', pr.item_name; end if;
    insert into public.storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, acquisition_cost, floor_price, below_floor, line_total)
    values (b, v_sale, pr.item_id, pr.item_code, pr.item_name, pr.unit, pr.item_type, l.quantity, pr.list_price, l.unit_price, pr.acquisition_cost, pr.floor_price,
            l.unit_price < pr.floor_price, round(l.quantity * l.unit_price, 2));
    v_sub := v_sub + round(l.quantity * pr.list_price, 2);
    v_tot := v_tot + round(l.quantity * l.unit_price, 2);
    v_below := v_below or l.unit_price < pr.floor_price;
  end loop;

  update public.storefront_sales set subtotal = v_sub, total = v_tot, discount_total = greatest(v_sub - v_tot, 0), below_floor = v_below where id = v_sale;
  if v_below then
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'storefront_sales', v_sale, 'storefront_sale_price_approval_requested', jsonb_build_object('sale_number', v_no, 'total', v_tot));
    v_status := 'pending_approval';
  else
    perform public.storefront_post_sale(v_sale, p->'payments', p->>'si_number', coalesce((p->>'issue_dr')::boolean, true));
    v_status := 'completed';
  end if;
  return jsonb_build_object('id', v_sale, 'sale_number', v_no, 'status', v_status, 'total', v_tot);
end $$;

-- Approver signs off a below-floor price
create or replace function public.storefront_approve_sale(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  if not public.can_approve_storefront() then raise exception 'Only a Sales approver or Business Admin can approve a price below the floor.'; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status <> 'pending_approval' then raise exception 'This sale is not waiting for approval.'; end if;
  update public.storefront_sales set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_price_approved', jsonb_build_object('sale_number', s.sale_number, 'total', s.total));
end $$;

-- Complete an approved sale (payments and documents are taken now)
create or replace function public.storefront_complete_sale(p_sale uuid, p_payments jsonb, p_si text, p_issue_dr boolean)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status = 'pending_approval' then raise exception 'This sale is waiting for an approver to sign off the price.'; end if;
  if s.status <> 'approved' then raise exception 'This sale cannot be completed (status: %).', s.status; end if;
  perform public.storefront_post_sale(s.id, p_payments, p_si, p_issue_dr);
end $$;

-- Cancel a sale that was not completed
create or replace function public.storefront_cancel_sale(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); s record;
begin
  select * into s from public.storefront_sales where id = p_sale and business_id = b for update;
  if not found then raise exception 'Sale not found.'; end if;
  if s.status not in ('pending_approval','approved') then raise exception 'Only a sale that is not completed can be cancelled (completed sales are handled by returns).'; end if;
  update public.storefront_sales set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_sales', s.id, 'storefront_sale_cancelled', jsonb_build_object('sale_number', s.sale_number));
end $$;

grant execute on function public.storefront_context(), public.storefront_set_location(uuid), public.storefront_price_lines(uuid[]),
  public.storefront_add_customer(text, text, text, text), public.storefront_submit_sale(jsonb), public.storefront_approve_sale(uuid),
  public.storefront_complete_sale(uuid, jsonb, text, boolean), public.storefront_cancel_sale(uuid) to authenticated;
revoke all on function public.storefront_business() from public;
grant execute on function public.storefront_business() to authenticated;

-- Sales staff can read their business's customers (to pick one at the counter)
drop policy if exists finance_customers_storefront_read on public.finance_customers;
create policy finance_customers_storefront_read on public.finance_customers for select using (public.can_use_storefront());
