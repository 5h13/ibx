-- ============================================================================
-- Build 86 — AGT-01 Part A: sales agents on every customer and every sale
--   (owner, 2026-10-03)
--   * sales_agents: the agent list. Each store has its own "Store" agent
--     (created automatically, one per business); freelance agents are one list
--     for all stores (they sell for all three).
--   * Every customer has an agent (required); a new customer defaults to the
--     store's own agent.
--   * Every counter sale, quotation and sales order takes the agent of its
--     customer, LOCKED: the cashier cannot change it on the sale; to change it,
--     change the customer's agent (applies to new sales only — past sales keep
--     the agent they were made under).
--   * Agent logins, commission matrix and payouts come in later parts.
--   Admin scripts can set a sale's agent directly with
--     set local ibx.agent_override = 'on';
-- ============================================================================

create table if not exists public.sales_agents (
  id uuid primary key default gen_random_uuid(),
  agent_code text not null unique,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'freelance' check (kind in ('store','freelance')),
  business_id uuid references public.businesses(id),
  phone text, email text, gcash_number text, notes text,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'store') = (business_id is not null))
);
create unique index if not exists sales_agents_one_store_agent on public.sales_agents(business_id) where kind = 'store';

alter table public.sales_agents enable row level security;
drop policy if exists sales_agents_select on public.sales_agents;
create policy sales_agents_select on public.sales_agents for select to authenticated
  using (kind = 'freelance' or public.business_row_visible(business_id));
-- writes go through sales_agent_save() only
revoke insert, update, delete on public.sales_agents from authenticated, anon;

-- the store's own agent (created on first use)
create or replace function public.sales_agent_store(p_business uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; bz record;
begin
  if p_business is null then return null; end if;
  select id into v from public.sales_agents where business_id = p_business and kind = 'store';
  if v is not null then return v; end if;
  select * into bz from public.businesses where id = p_business;
  if not found then return null; end if;
  insert into public.sales_agents(agent_code, name, kind, business_id)
  values ('STORE-' || bz.code, 'Store (' || coalesce(nullif(btrim(bz.trade_name), ''), bz.code) || ')', 'store', p_business)
  on conflict do nothing;
  select id into v from public.sales_agents where business_id = p_business and kind = 'store';
  return v;
end $$;
revoke all on function public.sales_agent_store(uuid) from public, anon;
grant execute on function public.sales_agent_store(uuid) to authenticated;

do $$ begin perform public.sales_agent_store(id) from public.businesses; end $$;

create or replace function public.businesses_store_agent() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sales_agent_store(new.id); return new; end $$;
drop trigger if exists businesses_store_agent on public.businesses;
create trigger businesses_store_agent after insert on public.businesses for each row execute function public.businesses_store_agent();

-- add / edit an agent: Business Admins and the Super Admin. Store agents: name and contact only.
create or replace function public.sales_agent_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := p_id; a record; n int; v_name text := nullif(btrim(p->>'name'), '');
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin can add or change agents.'; end if;
  if v_name is null then raise exception 'Enter the agent''s name.'; end if;
  if v is null then
    perform pg_advisory_xact_lock(hashtext('AGENT-CODE'));
    select coalesce(max(substring(agent_code from 4)::int), 0) + 1 into n from public.sales_agents where agent_code ~ '^AG-[0-9]+$';
    insert into public.sales_agents(agent_code, name, kind, phone, email, gcash_number, notes, active, created_by)
    values ('AG-' || lpad(n::text, 4, '0'), v_name, 'freelance', nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'email'), ''),
            nullif(btrim(p->>'gcash_number'), ''), nullif(btrim(p->>'notes'), ''), true, auth.uid())
    returning id into v;
  else
    select * into a from public.sales_agents where id = v;
    if not found then raise exception 'Agent not found.'; end if;
    if a.kind = 'store' and not public.business_row_visible(a.business_id) then raise exception 'That is another store''s agent.'; end if;
    if a.kind = 'store' and p ? 'active' and not coalesce((p->>'active')::boolean, true) then raise exception 'The store''s own agent cannot be deactivated.'; end if;
    if p ? 'active' and not coalesce((p->>'active')::boolean, true)
       and exists (select 1 from public.finance_customers where agent_id = v and active) then
      raise exception 'Move this agent''s customers to another agent first (% customer(s)).', (select count(*) from public.finance_customers where agent_id = v and active);
    end if;
    update public.sales_agents
       set name = v_name, phone = nullif(btrim(p->>'phone'), ''), email = nullif(btrim(p->>'email'), ''),
           gcash_number = nullif(btrim(p->>'gcash_number'), ''), notes = nullif(btrim(p->>'notes'), ''),
           active = case when p ? 'active' then coalesce((p->>'active')::boolean, active) else active end, updated_at = now()
     where id = v;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'sales_agents', v, case when p_id is null then 'agent_added' else 'agent_changed' end, p);
  return v;
