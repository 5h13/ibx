-- ============================================================================
-- CAT-33 / SF-06 — catalog CSV import (user decisions, 2026-09-28)
--
-- 1. Re-importing a file now updates the Supplier Cost of items that already
--    exist when the file has a different, non-zero cost. The change is written
--    to the item cost history (finance_item_cost_history) with
--    source = 'csv_import' and note = 'CSV import'.
--      * finance_item_cost_history: new source value 'csv_import', new column
--        note;
--      * track_item_cost_change(): a change made while the transaction flag
--        ibx.cost_source = 'csv_import' is recorded as a CSV import;
--      * catalog_import_update_costs(jsonb): sets that flag and updates the
--        costs (SECURITY INVOKER: the caller's own catalog rights apply, the
--        same as catalog_insert_items).
--
-- 2. The import applies the pricing (category add-ons / item markups) to one,
--    several or all businesses chosen on the import screen.
--      * catalog_import_pricing(uuid[], jsonb, boolean): SECURITY DEFINER.
--        Checks the caller (Super Admin, Business Admin or Finance) and every
--        target business: only the Super Admin may target a business other
--        than their own; everybody else may target only their own business.
--        Works out, per business, the add-on of each category (existing
--        active add-on, else the file's most common Add on) and the markup of
--        each row (from STORE PRICE when given, else %Mark up). With
--        p_apply = false it only validates (dry run, nothing written); with
--        p_apply = true it writes, all-or-nothing.
-- ============================================================================

-- ----------------------------------------------------- 1. cost history ---
alter table public.finance_item_cost_history add column if not exists note text;
alter table public.finance_item_cost_history drop constraint if exists finance_item_cost_history_source_check;
alter table public.finance_item_cost_history
  add constraint finance_item_cost_history_source_check check (source in ('supplier_quote','manual','csv_import'));

create or replace function public.track_item_cost_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_supplier uuid; v_field text; v_old numeric; v_new numeric; v_source text; v_note text;
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
  -- transaction. A change made by catalog_import_update_costs() is a CSV
  -- import. Anything else is a manual catalog edit and clears the source
  -- pointer.
  if new.cost_source_quote_id is null
     or coalesce(current_setting('ibx.cost_from_quote', true), '') <> new.cost_source_quote_id::text then
    new.cost_source_quote_id := null;
  end if;
  new.cost_updated_at := now();
  if new.cost_source_quote_id is not null then
    select supplier_id into v_supplier from public.finance_supplier_quote_log where id = new.cost_source_quote_id;
    v_source := 'supplier_quote';
  elsif coalesce(current_setting('ibx.cost_source', true), '') = 'csv_import' then
    v_source := 'csv_import'; v_note := 'CSV import';
  else
    v_source := 'manual';
  end if;
  if new.standard_cost is distinct from old.standard_cost then
    v_field := 'standard_cost'; v_old := old.standard_cost; v_new := new.standard_cost;
  else
    v_field := 'service_cost_basis'; v_old := old.service_cost_basis; v_new := new.service_cost_basis;
  end if;
  insert into public.finance_item_cost_history(item_id, cost_field, previous_cost, new_cost, source, note, quote_log_id, supplier_id, set_by, set_for_business_id)
  values (new.id, v_field, v_old, v_new, v_source, v_note,
          new.cost_source_quote_id, v_supplier, auth.uid(), public.current_business_id());
  return new;
end;
$$;

-- Update the Supplier Cost of existing items from an import file.
-- p_rows: [{ "id": uuid, "cost": numeric }]. Rows with a blank / zero cost,
-- or the same cost (to the centavo), are left alone. Services get their
-- service cost basis updated instead. Returns the items that changed.
create or replace function public.catalog_import_update_costs(p_rows jsonb)
returns table(id uuid, item_code text, previous_cost numeric, new_cost numeric)
language plpgsql volatile security invoker set search_path = public as $$
#variable_conflict use_column
begin
  perform set_config('ibx.cost_source', 'csv_import', true);
  return query
  with src as (
    select distinct on (r.id) r.id as sid, round(r.cost, 2) as cost
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(id uuid, cost numeric)
     where r.id is not null and coalesce(r.cost, 0) > 0
     order by r.id
  ), cur as (
    select i.id as cid, i.item_type,
           case when i.item_type = 'service' then i.service_cost_basis else i.standard_cost end as old_cost
      from public.finance_procurement_items i join src on src.sid = i.id
     where i.active
  ), upd as (
    update public.finance_procurement_items i
       set standard_cost      = case when c.item_type = 'service' then i.standard_cost else s.cost end,
           service_cost_basis = case when c.item_type = 'service' then s.cost else i.service_cost_basis end,
           updated_at = now()
      from src s join cur c on c.cid = s.sid
     where i.id = s.sid and s.cost is distinct from c.old_cost
    returning i.id, i.item_code, c.old_cost, s.cost
  )
  select * from upd;
  perform set_config('ibx.cost_source', '', true);
end;
$$;
revoke all on function public.catalog_import_update_costs(jsonb) from public;
grant execute on function public.catalog_import_update_costs(jsonb) to authenticated;

-- ------------------------------------------------ 2. pricing per business ---
-- p_rows: [{ "line": int, "item_id": uuid|null, "item_name": text,
--            "category_id": uuid, "cost": numeric, "addon": numeric|null,
--            "store": numeric|null, "markup": numeric|null }]
-- Returns { "errors": [text], "businesses": [{ business_id, code, name,
--   markups, new_addons: [{category, addon}], addon_exceptions: [text] }] }.
create or replace function public.catalog_import_pricing(p_business_ids uuid[], p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_super boolean := public.is_super_admin();
  v_own uuid := public.current_business_id();
  v_ids uuid[];
  v_multi boolean;
  b record; r record;
  v_errors text[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_new_addons jsonb; v_exceptions text[]; v_markups int;
  v_acq numeric; v_m numeric; v_final numeric; v_pre text;
begin
  if v_uid is null or not exists (select 1 from public.users where id = v_uid and is_active) then
    raise exception 'Authentication required.';
  end if;
  if not (v_super or public.is_business_admin()
          or exists (select 1 from public.users where id = v_uid and role = 'finance')
          or public.has_section_access('finance')) then
    raise exception 'Finance access is required to import catalog prices.';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_business_ids, '{}'::uuid[])) as x where x is not null;
  if v_ids is null then
    raise exception 'Choose at least one business to apply the prices to.';
  end if;
  for b in select x as id, bz.code, bz.is_active from unnest(v_ids) as x left join public.businesses bz on bz.id = x loop
    if b.code is null or not b.is_active then
      raise exception 'Prices can only be imported for an active business.';
    end if;
    if not v_super and b.id is distinct from v_own then
      raise exception 'Only the Super Admin can import prices for another business (%). You can import prices for your own business only.', b.code;
    end if;
  end loop;
  v_multi := array_length(v_ids, 1) > 1;

  for b in select id, code, coalesce(nullif(btrim(trade_name), ''), legal_name) as name
             from public.businesses where id = any(v_ids) order by code loop
    v_pre := case when v_multi then b.code || ': ' else '' end;
    -- categories with no active add-on in this business take the file's most
    -- common Add on (ties: the value that appears first in the file)
    with f as (
      select x.category_id, x.addon, count(*) as n, min(x.line) as first_line
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(line int, category_id uuid, addon numeric)
       where x.addon is not null and x.category_id is not null
       group by 1, 2
    ), top as (
      select distinct on (category_id) category_id, addon from f order by category_id, n desc, first_line
    )
    select coalesce(jsonb_agg(jsonb_build_object('category_id', t.category_id, 'category', c.name, 'addon', t.addon) order by c.name), '[]'::jsonb)
      into v_new_addons
      from top t join public.finance_catalog_categories c on c.id = t.category_id
     where not exists (select 1 from public.finance_catalog_category_pricing p
                        where p.business_id = b.id and p.category_id = t.category_id and p.active);

    if p_apply then
      insert into public.finance_catalog_category_pricing as cp (business_id, category_id, addon_percent, active, updated_at, created_by)
      select b.id, (e->>'category_id')::uuid, (e->>'addon')::numeric, true, now(), v_uid
        from jsonb_array_elements(v_new_addons) e
      on conflict (business_id, category_id) do update
         set addon_percent = excluded.addon_percent, active = true, updated_at = now(), created_by = excluded.created_by
       where not cp.active;
    end if;

    v_exceptions := '{}'; v_markups := 0;
    for r in
      select x.line, x.item_id, x.item_name, x.cost, x.addon, x.store, x.markup,
             coalesce((select p.addon_percent from public.finance_catalog_category_pricing p
                        where p.business_id = b.id and p.category_id = x.category_id and p.active),
                      (select (e->>'addon')::numeric from jsonb_array_elements(v_new_addons) e
                        where (e->>'category_id')::uuid = x.category_id),
                      0) as cat_addon
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
             as x(line int, item_id uuid, item_name text, category_id uuid, cost numeric, addon numeric, store numeric, markup numeric)
       order by x.line
    loop
      if r.addon is not null and r.addon <> r.cat_addon then
        v_exceptions := v_exceptions || format('row %s %s (%s%% vs category %s%%)', r.line, r.item_name, r.addon::float8, r.cat_addon::float8);
      end if;
      v_final := r.markup;
      if r.store is not null then
        v_acq := coalesce(r.cost, 0) * (1 + r.cat_addon / 100);
        if v_acq <= 0 then
          v_errors := v_errors || format('%sRow %s: STORE PRICE needs a Supplier Cost above 0.', v_pre, r.line);
          v_final := null;
        else
          v_m := (r.store / v_acq - 1) * 100;
          if v_m < 0 then
            v_errors := v_errors || format('%sRow %s: STORE PRICE ₱%s is below the Acquisition Cost ₱%s.', v_pre, r.line, r.store::float8, to_char(v_acq, 'FM999999999990.00'));
            v_final := null;
          elsif v_m > 1000 then
            v_errors := v_errors || format('%sRow %s: STORE PRICE is more than 11× the Acquisition Cost (markup above 1000%%).', v_pre, r.line);
            v_final := null;
          else
            v_final := round(v_m, 8);
          end if;
        end if;
      elsif v_final is not null and (v_final < 0 or v_final > 1000) then
        v_errors := v_errors || format('%sRow %s: %%Mark up must be between 0%% and 1000%%.', v_pre, r.line);
        v_final := null;
      end if;
      if v_final is not null and r.item_id is not null then
        v_markups := v_markups + 1;
        if p_apply then
          insert into public.finance_catalog_item_pricing as ip (business_id, item_id, markup_percent, active, updated_at, created_by)
          values (b.id, r.item_id, v_final, true, now(), v_uid)
          on conflict (business_id, item_id) do update
             set markup_percent = excluded.markup_percent, active = true, updated_at = now(), created_by = excluded.created_by;
        end if;
      end if;
    end loop;

    if p_apply then
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (v_uid, 'businesses', b.id, 'catalog_import_pricing',
              jsonb_build_object('business_code', b.code, 'markups', v_markups,
                                 'new_addons', (select coalesce(jsonb_agg(e - 'category_id'), '[]'::jsonb) from jsonb_array_elements(v_new_addons) e)));
    end if;
    v_out := v_out || jsonb_build_object('business_id', b.id, 'code', b.code, 'name', b.name, 'markups', v_markups,
                                         'new_addons', (select coalesce(jsonb_agg(e - 'category_id'), '[]'::jsonb) from jsonb_array_elements(v_new_addons) e),
                                         'addon_exceptions', to_jsonb(v_exceptions));
  end loop;

  if p_apply and coalesce(array_length(v_errors, 1), 0) > 0 then
    raise exception 'Catalog prices were not imported (% issue(s)): %', array_length(v_errors, 1), array_to_string(v_errors[1:10], ' ');
  end if;
  return jsonb_build_object('errors', to_jsonb(v_errors), 'businesses', v_out);
end;
$$;
revoke all on function public.catalog_import_pricing(uuid[], jsonb, boolean) from public;
grant execute on function public.catalog_import_pricing(uuid[], jsonb, boolean) to authenticated;
