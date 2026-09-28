-- ============================================================================
-- Build 56 — Pricing foundation: supplier quote log (DOC-14) and the
-- catalog item's current cost with history and age (DOC-04, current-cost
-- part). Decisions (user, 2026-09-27):
--   * Quotes are always generated from catalog pricing; one pricing logic
--     for every item (current cost x category add-on x item markup = SRP,
--     then customer discount — unchanged, CAT-17).
--   * Supplier prices, today received only in Viber/Messenger chats, are
--     recorded in a supplier quote log: catalog item (dropdown), registered
--     supplier (dropdown; terms come from the supplier master), price typed,
--     validity ("while supply lasts" default / "fixed price"), lead time
--     (default "within the day"); date and recorder captured automatically.
--   * The log updates pricing: Procurement chooses which log entry becomes
--     the item's current cost ("Set as current cost"); nothing automatic.
--   * The current cost is SHARED by all businesses (it is the global
--     catalog's standard_cost / service_cost_basis). Pricing rules stay per
--     business, so SRP can still differ by business.
--   * Every item shows how many days since its cost was last updated.
--   * Viewable by Procurement (Finance section), Finance and Sales;
--     managed by Procurement only.
-- Because the cost is shared, the log is shared too (global, like the
-- supplier master and catalog), so every business sees the quotes behind
-- the shared cost; each entry records which business it was entered for.
-- ============================================================================

-- --------------------------------------------------------------- helpers ---
create or replace function public.can_manage_supplier_quotes()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or public.is_business_admin()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'finance')
      or public.has_section_access('finance');
$$;

create or replace function public.can_view_supplier_quotes()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_supplier_quotes()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'sales')
      or public.has_section_access('sales');
$$;

revoke all on function public.can_manage_supplier_quotes() from public;
revoke all on function public.can_view_supplier_quotes() from public;
grant execute on function public.can_manage_supplier_quotes() to authenticated;
grant execute on function public.can_view_supplier_quotes() to authenticated;

-- ------------------------------------------------------ supplier quote log ---
create table if not exists public.finance_supplier_quote_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.finance_procurement_items(id),
  supplier_id uuid not null references public.finance_suppliers(id),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  validity text not null default 'while_supply_lasts' check (validity in ('while_supply_lasts','fixed_price')),
  lead_time text not null default 'Within the day',
  recorded_for_business_id uuid references public.businesses(id),
  created_by uuid not null references public.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_quote_log_item on public.finance_supplier_quote_log(item_id, created_at desc);
create index if not exists idx_supplier_quote_log_supplier on public.finance_supplier_quote_log(supplier_id, created_at desc);
create index if not exists idx_supplier_quote_log_created on public.finance_supplier_quote_log(created_at desc);

create or replace function public.stamp_supplier_quote_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.recorded_for_business_id := coalesce(public.current_business_id(), new.recorded_for_business_id);
    if not exists (select 1 from public.finance_suppliers s where s.id = new.supplier_id and s.active) then
      raise exception 'Supplier is not an active registered supplier. Register the supplier first.';
    end if;
  else
    -- who/when/for-which-business of the original record never change
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.recorded_for_business_id := old.recorded_for_business_id;
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists supplier_quote_log_stamp on public.finance_supplier_quote_log;
create trigger supplier_quote_log_stamp
before insert or update on public.finance_supplier_quote_log
for each row execute function public.stamp_supplier_quote_log();

alter table public.finance_supplier_quote_log enable row level security;

drop policy if exists supplier_quote_log_view on public.finance_supplier_quote_log;
create policy supplier_quote_log_view on public.finance_supplier_quote_log
  for select using (public.can_view_supplier_quotes());
drop policy if exists supplier_quote_log_manage on public.finance_supplier_quote_log;
create policy supplier_quote_log_manage on public.finance_supplier_quote_log
  for all using (public.can_manage_supplier_quotes()) with check (public.can_manage_supplier_quotes());

grant select, insert, update, delete on public.finance_supplier_quote_log to authenticated;

-- ------------------------------------------------ current cost + history ---
alter table public.finance_procurement_items add column if not exists cost_updated_at timestamptz;
alter table public.finance_procurement_items add column if not exists cost_source_quote_id uuid references public.finance_supplier_quote_log(id) on delete set null;

