-- Build 91 — agent portal (AGT-01): agent logins, price tiers, agent orders to
-- the storefront, agent payment reports confirmed at the counter, client
-- statements, agent expenses and expense allowances.
--
-- Agents work only through the SECURITY DEFINER functions below; they get no
-- table rights of their own. Store staff see agent orders / payments through
-- storefront_* functions that check the store as usual.

-- ---------------------------------------------------------------- agent login
alter table public.sales_agents add column if not exists user_id uuid unique references public.users(id) on delete set null;

create or replace function public.current_agent_id()
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.sales_agents a join public.users u on u.id = a.user_id
   where a.user_id = auth.uid() and a.active and a.kind = 'freelance' and u.is_active and u.role::text = 'agent'
   limit 1;
$$;
revoke all on function public.current_agent_id() from public;
grant execute on function public.current_agent_id() to authenticated;

create or replace function public.agent_require()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.current_agent_id();
begin
  if v is null then raise exception 'This screen is for agents with a login linked to their agent record.'; end if;
  return v;
end $$;
revoke all on function public.agent_require() from public;

-- the stores an agent sells for (agents sell for every active store)
create or replace function public.agent_stores()
returns table(business_id uuid, code text, name text) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.agent_require();
  return query select b.id, b.code, coalesce(nullif(btrim(b.trade_name), ''), b.legal_name) from public.businesses b where b.is_active order by 3;
end $$;
revoke all on function public.agent_stores() from public;
grant execute on function public.agent_stores() to authenticated;

