-- Build 138 — Add store (Super Admin) and Copy pricing from another store (owner, 2026-10-17).
-- A new store is configuration and data only (no code change): the store itself plus what every store needs to
-- start — main stock location, walk-in customer, Storefront settings, operating mode (Full), commission and HR
-- settings, chart of accounts and Bank/Cash accounts, the current month, its online shop (off), and the store's
-- own house agent (made by the existing businesses trigger). It uses the shared catalog.
-- Prices: the catalog is shared but category add-ons and item markups are per store; a new store has none, so its
-- prices would equal cost. Copy pricing brings another store's add-ons and markups (at creation, or later).

create or replace function public.business_copy_pricing(p_from uuid, p_to uuid, p_overwrite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cat int; v_item int;
begin
  if not public.is_super_admin() then raise exception 'Only the Super Admin copies pricing between stores.'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Choose two different stores.'; end if;
  if not exists (select 1 from public.businesses where id = p_from) or not exists (select 1 from public.businesses where id = p_to) then raise exception 'Store not found.'; end if;
  if p_overwrite then
    insert into public.finance_catalog_category_pricing(business_id, category_id, addon_percent, active, effective_from, created_by)
    select p_to, s.category_id, s.addon_percent, true, current_date, auth.uid() from public.finance_catalog_category_pricing s where s.business_id = p_from and s.active
    on conflict (business_id, category_id) do update set addon_percent = excluded.addon_percent, active = true, effective_from = excluded.effective_from, updated_at = now();
    get diagnostics v_cat = row_count;
    insert into public.finance_catalog_item_pricing(business_id, item_id, markup_percent, active, effective_from, created_by)
    select p_to, s.item_id, s.markup_percent, true, current_date, auth.uid() from public.finance_catalog_item_pricing s where s.business_id = p_from and s.active
    on conflict (business_id, item_id) do update set markup_percent = excluded.markup_percent, active = true, effective_from = excluded.effective_from, updated_at = now();
    get diagnostics v_item = row_count;
  else
    insert into public.finance_catalog_category_pricing(business_id, category_id, addon_percent, active, effective_from, created_by)
    select p_to, s.category_id, s.addon_percent, true, current_date, auth.uid() from public.finance_catalog_category_pricing s where s.business_id = p_from and s.active
    on conflict (business_id, category_id) do nothing;
    get diagnostics v_cat = row_count;
    insert into public.finance_catalog_item_pricing(business_id, item_id, markup_percent, active, effective_from, created_by)
    select p_to, s.item_id, s.markup_percent, true, current_date, auth.uid() from public.finance_catalog_item_pricing s where s.business_id = p_from and s.active
    on conflict (business_id, item_id) do nothing;
    get diagnostics v_item = row_count;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'businesses', p_to, 'pricing_copied', jsonb_build_object('from', p_from, 'overwrite', p_overwrite, 'categories', v_cat, 'items', v_item));
  return jsonb_build_object('categories', v_cat, 'items', v_item);
end $$;
revoke all on function public.business_copy_pricing(uuid, uuid, boolean) from public;
grant execute on function public.business_copy_pricing(uuid, uuid, boolean) to authenticated;

create or replace function public.business_add(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p->>'code', ''))); v_legal text := nullif(btrim(coalesce(p->>'legal_name', '')), '');
        v_trade text := nullif(btrim(coalesce(p->>'trade_name', '')), ''); b uuid; v_loc uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_from uuid := nullif(p->>'copy_pricing_from', '')::uuid; v_slug text; v_tpl uuid;