end $$;
revoke all on function public.sales_agent_save(uuid, jsonb) from public, anon;
grant execute on function public.sales_agent_save(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ customer agent --
alter table public.finance_customers add column if not exists agent_id uuid references public.sales_agents(id);

create or replace function public.customer_agent_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.agent_id is null then new.agent_id := public.sales_agent_store(new.business_id); return new; end if;
  if tg_op = 'UPDATE' and new.agent_id is not distinct from old.agent_id then return new; end if;
  select * into a from public.sales_agents where id = new.agent_id;
  if not found then raise exception 'Agent not found.'; end if;
  if not a.active then raise exception 'Agent % is inactive.', a.name; end if;
  if a.kind = 'store' and a.business_id is distinct from new.business_id then raise exception 'That is another store''s own agent.'; end if;
  return new;
end $$;
drop trigger if exists finance_customers_agent on public.finance_customers;
create trigger finance_customers_agent before insert or update of agent_id, business_id on public.finance_customers
  for each row execute function public.customer_agent_guard();
update public.finance_customers set agent_id = public.sales_agent_store(business_id) where agent_id is null and business_id is not null;

-- ------------------------------------------------- agent on every sale (locked) --
alter table public.storefront_sales add column if not exists agent_id uuid references public.sales_agents(id);
alter table public.sales_quotations add column if not exists agent_id uuid references public.sales_agents(id);
alter table public.sales_orders add column if not exists agent_id uuid references public.sales_agents(id);

create or replace function public.sale_agent_from_customer() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('ibx.agent_override', true), '') = 'on' and new.agent_id is not null then return new; end if;
  if tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id or old.agent_id is null then
    new.agent_id := coalesce((select agent_id from public.finance_customers where id = new.customer_id), public.sales_agent_store(new.business_id));
  else
    new.agent_id := old.agent_id;          -- locked: follows the customer, not edited on the sale
  end if;
  return new;
end $$;
drop trigger if exists storefront_sales_agent on public.storefront_sales;
create trigger storefront_sales_agent before insert or update of customer_id, agent_id on public.storefront_sales for each row execute function public.sale_agent_from_customer();
drop trigger if exists sales_quotations_agent on public.sales_quotations;
create trigger sales_quotations_agent before insert or update of customer_id, agent_id on public.sales_quotations for each row execute function public.sale_agent_from_customer();
drop trigger if exists sales_orders_agent on public.sales_orders;
create trigger sales_orders_agent before insert or update of customer_id, agent_id on public.sales_orders for each row execute function public.sale_agent_from_customer();

-- existing records: the customer's agent (= the store's own agent)
update public.storefront_sales set agent_id = null where agent_id is null;
update public.sales_quotations set agent_id = null where agent_id is null;
update public.sales_orders set agent_id = null where agent_id is null;
create index if not exists storefront_sales_agent_idx on public.storefront_sales(agent_id, sale_date);
create index if not exists finance_customers_agent_idx on public.finance_customers(agent_id);

-- ---------------------------------------------- Storefront: new customer + agent --
drop function if exists public.storefront_add_customer(text, text, text, text);
create or replace function public.storefront_add_customer(p_name text, p_phone text default null, p_address text default null, p_tax_id text default null, p_agent uuid default null)
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
  insert into public.finance_customers(business_id, customer_code, legal_name, phone, address, tax_id, active, created_by, agent_id)
  values (b, 'CUS-' || code || '-' || lpad(n::text, 5, '0'), btrim(p_name), nullif(btrim(p_phone),''), nullif(btrim(p_address),''), nullif(btrim(p_tax_id),''), true, auth.uid(),
          coalesce(p_agent, public.sales_agent_store(b)))
  returning id into v;
  return v;
end $$;
grant execute on function public.storefront_add_customer(text, text, text, text, uuid) to authenticated;

-- now that every customer has one, the agent is required
alter table public.finance_customers alter column agent_id set not null;