create or replace function public.agent_check_store(p_business uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_business is null or not exists (select 1 from public.businesses where id = p_business and is_active) then
    raise exception 'Choose the store first.';
  end if;
end $$;
revoke all on function public.agent_check_store(uuid) from public;

-- the agent's client in a store (raises when it is not his)
create or replace function public.agent_client(p_customer uuid, p_business uuid default null)
returns public.finance_customers language plpgsql stable security definer set search_path = public as $$
declare c public.finance_customers; v uuid := public.agent_require();
begin
  select * into c from public.finance_customers where id = p_customer and agent_id = v and (p_business is null or business_id = p_business);
  if not found then raise exception 'This client is not assigned to you.'; end if;
  return c;
end $$;
revoke all on function public.agent_client(uuid, uuid) from public;

-- link / unlink an agent login (admin tier; Business Admin only for users of his store)
create or replace function public.sales_agent_link_user(p_agent uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u record; a record;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin links agent logins.'; end if;
  select * into u from public.users where id = p_user;
  if not found then raise exception 'User not found.'; end if;
  if public.is_business_admin() and not public.is_super_admin() and u.business_id is distinct from public.current_business_id() then
    raise exception 'That user belongs to another store.';
  end if;
  update public.sales_agents set user_id = null, updated_at = now() where user_id = p_user and id is distinct from p_agent;
  if p_agent is null then return; end if;
  if u.role::text <> 'agent' then raise exception 'Give the user the Agent role first.'; end if;
  select * into a from public.sales_agents where id = p_agent;
  if not found or a.kind <> 'freelance' then raise exception 'Only a freelance agent can have a login.'; end if;
  if a.user_id is not null and a.user_id <> p_user then raise exception '% already has a login.', a.name; end if;
  update public.sales_agents set user_id = p_user, updated_at = now() where id = p_agent;
end $$;
revoke all on function public.sales_agent_link_user(uuid, uuid) from public;
grant execute on function public.sales_agent_link_user(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- price tiers
-- Tier 1 = store price. Tiers 2-4 give away a share of the markup
-- (store price − acquisition cost), never going below the floor price.
create table if not exists public.sales_price_tiers (
  business_id uuid not null references public.businesses(id) on delete cascade,
  tier smallint not null check (tier between 2 and 4),
  markup_give_percent numeric(14,8) not null check (markup_give_percent between 0 and 100),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (business_id, tier)
);
alter table public.sales_price_tiers enable row level security;
drop policy if exists sales_price_tiers_read on public.sales_price_tiers;
create policy sales_price_tiers_read on public.sales_price_tiers for select using (public.is_super_admin() or business_id = public.current_business_id());
grant select on public.sales_price_tiers to authenticated;

create or replace function public.price_tier_give(p_business uuid, p_tier int)
returns numeric language sql stable security definer set search_path = public as $$
  select case when p_tier <= 1 then 0::numeric else coalesce(
    (select markup_give_percent from public.sales_price_tiers where business_id = p_business and tier = p_tier),
    case p_tier when 2 then 15.38461538 when 3 then 30.76923077 else 46.15384615 end) end;
$$;
revoke all on function public.price_tier_give(uuid, int) from public;
grant execute on function public.price_tier_give(uuid, int) to authenticated;

create or replace function public.tier_price(p_business uuid, p_tier int, p_list numeric, p_acq numeric, p_floor numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select case when p_list is null then null
              else greatest(coalesce(p_floor, 0),
                            round(p_list - greatest(p_list - coalesce(p_acq, p_list), 0) * public.price_tier_give(p_business, p_tier) / 100, 2)) end;
$$;
revoke all on function public.tier_price(uuid, int, numeric, numeric, numeric) from public;
grant execute on function public.tier_price(uuid, int, numeric, numeric, numeric) to authenticated;

create or replace function public.sales_price_tiers_save(p_business uuid, p_t2 numeric, p_t3 numeric, p_t4 numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_super_admin() or (public.is_business_admin() and p_business = public.current_business_id())) then
    raise exception 'Only the store''s Business Admin sets the price tiers.';
  end if;
  if p_t2 is null or p_t3 is null or p_t4 is null or p_t2 < 0 or p_t4 > 100 or p_t2 > p_t3 or p_t3 > p_t4 then
    raise exception 'Tier shares must go up from Tier 2 to Tier 4, between 0%% and 100%% of the markup.';
  end if;
  insert into public.sales_price_tiers(business_id, tier, markup_give_percent, updated_by) values
    (p_business, 2, p_t2, auth.uid()), (p_business, 3, p_t3, auth.uid()), (p_business, 4, p_t4, auth.uid())
  on conflict (business_id, tier) do update set markup_give_percent = excluded.markup_give_percent, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.sales_price_tiers_save(uuid, numeric, numeric, numeric) from public;
grant execute on function public.sales_price_tiers_save(uuid, numeric, numeric, numeric) to authenticated;

-- the client's usual tier
alter table public.finance_customers add column if not exists price_tier smallint not null default 1 check (price_tier between 1 and 4);

-- ---------------------------------------------------------------- internal copies with an explicit store
-- catalog_product_search / customer_statement read the caller's own store; the
-- agent picks a store, so these copies take it as a parameter. Not callable
-- from the API (only from the agent functions below).
do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'catalog_product_search';
  n := replace(d, 'FUNCTION public.catalog_product_search(', 'FUNCTION public.catalog_product_search_for(p_business uuid, ');
  n := replace(n, 'v_business uuid := public.pricing_business_id();', 'v_business uuid := p_business;');
  n := regexp_replace(n, 'if auth\.uid\(\) is null or not public\.can_search_catalog\(\) then\s*raise exception ''Catalog access required\.'';\s*end if;', '');
  if n = d or position('p_business uuid' in n) = 0 or position('v_business uuid := p_business' in n) = 0 or position('can_search_catalog' in n) > 0 then
    raise exception 'Build 91: could not derive catalog_product_search_for';
  end if;
  execute n;

  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'customer_statement';
  n := replace(d, 'FUNCTION public.customer_statement(', 'FUNCTION public.customer_statement_for(p_business uuid, ');
  n := replace(n, 'b uuid := public.pricing_business_id();', 'b uuid := p_business;');
  n := regexp_replace(n, 'if not public\.can_view_storefront\(\) then raise exception ''[^'']*''; end if;', '');
  if n = d or position('b uuid := p_business' in n) = 0 or position('can_view_storefront' in n) > 0 then
    raise exception 'Build 91: could not derive customer_statement_for';
  end if;
  execute n;
end $$;
revoke all on function public.catalog_product_search_for(uuid, text, text, text, text, boolean, integer, integer) from public;
revoke all on function public.customer_statement_for(uuid, uuid, date, date) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.catalog_product_search_for(uuid, text, text, text, text, boolean, integer, integer) from authenticated';
    execute 'revoke all on function public.customer_statement_for(uuid, uuid, date, date) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.catalog_product_search_for(uuid, text, text, text, text, boolean, integer, integer) from anon';
    execute 'revoke all on function public.customer_statement_for(uuid, uuid, date, date) from anon';
  end if;
end $$;

-- the client price: the client's tier, or the client's own item discount when lower; never under the floor
create or replace function public.agent_client_price(p_business uuid, p_customer uuid, p_item uuid, p_tier int, p_list numeric, p_acq numeric, p_floor numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select case when p_list is null then null else greatest(coalesce(p_floor, 0), least(
    public.tier_price(p_business, coalesce(p_tier, 1), p_list, p_acq, p_floor),
    coalesce((select round(p_list * (1 - d.discount_percent / 100), 2) from public.finance_catalog_customer_discounts d
               where d.business_id = p_business and d.customer_id = p_customer and d.item_id = p_item and d.active and d.effective_from <= current_date
               order by d.effective_from desc limit 1), p_list))) end;
$$;
revoke all on function public.agent_client_price(uuid, uuid, uuid, int, numeric, numeric, numeric) from public;

-- ---------------------------------------------------------------- catalogue
create or replace function public.agent_catalog(p_business uuid, p_customer uuid default null, p_q text default null, p_category text default null,
                                                p_in_stock boolean default false, p_limit int default 40, p_offset int default 0)
returns table(item_id uuid, item_code text, item_name text, category text, brand text, description text, unit text, item_type text, photo_path text,
              on_hand numeric, available numeric, stock_type text, acquisition_cost numeric, markup_percent numeric, list_price numeric, floor_price numeric,
              tier2 numeric, tier3 numeric, tier4 numeric, client_tier int, client_discount numeric, client_price numeric, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_agent uuid := public.agent_require(); v_tier int := 1;
begin
  perform public.agent_check_store(p_business);
  if p_customer is not null then v_tier := (public.agent_client(p_customer, p_business)).price_tier; end if;
  return query
  select s.item_id, s.item_code, s.item_name, s.category, s.brand, s.description, s.unit, s.item_type, s.photo_path,
         s.on_hand, s.available, s.stock_type, pr.acquisition_cost,
         case when pr.acquisition_cost > 0 then round((pr.list_price / pr.acquisition_cost - 1) * 100, 4) end,
         pr.list_price, pr.floor_price,
         public.tier_price(p_business, 2, pr.list_price, pr.acquisition_cost, pr.floor_price),
         public.tier_price(p_business, 3, pr.list_price, pr.acquisition_cost, pr.floor_price),
         public.tier_price(p_business, 4, pr.list_price, pr.acquisition_cost, pr.floor_price),
         v_tier,
         (select d.discount_percent from public.finance_catalog_customer_discounts d where p_customer is not null and d.business_id = p_business and d.customer_id = p_customer
             and d.item_id = s.item_id and d.active and d.effective_from <= current_date order by d.effective_from desc limit 1),
         case when p_customer is null then null else public.agent_client_price(p_business, p_customer, s.item_id, v_tier, pr.list_price, pr.acquisition_cost, pr.floor_price) end,
         s.total_count
    from public.catalog_product_search_for(p_business, p_q, p_category, null, null, coalesce(p_in_stock, false), least(greatest(coalesce(p_limit, 40), 1), 100), greatest(coalesce(p_offset, 0), 0)) s
    left join lateral public.storefront_item_price(s.item_id, p_business) pr on true;
end $$;
revoke all on function public.agent_catalog(uuid, uuid, text, text, boolean, int, int) from public;
grant execute on function public.agent_catalog(uuid, uuid, text, text, boolean, int, int) to authenticated;

create or replace function public.agent_catalog_categories()
returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  perform public.agent_require();
  return query select distinct btrim(category) from public.finance_procurement_items where active and coalesce(btrim(category), '') <> '' order by 1;
end $$;
revoke all on function public.agent_catalog_categories() from public;
grant execute on function public.agent_catalog_categories() to authenticated;

-- ---------------------------------------------------------------- clients
create or replace function public.agent_clients(p_business uuid default null)
returns table(customer_id uuid, business_id uuid, store text, customer_code text, legal_name text, phone text, address text, price_tier int,
              open_balance numeric, overdue numeric, last_sale date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v uuid := public.agent_require();
begin
  return query
  select c.id, c.business_id, coalesce(nullif(btrim(b.trade_name), ''), b.code), c.customer_code, c.legal_name, c.phone, c.address, c.price_tier::int,
         coalesce((select sum(i.balance_due) from public.finance_customer_invoices i where i.customer_id = c.id and i.status in ('approved','partially_paid')), 0),
         coalesce((select sum(i.balance_due) from public.finance_customer_invoices i where i.customer_id = c.id and i.status in ('approved','partially_paid')
                    and coalesce(i.due_date, i.invoice_date) < (now() at time zone 'Asia/Manila')::date), 0),
         (select max(s.sale_date) from public.storefront_sales s where s.customer_id = c.id and s.status = 'completed')
    from public.finance_customers c join public.businesses b on b.id = c.business_id
   where c.agent_id = v and c.active and (p_business is null or c.business_id = p_business)
   order by c.legal_name;
end $$;
revoke all on function public.agent_clients(uuid) from public;
grant execute on function public.agent_clients(uuid) to authenticated;

create or replace function public.agent_add_client(p_business uuid, p_name text, p_phone text default null, p_address text default null, p_tax_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); code text; n int; c uuid;
begin
  perform public.agent_check_store(p_business);
  if coalesce(btrim(p_name), '') = '' then raise exception 'Client name is required.'; end if;
  if exists (select 1 from public.finance_customers where business_id = p_business and lower(btrim(legal_name)) = lower(btrim(p_name)) and active) then
    raise exception 'A customer named "%" already exists in this store. Ask the store to assign it to you.', btrim(p_name);
  end if;
  select bz.code into code from public.businesses bz where bz.id = p_business;
  perform pg_advisory_xact_lock(hashtext('CUS:' || code));
  select coalesce(max(substring(customer_code from length(code) + 6)::int), 0) + 1 into n
    from public.finance_customers where customer_code ~ ('^CUS-' || code || '-[0-9]+$');
  insert into public.finance_customers(business_id, customer_code, legal_name, phone, address, tax_id, active, created_by, agent_id)
  values (p_business, 'CUS-' || code || '-' || lpad(n::text, 5, '0'), btrim(p_name), nullif(btrim(p_phone),''), nullif(btrim(p_address),''), nullif(btrim(p_tax_id),''), true, auth.uid(), v)
  returning id into c;
  return c;
end $$;
revoke all on function public.agent_add_client(uuid, text, text, text, text) from public;
grant execute on function public.agent_add_client(uuid, text, text, text, text) to authenticated;

create or replace function public.agent_set_client_tier(p_customer uuid, p_tier int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.agent_client(p_customer);
  if p_tier not between 1 and 4 then raise exception 'The tier is 1 to 4.'; end if;
  update public.finance_customers set price_tier = p_tier, updated_at = now() where id = p_customer;
end $$;
revoke all on function public.agent_set_client_tier(uuid, int) from public;
grant execute on function public.agent_set_client_tier(uuid, int) to authenticated;

create or replace function public.agent_customer_statement(p_customer uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.finance_customers := public.agent_client(p_customer);
begin
  return public.customer_statement_for(c.business_id, p_customer, p_from, p_to);
end $$;
revoke all on function public.agent_customer_statement(uuid, date, date) from public;
grant execute on function public.agent_customer_statement(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------- document numbers
create or replace function public.agent_doc_number(p_prefix text, p_business uuid, p_table regclass, p_column text)
returns text language plpgsql security definer set search_path = public as $$
declare code text; yr text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYY'); base text; n int;
begin
  select bz.code into code from public.businesses bz where bz.id = p_business;
  base := p_prefix || '-' || code || '-' || yr || '-';
  perform pg_advisory_xact_lock(hashtext(base));
  execute format('select coalesce(max(substring(%I from %s)::int), 0) + 1 from %s where %I like %L', p_column, length(base) + 1, p_table, p_column, base || '%') into n;
  return base || lpad(n::text, 6, '0');
end $$;
revoke all on function public.agent_doc_number(text, uuid, regclass, text) from public;

-- ---------------------------------------------------------------- agent orders
create table if not exists public.agent_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  order_number text not null unique,
  agent_id uuid not null references public.sales_agents(id),
  customer_id uuid not null references public.finance_customers(id),
  status text not null default 'draft' check (status in ('draft','sent','completed','cancelled')),
  notes text,
  store_note text,
  total numeric(14,2) not null default 0,
  sale_id uuid references public.storefront_sales(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.users(id)
);
create table if not exists public.agent_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agent_orders(id) on delete cascade,
  line_no int not null,
  item_id uuid not null references public.finance_procurement_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  tier smallint check (tier between 1 and 4),
  unit_price numeric(14,2) not null,
  list_price numeric(14,2),
  floor_price numeric(14,2),
  line_total numeric(14,2) not null
);
create index if not exists agent_orders_business_status on public.agent_orders(business_id, status);
create index if not exists agent_orders_agent on public.agent_orders(agent_id, created_at desc);
alter table public.agent_orders enable row level security;
alter table public.agent_order_lines enable row level security;

create or replace function public.agent_order_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); b uuid := (p->>'business_id')::uuid; c public.finance_customers; o record; v_id uuid := nullif(p->>'id', '')::uuid;
        l jsonb; n int := 0; pr record; v_tier int; v_price numeric; v_bottom numeric; v_client numeric; v_total numeric := 0; v_qty numeric;
begin
  perform public.agent_check_store(b);
  c := public.agent_client((p->>'customer_id')::uuid, b);
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  if v_id is not null then
    select * into o from public.agent_orders where id = v_id and agent_id = v for update;
    if not found then raise exception 'Order not found.'; end if;
    if o.status <> 'draft' then raise exception 'Order % was already sent; ask the store to return it to you to change it.', o.order_number; end if;
    delete from public.agent_order_lines where order_id = v_id;
    update public.agent_orders set business_id = b, customer_id = c.id, notes = nullif(btrim(p->>'notes'), ''), updated_at = now() where id = v_id;
  else
    insert into public.agent_orders(business_id, order_number, agent_id, customer_id, notes, created_by)
    values (b, public.agent_doc_number('AO', b, 'public.agent_orders', 'order_number'), v, c.id, nullif(btrim(p->>'notes'), ''), auth.uid())
    returning id into v_id;
  end if;
  for l in select * from jsonb_array_elements(p->'lines') loop
    n := n + 1;
    v_qty := round(coalesce((l->>'quantity')::numeric, 0), 3);
    if v_qty <= 0 then raise exception 'Line %: enter a quantity.', n; end if;
    select * into pr from public.storefront_item_price((l->>'item_id')::uuid, b);
    if pr.item_id is null or pr.list_price is null then raise exception 'Line %: this item has no store price in this store.', n; end if;
    v_tier := nullif(l->>'tier', '')::int;
    if v_tier is not null and v_tier not between 1 and 4 then raise exception 'Line %: the tier is 1 to 4.', n; end if;
    v_client := public.agent_client_price(b, c.id, pr.item_id, c.price_tier, pr.list_price, pr.acquisition_cost, pr.floor_price);
    v_bottom := least(public.tier_price(b, 4, pr.list_price, pr.acquisition_cost, pr.floor_price), v_client);
    if nullif(l->>'unit_price', '') is not null then
      v_price := round((l->>'unit_price')::numeric, 2);
      if v_price < v_bottom then raise exception '%: the lowest price you can give is ₱% (Tier 4).', pr.item_name, v_bottom; end if;
      if v_price > pr.list_price then raise exception '%: the price cannot be above the store price ₱%.', pr.item_name, pr.list_price; end if;
    elsif v_tier is not null then
      v_price := public.tier_price(b, v_tier, pr.list_price, pr.acquisition_cost, pr.floor_price);
    else
      v_price := v_client;
    end if;
    insert into public.agent_order_lines(order_id, line_no, item_id, quantity, tier, unit_price, list_price, floor_price, line_total)
    values (v_id, n, pr.item_id, v_qty, v_tier, v_price, pr.list_price, pr.floor_price, round(v_qty * v_price, 2));
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;
  update public.agent_orders set total = v_total where id = v_id;
  if coalesce((p->>'send')::boolean, false) then
    update public.agent_orders set status = 'sent', sent_at = now(), store_note = null where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.agent_order_save(jsonb) from public;
grant execute on function public.agent_order_save(jsonb) to authenticated;

create or replace function public.agent_order_set_status(p_order uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); o record;
begin
  select * into o from public.agent_orders where id = p_order and agent_id = v for update;
  if not found then raise exception 'Order not found.'; end if;
  if p_status = 'sent' and o.status = 'draft' then
    update public.agent_orders set status = 'sent', sent_at = now(), store_note = null, updated_at = now() where id = p_order;
  elsif p_status = 'cancelled' and o.status in ('draft','sent') then
    update public.agent_orders set status = 'cancelled', updated_at = now() where id = p_order;
  else
    raise exception 'Order % is %; it cannot be %.', o.order_number, o.status, p_status;
  end if;
end $$;
revoke all on function public.agent_order_set_status(uuid, text) from public;
grant execute on function public.agent_order_set_status(uuid, text) to authenticated;

create or replace function public.agent_order_json(p_order uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'business_id', o.business_id, 'status', o.status, 'notes', o.notes, 'store_note', o.store_note,
           'total', o.total, 'created_at', o.created_at, 'sent_at', o.sent_at, 'completed_at', o.completed_at,
           'customer_id', o.customer_id, 'customer', c.legal_name, 'customer_code', c.customer_code, 'agent', a.name, 'agent_code', a.agent_code,
           'sale_number', s.sale_number,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'item_code', i.item_code, 'item_name', i.item_name, 'unit', i.unit,
                       'quantity', l.quantity, 'tier', l.tier, 'unit_price', l.unit_price, 'list_price', l.list_price, 'line_total', l.line_total) order by l.line_no)
                     from public.agent_order_lines l join public.finance_procurement_items i on i.id = l.item_id where l.order_id = o.id), '[]'::jsonb))
    from public.agent_orders o join public.finance_customers c on c.id = o.customer_id join public.sales_agents a on a.id = o.agent_id
    left join public.storefront_sales s on s.id = o.sale_id
   where o.id = p_order;
$$;
revoke all on function public.agent_order_json(uuid) from public;

create or replace function public.agent_orders_list(p_business uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  return coalesce((select jsonb_agg(public.agent_order_json(o.id) order by o.created_at desc)
                     from (select id, created_at from public.agent_orders where agent_id = v and (p_business is null or business_id = p_business)
                           order by created_at desc limit 200) o), '[]'::jsonb);
end $$;
revoke all on function public.agent_orders_list(uuid) from public;
grant execute on function public.agent_orders_list(uuid) to authenticated;

-- store side
create or replace function public.storefront_agent_orders()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return coalesce((select jsonb_agg(public.agent_order_json(o.id) order by o.sort_at desc)
                     from (select id, coalesce(sent_at, created_at) as sort_at from public.agent_orders
                            where business_id = b and (status = 'sent' or (status = 'completed' and completed_at > now() - interval '7 days'))
                            order by 2 desc limit 200) o), '[]'::jsonb);
end $$;
revoke all on function public.storefront_agent_orders() from public;
grant execute on function public.storefront_agent_orders() to authenticated;

create or replace function public.storefront_agent_order_done(p_order uuid, p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); o record; s record;
begin
  select * into o from public.agent_orders where id = p_order and business_id = b for update;
  if not found then raise exception 'Agent order not found in this store.'; end if;
  if o.status <> 'sent' then raise exception 'Agent order % is %.', o.order_number, o.status; end if;
  select * into s from public.storefront_sales where id = p_sale and business_id = b;
  if not found then raise exception 'Sale not found in this store.'; end if;
  if s.customer_id is distinct from o.customer_id then raise exception 'The sale is for another customer than agent order %.', o.order_number; end if;
  update public.agent_orders set status = 'completed', sale_id = p_sale, completed_at = now(), completed_by = auth.uid(), updated_at = now() where id = p_order;
end $$;
revoke all on function public.storefront_agent_order_done(uuid, uuid) from public;
grant execute on function public.storefront_agent_order_done(uuid, uuid) to authenticated;

create or replace function public.storefront_agent_order_return(p_order uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); o record;
begin
  if coalesce(btrim(p_note), '') = '' then raise exception 'Tell the agent why the order is returned.'; end if;
  select * into o from public.agent_orders where id = p_order and business_id = b for update;
  if not found then raise exception 'Agent order not found in this store.'; end if;
  if o.status <> 'sent' then raise exception 'Agent order % is %.', o.order_number, o.status; end if;
  update public.agent_orders set status = 'draft', store_note = btrim(p_note), updated_at = now() where id = p_order;
end $$;
revoke all on function public.storefront_agent_order_return(uuid, text) from public;
grant execute on function public.storefront_agent_order_return(uuid, text) to authenticated;

-- ---------------------------------------------------------------- agent payment reports
create table if not exists public.agent_payment_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  report_number text not null unique,
  agent_id uuid not null references public.sales_agents(id),
  customer_id uuid not null references public.finance_customers(id),
  method text not null check (method in ('cash','gcash','maya','card','bank_transfer','check')),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  paid_on date not null,
  details jsonb not null default '{}'::jsonb,
  allocations jsonb not null,
  photo_path text,
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  payment_ids uuid[],
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists agent_payment_reports_business_status on public.agent_payment_reports(business_id, status);
alter table public.agent_payment_reports enable row level security;

-- amount already reported (not yet confirmed) per invoice
create or replace function public.agent_pending_reported(p_invoice uuid, p_except uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum((a->>'amount')::numeric), 0) from public.agent_payment_reports r, jsonb_array_elements(r.allocations) a
   where r.status = 'pending' and (a->>'invoice_id')::uuid = p_invoice and r.id is distinct from p_except;
$$;
revoke all on function public.agent_pending_reported(uuid, uuid) from public;

create or replace function public.agent_open_invoices(p_customer uuid)
returns table(invoice_id uuid, invoice_number text, invoice_date date, due_date date, total_amount numeric, amount_received numeric, balance_due numeric,
              dr_numbers text, si_number text, reported numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c public.finance_customers := public.agent_client(p_customer);
begin
  return query
  select i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.amount_received, i.balance_due, r.dr_numbers, r.si_number,
         public.agent_pending_reported(i.id)
    from public.finance_customer_invoices i
    left join lateral public.ar_invoice_refs(array[i.id]) r on true
   where i.customer_id = c.id and i.business_id = c.business_id and i.status in ('approved','partially_paid') and i.balance_due > 0
   order by i.invoice_date, i.invoice_number;
end $$;
revoke all on function public.agent_open_invoices(uuid) from public;
grant execute on function public.agent_open_invoices(uuid) to authenticated;

create or replace function public.agent_payment_report(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); c public.finance_customers; a jsonb; inv record; v_total numeric := 0; v_amt numeric; v_id uuid; v_allocs jsonb := '[]'::jsonb;
        v_method text := p->>'method'; v_ref text := nullif(btrim(p->>'reference'), '');
begin
  c := public.agent_client((p->>'customer_id')::uuid);
  if v_method not in ('cash','gcash','maya','card','bank_transfer','check') then raise exception 'Choose how the client paid.'; end if;
  if v_method <> 'cash' and v_ref is null then raise exception 'Enter the reference / check number.'; end if;
  if nullif(p->>'paid_on', '') is null then raise exception 'Enter the date the client paid.'; end if;
  if (p->>'paid_on')::date > (now() at time zone 'Asia/Manila')::date + 1 then raise exception 'The payment date is in the future.'; end if;
  for a in select * from jsonb_array_elements(coalesce(p->'allocations', '[]'::jsonb)) loop
    v_amt := round(coalesce((a->>'amount')::numeric, 0), 2);
    if v_amt = 0 then continue; end if;
    if v_amt < 0 then raise exception 'Amounts cannot be negative.'; end if;
    select * into inv from public.finance_customer_invoices where id = (a->>'invoice_id')::uuid and customer_id = c.id and status in ('approved','partially_paid');
    if not found then raise exception 'An invoice is not open for this client.'; end if;
    if v_amt > inv.balance_due - public.agent_pending_reported(inv.id) then
      raise exception 'Invoice %: ₱% is more than what is left to pay (₱% after other reported payments).', inv.invoice_number, v_amt, inv.balance_due - public.agent_pending_reported(inv.id);
    end if;
    v_allocs := v_allocs || jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'amount', v_amt);
    v_total := v_total + v_amt;
  end loop;
  if v_total <= 0 then raise exception 'Enter the amount paid on at least one DR / invoice.'; end if;
  insert into public.agent_payment_reports(business_id, report_number, agent_id, customer_id, method, amount, reference, paid_on, details, allocations, photo_path, notes, created_by)
  values (c.business_id, public.agent_doc_number('APR', c.business_id, 'public.agent_payment_reports', 'report_number'), v, c.id, v_method, v_total, v_ref,
          (p->>'paid_on')::date, jsonb_strip_nulls(jsonb_build_object('check_bank', nullif(p->>'check_bank', ''), 'check_date', nullif(p->>'check_date', ''), 'issuer', nullif(p->>'issuer', ''))),
          v_allocs, nullif(p->>'photo_path', ''), nullif(btrim(p->>'notes'), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.agent_payment_report(jsonb) from public;
grant execute on function public.agent_payment_report(jsonb) to authenticated;

create or replace function public.agent_payment_cancel(p_report uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  update public.agent_payment_reports set status = 'cancelled', decided_at = now() where id = p_report and agent_id = v and status = 'pending';
  if not found then raise exception 'Only a payment still waiting for the cashier can be cancelled.'; end if;
end $$;
revoke all on function public.agent_payment_cancel(uuid) from public;
grant execute on function public.agent_payment_cancel(uuid) to authenticated;

create or replace function public.agent_payment_json(p_report uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(r) - 'payment_ids' || jsonb_build_object('customer', c.legal_name, 'customer_code', c.customer_code, 'agent', a.name, 'agent_code', a.agent_code,
           'allocations', coalesce((select jsonb_agg(x || jsonb_build_object('dr_numbers', f.dr_numbers, 'si_number', f.si_number))
                                     from jsonb_array_elements(r.allocations) x left join lateral public.ar_invoice_refs(array[(x->>'invoice_id')::uuid]) f on true), '[]'::jsonb))
    from public.agent_payment_reports r join public.finance_customers c on c.id = r.customer_id join public.sales_agents a on a.id = r.agent_id
   where r.id = p_report;
$$;
revoke all on function public.agent_payment_json(uuid) from public;

create or replace function public.agent_payments_list(p_business uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  return coalesce((select jsonb_agg(public.agent_payment_json(r.id) order by r.created_at desc)
                     from (select id, created_at from public.agent_payment_reports where agent_id = v and (p_business is null or business_id = p_business)
                           order by created_at desc limit 200) r), '[]'::jsonb);
end $$;
revoke all on function public.agent_payments_list(uuid) from public;
grant execute on function public.agent_payments_list(uuid) to authenticated;

create or replace function public.storefront_agent_payments()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  return coalesce((select jsonb_agg(public.agent_payment_json(r.id) order by r.created_at desc)
                     from (select id, created_at from public.agent_payment_reports
                            where business_id = b and (status = 'pending' or decided_at > now() - interval '7 days')
                            order by created_at desc limit 200) r), '[]'::jsonb);
end $$;
revoke all on function public.storefront_agent_payments() from public;
grant execute on function public.storefront_agent_payments() to authenticated;

-- the cashier confirms the money was received: posts like a counter AR payment (one per DR / invoice, same reference)
create or replace function public.storefront_confirm_agent_payment(p_report uuid, p_payment jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business(); r record; a jsonb; res jsonb; v_parts uuid[] := '{}'; v_pay jsonb; v_method text;
begin
  select * into r from public.agent_payment_reports where id = p_report and business_id = b for update;
  if not found then raise exception 'Agent payment not found in this store.'; end if;
  if r.status <> 'pending' then raise exception 'Payment % is already %.', r.report_number, r.status; end if;
  v_method := coalesce(nullif(p_payment->>'method', ''), r.method);
  v_pay := (coalesce(p_payment, '{}'::jsonb) - 'amount' - 'tendered') || jsonb_build_object('method', v_method);
  if v_method <> 'cash' and coalesce(btrim(v_pay->>'reference'), '') = '' then raise exception 'Enter the reference / check number.'; end if;
  for a in select * from jsonb_array_elements(r.allocations) loop
    res := public.storefront_collect_ar((a->>'invoice_id')::uuid, jsonb_build_array(v_pay || jsonb_build_object('amount', (a->>'amount')::numeric)));
    v_parts := v_parts || (res->>'payment_id')::uuid;
    -- the next parts share the same reference (one payment split over several DRs)
    perform set_config('ibx.ar_split_ref', lower(regexp_replace(coalesce(v_pay->>'reference', ''), '[^A-Za-z0-9]', '', 'g')), true);
  end loop;
  perform set_config('ibx.ar_split_ref', '', true);
  if v_method = 'check' and array_length(v_parts, 1) > 1 then
    update public.storefront_checks set amount = r.amount where payment_id = v_parts[1];
    delete from public.storefront_checks where payment_id = any(v_parts[2:]);
  end if;
  update public.agent_payment_reports set status = 'confirmed', decided_by = auth.uid(), decided_at = now(), payment_ids = v_parts where id = p_report;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'agent_payment_reports', p_report, 'agent_payment_confirmed', jsonb_build_object('report', r.report_number, 'amount', r.amount));
  return jsonb_build_object('report_number', r.report_number, 'amount', r.amount, 'parts', array_length(v_parts, 1));
end $$;
revoke all on function public.storefront_confirm_agent_payment(uuid, jsonb) from public;
grant execute on function public.storefront_confirm_agent_payment(uuid, jsonb) to authenticated;

create or replace function public.storefront_reject_agent_payment(p_report uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.storefront_business();
begin
  if coalesce(btrim(p_note), '') = '' then raise exception 'Tell the agent why the payment is not confirmed.'; end if;
  update public.agent_payment_reports set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note)
   where id = p_report and business_id = b and status = 'pending';
  if not found then raise exception 'Only a pending agent payment can be rejected.'; end if;
end $$;
revoke all on function public.storefront_reject_agent_payment(uuid, text) from public;
grant execute on function public.storefront_reject_agent_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------- expenses and allowances
insert into public.admin_expense_categories(code, name, description)
select 'meals', 'Meals', 'Meals while working (agents may file these without a receipt photo)'
where not exists (select 1 from public.admin_expense_categories where code = 'meals');

create table if not exists public.expense_allowances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent_id uuid references public.sales_agents(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  category_id uuid not null references public.admin_expense_categories(id),
  monthly_limit numeric(14,2) not null check (monthly_limit >= 0),
  active boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((agent_id is null) <> (user_id is null))
);
create unique index if not exists expense_allowances_one on public.expense_allowances(business_id, coalesce(agent_id, user_id), category_id);
alter table public.expense_allowances enable row level security;
drop policy if exists expense_allowances_read on public.expense_allowances;
create policy expense_allowances_read on public.expense_allowances for select using (public.is_super_admin() or business_id = public.current_business_id());
drop policy if exists expense_allowances_manage on public.expense_allowances;
create policy expense_allowances_manage on public.expense_allowances for all
  using (public.is_super_admin() or (public.is_business_admin() and business_id = public.current_business_id()))
  with check (public.is_super_admin() or (public.is_business_admin() and business_id = public.current_business_id()));
grant select, insert, update, delete on public.expense_allowances to authenticated;

create table if not exists public.agent_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  expense_number text not null unique,
  agent_id uuid not null references public.sales_agents(id),
  expense_date date not null,
  category_id uuid not null references public.admin_expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  description text not null,
  photo_path text,
  no_receipt boolean not null default false,
  allowance_limit numeric(14,2),
  over_allowance numeric(14,2) not null default 0,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancelled')),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  expense_id uuid references public.expenses(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists agent_expenses_business_status on public.agent_expenses(business_id, status);
alter table public.agent_expenses enable row level security;

create or replace function public.agent_expense_submit(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); b uuid := (p->>'business_id')::uuid; cat record; v_amt numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
        v_date date := nullif(p->>'expense_date', '')::date; v_photo text := nullif(p->>'photo_path', ''); v_limit numeric; v_used numeric; v_id uuid;
begin
  perform public.agent_check_store(b);
  select * into cat from public.admin_expense_categories where id = (p->>'category_id')::uuid and active;
  if not found then raise exception 'Choose the expense category.'; end if;
  if v_amt <= 0 then raise exception 'Enter the amount.'; end if;
  if v_date is null then raise exception 'Enter the date of the expense.'; end if;
  if v_date > (now() at time zone 'Asia/Manila')::date then raise exception 'The expense date is in the future.'; end if;
  if coalesce(btrim(p->>'description'), '') = '' then raise exception 'Say what the expense was for.'; end if;
  if v_photo is null and cat.code <> 'meals' then raise exception 'Attach a photo of the receipt (only meals can be filed without one).'; end if;
  select monthly_limit into v_limit from public.expense_allowances where business_id = b and agent_id = v and category_id = cat.id and active;
  if v_limit is not null then
    select coalesce(sum(amount), 0) into v_used from public.agent_expenses
     where business_id = b and agent_id = v and category_id = cat.id and status in ('submitted','approved')
       and date_trunc('month', expense_date) = date_trunc('month', v_date);
  end if;
  insert into public.agent_expenses(business_id, expense_number, agent_id, expense_date, category_id, amount, description, photo_path, no_receipt,
                                    allowance_limit, over_allowance, created_by)
  values (b, public.agent_doc_number('AEX', b, 'public.agent_expenses', 'expense_number'), v, v_date, cat.id, v_amt, btrim(p->>'description'), v_photo, v_photo is null,
          v_limit, case when v_limit is null then 0 else greatest(least(v_used + v_amt - v_limit, v_amt), 0) end, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.agent_expense_submit(jsonb) from public;
grant execute on function public.agent_expense_submit(jsonb) to authenticated;

create or replace function public.agent_expense_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  update public.agent_expenses set status = 'cancelled', decided_at = now() where id = p_id and agent_id = v and status = 'submitted';
  if not found then raise exception 'Only an expense still waiting for approval can be cancelled.'; end if;
end $$;
revoke all on function public.agent_expense_cancel(uuid) from public;
grant execute on function public.agent_expense_cancel(uuid) to authenticated;

create or replace function public.agent_expense_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(e) || jsonb_build_object('category', k.name, 'category_code', k.code, 'agent', a.name, 'agent_code', a.agent_code,
           'store', coalesce(nullif(btrim(b.trade_name), ''), b.code), 'expense_status', x.status::text)
    from public.agent_expenses e join public.admin_expense_categories k on k.id = e.category_id join public.sales_agents a on a.id = e.agent_id
    join public.businesses b on b.id = e.business_id left join public.expenses x on x.id = e.expense_id
   where e.id = p_id;
$$;
revoke all on function public.agent_expense_json(uuid) from public;

create or replace function public.agent_expenses_list(p_business uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  return coalesce((select jsonb_agg(public.agent_expense_json(e.id) order by e.created_at desc)
                     from (select id, created_at from public.agent_expenses where agent_id = v and (p_business is null or business_id = p_business)
                           order by created_at desc limit 300) e), '[]'::jsonb);
end $$;
revoke all on function public.agent_expenses_list(uuid) from public;
grant execute on function public.agent_expenses_list(uuid) to authenticated;

-- Business Admin side
create or replace function public.agent_expenses_review()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Agent expenses are approved by the Business Admin.'; end if;
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return coalesce((select jsonb_agg(public.agent_expense_json(e.id) order by e.created_at desc)
                     from (select id, created_at from public.agent_expenses where business_id = b and (status = 'submitted' or created_at > now() - interval '60 days')
                           order by created_at desc limit 300) e), '[]'::jsonb);
end $$;
revoke all on function public.agent_expenses_review() from public;
grant execute on function public.agent_expenses_review() to authenticated;

-- approve → an approved Sales expense for Finance to post and pay back to the agent
create or replace function public.agent_expense_decide(p_id uuid, p_approve boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); e record; a record; v_section uuid; v_month uuid; v_exp uuid; v_year int; v_mon int;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Agent expenses are approved by the Business Admin.'; end if;
  select * into e from public.agent_expenses where id = p_id and business_id = b for update;
  if not found then raise exception 'Agent expense not found in this store.'; end if;
  if e.status <> 'submitted' then raise exception 'Expense % is already %.', e.expense_number, e.status; end if;
  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Say why the expense is rejected.'; end if;
    update public.agent_expenses set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where id = p_id;
    return null;
  end if;
  select * into a from public.sales_agents where id = e.agent_id;
  select id into v_section from public.sections where code = 'sales';
  v_year := extract(year from e.expense_date)::int; v_mon := extract(month from e.expense_date)::int;
  select id into v_month from public.months where business_id = b and year = v_year and month = v_mon;
  if v_month is null then
    insert into public.months(business_id, year, month, label) values (b, v_year, v_mon, to_char(e.expense_date, 'FMMonth YYYY')) returning id into v_month;
  end if;
  insert into public.expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id, vendor, payment_method,
                              receipt_reference, document_reference, notes, prepared_by, prepared_at, approved_by, approved_at)
  values (v_section, v_month, b, 'Agent expense · ' || a.name || ' · ' || e.description, e.amount, 'approved', e.expense_date, e.category_id, a.name,
          'Reimbursement to agent', case when e.no_receipt then 'No receipt (meals)' else 'Receipt photo on ' || e.expense_number end, e.expense_number,
          concat_ws(' · ', nullif(btrim(p_note), ''), case when e.over_allowance > 0 then 'Over allowance by ₱' || e.over_allowance end),
          a.user_id, e.created_at, auth.uid(), now())
  returning id into v_exp;
  update public.agent_expenses set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''), expense_id = v_exp where id = p_id;
  return v_exp;
end $$;
revoke all on function public.agent_expense_decide(uuid, boolean, text) from public;
grant execute on function public.agent_expense_decide(uuid, boolean, text) to authenticated;

-- employee expenses over their monthly allowance (by who prepared them)
create or replace function public.expense_allowance_flags(p_ids uuid[])
returns table(expense_id uuid, monthly_limit numeric, month_total numeric, over_by numeric)
language sql stable security definer set search_path = public as $$
  with x as (
    select e.id, e.business_id, e.prepared_by, e.category_id, date_trunc('month', coalesce(e.expense_date, e.created_at::date)) as m
      from public.expenses e
     where e.id = any(p_ids) and e.prepared_by is not null and e.category_id is not null
       and (public.is_super_admin() or e.business_id = public.current_business_id())
  )
  select x.id, al.monthly_limit, t.total, greatest(t.total - al.monthly_limit, 0)
    from x
    join public.expense_allowances al on al.business_id = x.business_id and al.user_id = x.prepared_by and al.category_id = x.category_id and al.active
    cross join lateral (select coalesce(sum(e2.amount), 0) as total from public.expenses e2
                         where e2.business_id = x.business_id and e2.prepared_by = x.prepared_by and e2.category_id = x.category_id
                           and date_trunc('month', coalesce(e2.expense_date, e2.created_at::date)) = x.m) t;
$$;
revoke all on function public.expense_allowance_flags(uuid[]) from public;
grant execute on function public.expense_allowance_flags(uuid[]) to authenticated;

-- agent files (receipt / deposit photos): private bucket, written by the server
insert into storage.buckets (id, name, public) values ('agent-files', 'agent-files', false) on conflict (id) do nothing;

-- internal helpers: not callable from the API (Supabase grants new functions to anon / authenticated by default)
do $$
declare f text; r text;
begin
  foreach f in array array[
    'public.agent_require()', 'public.agent_check_store(uuid)', 'public.agent_client(uuid, uuid)',
    'public.agent_client_price(uuid, uuid, uuid, int, numeric, numeric, numeric)', 'public.agent_doc_number(text, uuid, regclass, text)',
    'public.agent_order_json(uuid)', 'public.agent_pending_reported(uuid, uuid)', 'public.agent_payment_json(uuid)', 'public.agent_expense_json(uuid)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function %s from %I', f, r); end if;
    end loop;
  end loop;
end $$;
