-- Build 74b — Logistics locations
--   LOG-47: location codes are unique per business, not across all businesses.
--   LOG-48: locations can be edited and deleted; the code can change and the
--           location can be deleted only while it has never been used.
--
-- "Used" = referenced by any row of a table whose foreign key to
-- logistics_locations blocks deletion (NO ACTION / RESTRICT). Found generically
-- from pg_constraint, so a future table that references locations is covered
-- automatically. Today that is: stock movements (ledger / stock balances),
-- receipts, stock transfers (from / to), delivery orders, storefront settings
-- (store location) and storefront sales (returns hang off sales).
-- logistics_inventory_location_settings (reorder levels) is ON DELETE CASCADE:
-- it is configuration, not usage, and goes with the location.
--
-- Nothing depended on the global uniqueness: no FK targets location_code, no
-- function or upsert uses ON CONFLICT (location_code), and the only functions
-- reading location_code join on location id (display only).

-- ------------------------------------------------ LOG-47 per-business code --
alter table public.logistics_locations drop constraint if exists logistics_locations_location_code_key;
drop index if exists public.logistics_locations_location_code_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'logistics_locations_business_code_key') then
    alter table public.logistics_locations
      add constraint logistics_locations_business_code_key unique (business_id, location_code);
  end if;
end $$;

-- Which blocking references a location has (labels for messages / the UI).
create or replace function public.logistics_location_usage(p_location uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare r record; hit boolean; used text[] := '{}'; lbl text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conrelid::regclass::text as tname, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.logistics_locations'::regclass
       and array_length(c.conkey, 1) = 1
       and c.confdeltype in ('a', 'r')          -- blocking FKs only (not cascade / set null)
     order by 2, 3
  loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into hit using p_location;
    if hit then
      lbl := case regexp_replace(r.tname, '^public\.', '')
        when 'logistics_stock_movements' then 'stock movements'
        when 'logistics_receipts' then 'goods receipts'
        when 'logistics_stock_transfers' then 'stock transfers'
        when 'logistics_delivery_orders' then 'delivery orders'
        when 'storefront_settings' then 'Storefront store location'
        when 'storefront_sales' then 'Storefront sales'
        else replace(regexp_replace(r.tname, '^public\.', ''), '_', ' ') end;
      if not lbl = any(used) then used := used || lbl; end if;
    end if;
  end loop;
  return used;
end $$;
revoke all on function public.logistics_location_usage(uuid) from public;

-- Same rule as the create/activate path: the RLS policy "logistics locations
-- access" (+ business admin policy) and the server action's logistics() check.
create or replace function public.logistics_can_manage_locations()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active
                  and (u.role in ('business_admin', 'logistics')
                       or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                                   where ua.user_id = u.id and s.code = 'logistics')));
$$;
revoke all on function public.logistics_can_manage_locations() from public;
grant execute on function public.logistics_can_manage_locations() to authenticated;

-- Readable duplicate error, trimmed code, and no code change once used. Runs
-- for direct table writes too (create action, REST), not only the functions.
create or replace function public.logistics_locations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare used text[];
begin
  new.location_code := btrim(coalesce(new.location_code, ''));
  if new.location_code = '' then raise exception 'Location code is required.'; end if;
  if tg_op = 'UPDATE' and new.location_code is distinct from old.location_code then
    used := public.logistics_location_usage(old.id);
    if cardinality(used) > 0 then
      raise exception 'The code of location % cannot be changed: it is already used in %.', old.location_code, array_to_string(used, ', ')
        using hint = 'Codes can only be changed on locations that were never used.';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.location_code is distinct from old.location_code or new.business_id is distinct from old.business_id)
     and exists (select 1 from public.logistics_locations l
                  where l.business_id = new.business_id and l.location_code = new.location_code and l.id <> new.id) then
    raise exception 'Location code % is already used in this business.', new.location_code using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists logistics_locations_guard on public.logistics_locations;
create trigger logistics_locations_guard before insert or update of location_code, business_id
  on public.logistics_locations for each row execute function public.logistics_locations_guard();

-- --------------------------------------------------- LOG-48 edit / delete --
create or replace function public.logistics_update_location(
  p_location uuid, p_code text, p_name text, p_type text, p_address text default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l public.logistics_locations;
begin
  if not public.logistics_can_manage_locations() then raise exception 'Logistics access required.'; end if;
  select * into l from public.logistics_locations where id = p_location for update;
  if not found or not public.business_row_visible(l.business_id) then raise exception 'Location not found.'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'Location name is required.'; end if;
  if coalesce(p_type, '') not in ('warehouse', 'store', 'office', 'transit', 'other') then
    raise exception 'Choose a valid location type.';
  end if;
  update public.logistics_locations
     set location_code = coalesce(nullif(btrim(p_code), ''), l.location_code),   -- trigger enforces used / duplicate
         location_name = btrim(p_name),
         location_type = p_type,
         address = nullif(btrim(coalesce(p_address, '')), ''),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         updated_at = now()
   where id = p_location;
end $$;

create or replace function public.logistics_delete_location(p_location uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l public.logistics_locations; used text[];
begin
  if not public.logistics_can_manage_locations() then raise exception 'Logistics access required.'; end if;
  select * into l from public.logistics_locations where id = p_location for update;
  if not found or not public.business_row_visible(l.business_id) then raise exception 'Location not found.'; end if;
  used := public.logistics_location_usage(p_location);
  if cardinality(used) > 0 then
    raise exception 'Location % cannot be deleted: it is used in %. Deactivate it instead; its stock history stays intact.',
      l.location_code, array_to_string(used, ', ');
  end if;
  delete from public.logistics_locations where id = p_location;   -- reorder settings cascade
  return l.location_code;
end $$;

-- Used-state of every location the caller can see (drives the Edit / Delete UI).
create or replace function public.logistics_locations_in_use()
returns table(location_id uuid, used_in text[]) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.logistics_can_manage_locations() then return; end if;
  return query
    select l.id, public.logistics_location_usage(l.id)
      from public.logistics_locations l
     where public.business_row_visible(l.business_id);
end $$;

revoke all on function public.logistics_update_location(uuid, text, text, text, text, text),
  public.logistics_delete_location(uuid), public.logistics_locations_in_use() from public;
grant execute on function public.logistics_update_location(uuid, text, text, text, text, text),
  public.logistics_delete_location(uuid), public.logistics_locations_in_use() to authenticated;