create table if not exists public.finance_item_cost_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.finance_procurement_items(id) on delete cascade,
  cost_field text not null check (cost_field in ('standard_cost','service_cost_basis')),
  previous_cost numeric(14,2),
  new_cost numeric(14,2),
  source text not null check (source in ('supplier_quote','manual')),
  quote_log_id uuid references public.finance_supplier_quote_log(id) on delete set null,
  supplier_id uuid references public.finance_suppliers(id),
  set_by uuid references public.users(id),
  set_for_business_id uuid references public.businesses(id),
  set_at timestamptz not null default now()
);
create index if not exists idx_item_cost_history_item on public.finance_item_cost_history(item_id, set_at desc);

alter table public.finance_item_cost_history enable row level security;
drop policy if exists item_cost_history_view on public.finance_item_cost_history;
create policy item_cost_history_view on public.finance_item_cost_history
  for select using (public.can_view_supplier_quotes());
grant select on public.finance_item_cost_history to authenticated;
-- no insert/update/delete grant: written only by the trigger below

-- Every change to an item's cost is recorded, whichever path made it:
-- "Set as current cost" from the quote log (source supplier_quote), or a
-- direct edit of the catalog item (source manual). The item's cost age
-- (cost_updated_at) is stamped on every change.
create or replace function public.track_item_cost_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_supplier uuid; v_field text; v_old numeric; v_new numeric;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.standard_cost, 0) <> 0 or coalesce(new.service_cost_basis, 0) <> 0 then
      new.cost_updated_at := coalesce(new.cost_updated_at, now());
    end if;
    return new;
  end if;
  if new.standard_cost is not distinct from old.standard_cost
     and new.service_cost_basis is not distinct from old.service_cost_basis then
    -- cost unchanged: a stale source pointer may not be introduced
    new.cost_source_quote_id := old.cost_source_quote_id;
    return new;
  end if;
  -- A cost change is from a supplier quote only when made through
  -- set_item_cost_from_quote(), which flags the quote id for this
  -- transaction (so re-applying the same quote after its price was edited
  -- is still recorded as a supplier-quote change). Anything else is a
  -- manual catalog edit and clears the source pointer.
  if new.cost_source_quote_id is null
     or coalesce(current_setting('ibx.cost_from_quote', true), '') <> new.cost_source_quote_id::text then
    new.cost_source_quote_id := null;
  end if;
  new.cost_updated_at := now();
  if new.cost_source_quote_id is not null then
    select supplier_id into v_supplier from public.finance_supplier_quote_log where id = new.cost_source_quote_id;
  end if;
  if new.standard_cost is distinct from old.standard_cost then
    v_field := 'standard_cost'; v_old := old.standard_cost; v_new := new.standard_cost;
  else
    v_field := 'service_cost_basis'; v_old := old.service_cost_basis; v_new := new.service_cost_basis;
  end if;
  insert into public.finance_item_cost_history(item_id, cost_field, previous_cost, new_cost, source, quote_log_id, supplier_id, set_by, set_for_business_id)
  values (new.id, v_field, v_old, v_new,
          case when new.cost_source_quote_id is null then 'manual' else 'supplier_quote' end,
          new.cost_source_quote_id, v_supplier, auth.uid(), public.current_business_id());
  return new;
end;
$$;

drop trigger if exists procurement_items_track_cost on public.finance_procurement_items;
create trigger procurement_items_track_cost
before insert or update on public.finance_procurement_items
for each row execute function public.track_item_cost_change();

-- Set an item's current cost from a quote log entry. Session-scoped: the
-- caller must be able to manage supplier quotes AND update the catalog item
-- (Finance/Super Admin under the catalog's existing RLS).
create or replace function public.set_item_cost_from_quote(p_quote_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare q record; v_type text; v_rows int;
begin
  if not public.can_manage_supplier_quotes() then
    raise exception 'Only Procurement can set an item''s current cost.';
  end if;
  select * into q from public.finance_supplier_quote_log where id = p_quote_id;
  if not found then raise exception 'Supplier quote not found.'; end if;
  select item_type into v_type from public.finance_procurement_items where id = q.item_id;
  perform set_config('ibx.cost_from_quote', q.id::text, true);
  if v_type = 'service' then
    update public.finance_procurement_items set service_cost_basis = q.unit_price, cost_source_quote_id = q.id, updated_at = now() where id = q.item_id;
  else
    update public.finance_procurement_items set standard_cost = q.unit_price, cost_source_quote_id = q.id, updated_at = now() where id = q.item_id;
  end if;
  get diagnostics v_rows = row_count;
  perform set_config('ibx.cost_from_quote', '', true);
  if v_rows = 0 then raise exception 'You do not have permission to change this item''s cost.'; end if;
end;
$$;
revoke all on function public.set_item_cost_from_quote(uuid) from public;
grant execute on function public.set_item_cost_from_quote(uuid) to authenticated;