begin
  if not public.is_super_admin() then raise exception 'Only the Super Admin adds a store.'; end if;
  if v_code !~ '^[A-Z0-9]{2,12}$' then raise exception 'Store code: 2 to 12 letters or digits, e.g. TALA.'; end if;
  if exists (select 1 from public.businesses where upper(code) = v_code) then raise exception 'A store with code % already exists.', v_code; end if;
  if v_legal is null then raise exception 'Enter the store''s registered (legal) name.'; end if;
  v_slug := lower(v_code);
  if exists (select 1 from public.shop_settings where slug = v_slug) then raise exception 'The shop address /shop/% is already used.', v_slug; end if;

  insert into public.businesses(code, legal_name, trade_name, is_active, branding, vat_registered, address, phone, email)
  values (v_code, left(v_legal, 200), left(coalesce(v_trade, v_legal), 120), true, '{}'::jsonb, coalesce((p->>'vat_registered')::boolean, false),
          nullif(left(btrim(coalesce(p->>'address', '')), 300), ''), nullif(left(btrim(coalesce(p->>'phone', '')), 80), ''), nullif(btrim(coalesce(p->>'email', '')), ''))
  returning id into b;

  -- main stock location, Storefront settings and walk-in customer
  insert into public.logistics_locations(location_code, location_name, location_type, address, active, notes, created_by, business_id)
  values ('MAIN', 'Main warehouse', 'warehouse', nullif(btrim(coalesce(p->>'address', '')), ''), true, 'Created with the store', auth.uid(), b)
  returning id into v_loc;
  insert into public.storefront_settings(business_id, location_id, updated_by) values (b, v_loc, auth.uid())
  on conflict (business_id) do update set location_id = excluded.location_id;
  perform public.storefront_walk_in(b);

  -- operating mode, commission and HR settings
  insert into public.business_operating_modes(business_id, mode, updated_by) values (b, 'full', auth.uid()) on conflict do nothing;
  insert into public.agent_commission_settings(business_id) values (b) on conflict do nothing;
  insert into public.bo_commission_settings(business_id) values (b) on conflict do nothing;
  insert into public.hr_store_settings(business_id) values (b) on conflict do nothing;

  -- books: chart of accounts, Bank/Cash, the current month
  perform public.fin_ensure_accounts(b);
  perform public.fin_ensure_accounts_ca(b);
  perform public.fin_ensure_accounts_er(b);
  -- accounts that later builds seeded once for the stores of that time (Petty Cash, Checks on Hand, Prepaid,
  -- 13th month, Commission, …): take the full list of account codes from a template store — the one pricing is
  -- copied from, else the oldest store. Codes and names only; no balances or entries.
  v_tpl := coalesce(v_from, (select id from public.businesses where id <> b order by created_at, code limit 1));
  if v_tpl is not null then
    insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description, is_control_account, active, created_by)
    select b, t.account_code, t.account_name, t.account_type, t.description, t.is_control_account, t.active, auth.uid()
      from public.finance_chart_of_accounts t
     where t.business_id = v_tpl
       and not exists (select 1 from public.finance_chart_of_accounts c where c.business_id = b and c.account_code = t.account_code);
    update public.finance_chart_of_accounts c set parent_id = np.id
      from public.finance_chart_of_accounts t join public.finance_chart_of_accounts tp on tp.id = t.parent_id
      join public.finance_chart_of_accounts np on np.business_id = b and np.account_code = tp.account_code
     where t.business_id = v_tpl and c.business_id = b and c.account_code = t.account_code and c.parent_id is null;
  end if;
  -- the counter's own receiving accounts (cash drawer, card and check clearing)
  insert into public.finance_bank_accounts(business_id, account_code, account_name, account_type, is_cash_on_hand, payment_method, gl_account_id, notes, created_by)
  select b, x.code, x.name, x.type, x.coh, x.method, (select id from public.finance_chart_of_accounts where business_id = b and account_code = x.gl), x.notes, auth.uid()
    from (values ('SF-CASH', 'Store cash drawer', 'cash', true, 'cash', '1000', 'Storefront cash drawer'),
                 ('SF-CARD', 'Card payments (clearing)', 'clearing', false, 'card', '1030', 'Card payments until the bank settles them'),
                 ('SF-CHECK', 'Checks on hand', 'clearing', false, 'check', '1040', 'Customer checks received at the counter until deposited')) x(code, name, type, coh, method, gl, notes)
   where not exists (select 1 from public.finance_bank_accounts f where f.business_id = b and f.account_code = x.code);
  -- standard agent commission brackets (the Business Admin adjusts them in Sales settings)
  insert into public.agent_commission_brackets(business_id, min_paid, points)
  select b, x.m, x.p from (values (0::numeric, -5::numeric), (200000, 0), (300000, 1), (400000, 2), (500000, 5), (600000, 6), (700000, 7), (800000, 8), (900000, 9), (1000000, 10)) x(m, p)
  on conflict do nothing;
  insert into public.months(business_id, year, month, label)
  values (b, extract(year from v_today)::int, extract(month from v_today)::int, to_char(v_today, 'FMMonth YYYY'))
  on conflict do nothing;

  -- online shop (off until the Super Admin opens it)
  insert into public.shop_settings(business_id, slug) values (b, v_slug) on conflict (business_id) do nothing;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'businesses', b, 'created', p - 'copy_pricing_from' || jsonb_build_object('code', v_code));

  if v_from is not null then perform public.business_copy_pricing(v_from, b, true); end if;
  return b;
end $$;
revoke all on function public.business_add(jsonb) from public;
grant execute on function public.business_add(jsonb) to authenticated;

-- what a store still needs before it can sell (shown on the Businesses screen)
create or replace function public.business_readiness(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_super_admin() or (public.is_business_admin() and p_business = public.current_business_id())) then raise exception 'Access denied.'; end if;
  return jsonb_build_object(
    'logo', exists (select 1 from public.businesses where id = p_business and coalesce(branding->>'logo_url', '') <> ''),
    'contacts', exists (select 1 from public.businesses where id = p_business and (phone is not null or email is not null) and address is not null),
    'location', exists (select 1 from public.storefront_settings where business_id = p_business and location_id is not null),
    'receiving_accounts', exists (select 1 from public.finance_bank_accounts where business_id = p_business and coalesce(is_cash_on_hand, false) = false and status = 'active'),
    'pricing', (select count(*) from public.finance_catalog_category_pricing where business_id = p_business and active) + (select count(*) from public.finance_catalog_item_pricing where business_id = p_business and active),
    'users', (select count(*) from public.users where business_id = p_business and is_active),
    'business_admin', exists (select 1 from public.users where business_id = p_business and is_active and role::text = 'business_admin'),
    'stock_items', (select count(*) from public.logistics_inventory_items where business_id = p_business and active),
    'customers', (select count(*) from public.finance_customers where business_id = p_business and active and customer_code not like 'WALKIN-%'));
end $$;
revoke all on function public.business_readiness(uuid) from public;
grant execute on function public.business_readiness(uuid) to authenticated;
