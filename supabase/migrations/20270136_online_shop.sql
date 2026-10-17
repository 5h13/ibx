-- Build 136 — CP-01 stage 1: public online catalogs, one per store (owner, 2026-10-17).
-- /shop/<store>: the store's own brand, prices and contacts; open to anyone (no login); read only.
-- Shows active catalog items that have at least one photo, at the store's price ("Ask for price" when
-- the store has none). Never stock, cost, markup or suppliers. The Super Admin turns each store's shop on;
-- the store's Business Admin (or the Super Admin) sets its Messenger / Viber contacts and a short tagline.
-- Visitors reach the data only through the shop_* functions below (granted to the anonymous role).

create table if not exists public.shop_settings (
  business_id uuid primary key references public.businesses(id),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,30}$'),
  enabled boolean not null default false,
  in_5h13 boolean not null default true,
  messenger_url text,
  viber_number text,
  tagline text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.shop_settings enable row level security;
drop policy if exists shop_settings_read on public.shop_settings;
create policy shop_settings_read on public.shop_settings for select
  using (public.is_super_admin() or business_id = public.current_business_id());
grant select on public.shop_settings to authenticated;

-- every store gets its row (off); the address is the store code in lower case (/shop/pili, /shop/aton, /shop/ishabella)
insert into public.shop_settings(business_id, slug)
select b.id, lower(regexp_replace(b.code, '[^A-Za-z0-9-]', '', 'g')) from public.businesses b
on conflict (business_id) do nothing;

create or replace function public.shop_settings_save(p_business uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.shop_settings; v_msg text; v_viber text;
begin
  if not (public.is_super_admin() or (public.is_business_admin() and p_business = public.current_business_id())) then
    raise exception 'Only the store''s Business Admin or the Super Admin changes the online shop settings.';
  end if;
  select * into v_old from public.shop_settings where business_id = p_business;
  if not found then
    insert into public.shop_settings(business_id, slug)
    select b.id, lower(regexp_replace(b.code, '[^A-Za-z0-9-]', '', 'g')) from public.businesses b where b.id = p_business
    returning * into v_old;
  end if;
  if (p ? 'enabled' or p ? 'in_5h13' or p ? 'slug') and not public.is_super_admin() then
    raise exception 'Only the Super Admin turns a store''s online shop on or off.';
  end if;
  v_msg := nullif(btrim(coalesce(p->>'messenger_url', v_old.messenger_url, '')), '');
  if v_msg is not null and v_msg !~* '^https://(m\.me|(www\.)?facebook\.com|(www\.)?messenger\.com)/' then
    raise exception 'Messenger link: paste the page''s m.me or facebook.com link (starting with https://).';
  end if;
  v_viber := nullif(regexp_replace(coalesce(p->>'viber_number', v_old.viber_number, ''), '[^0-9+]', '', 'g'), '');
  if v_viber is not null and v_viber !~ '^(\+?63|0)9\d{9}$' then
    raise exception 'Viber number: enter a mobile number like 0917 123 4567.';
  end if;
  update public.shop_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    in_5h13 = coalesce((p->>'in_5h13')::boolean, in_5h13),
    slug = coalesce(nullif(lower(btrim(p->>'slug')), ''), slug),
    messenger_url = case when p ? 'messenger_url' then v_msg else messenger_url end,
    viber_number = case when p ? 'viber_number' then v_viber else viber_number end,
    tagline = case when p ? 'tagline' then nullif(left(btrim(p->>'tagline'), 120), '') else tagline end,
    updated_by = auth.uid(), updated_at = now()
  where business_id = p_business;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'shop_settings', p_business, 'edited', p);
end $$;
revoke all on function public.shop_settings_save(uuid, jsonb) from public;
grant execute on function public.shop_settings_save(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------- public reads --
-- the open shop's business (null when the address is unknown or the shop is off)
create or replace function public.shop_business(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select s.business_id from public.shop_settings s join public.businesses b on b.id = s.business_id
   where s.slug = lower(btrim(p_slug)) and s.enabled and b.is_active;
$$;
revoke all on function public.shop_business(text) from public;

create or replace function public.shop_store(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', s.slug, 'code', b.code, 'name', coalesce(nullif(btrim(b.trade_name), ''), b.legal_name),
           'logo_url', b.branding->>'logo_url', 'theme', b.branding->'theme', 'phone', b.phone, 'email', b.email, 'address', b.address,
           'messenger_url', s.messenger_url, 'viber_number', s.viber_number, 'tagline', s.tagline)
    from public.shop_settings s join public.businesses b on b.id = s.business_id
   where s.slug = lower(btrim(p_slug)) and s.enabled and b.is_active;
$$;
revoke all on function public.shop_store(text) from public;
grant execute on function public.shop_store(text) to anon, authenticated;

-- the open shops (for /shop until the 5H13 shop is built)
create or replace function public.shop_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'name', coalesce(nullif(btrim(b.trade_name), ''), b.legal_name), 'logo_url', b.branding->>'logo_url', 'tagline', s.tagline)
           order by coalesce(nullif(btrim(b.trade_name), ''), b.legal_name)), '[]'::jsonb)
    from public.shop_settings s join public.businesses b on b.id = s.business_id where s.enabled and b.is_active;
$$;
revoke all on function public.shop_list() from public;
grant execute on function public.shop_list() to anon, authenticated;

create or replace function public.shop_catalog(p_slug text, p_q text default null, p_category text default null, p_item text default null, p_brand text default null,
                                               p_limit int default 24, p_offset int default 0)
returns table(item_id uuid, item_name text, category text, generic_item text, brand text, unit text, photo_path text, price numeric, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare b uuid := public.shop_business(p_slug); esc text := '\';
        q text := nullif(btrim(coalesce(p_q, '')), ''); it text := nullif(btrim(coalesce(p_item, '')), '');
        br text := nullif(btrim(coalesce(p_brand, '')), ''); ca text := nullif(btrim(coalesce(p_category, '')), '');
begin
  if b is null then return; end if;
  q := left(q, 80);
  it := replace(replace(replace(it, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  br := replace(replace(replace(br, esc, esc || esc), '%', esc || '%'), '_', esc || '_');
  return query
  with hits as (
    select i.id, i.item_name, i.category, i.generic_item, i.brand, i.unit, coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) photo, count(*) over () total
      from public.finance_procurement_items i
     where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null
       and (ca is null or lower(i.category) = lower(ca))
       and (it is null or i.generic_item ilike '%' || it || '%')
       and (br is null or i.brand ilike '%' || br || '%')
       and (q is null or public.catalog_words_match(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.description, i.category), q))
     order by i.item_name
     limit greatest(1, least(coalesce(p_limit, 24), 60)) offset greatest(0, coalesce(p_offset, 0)))
  select h.id, h.item_name, h.category, h.generic_item, h.brand, h.unit, h.photo,
         (select pr.list_price from public.storefront_item_price(h.id, b) pr where pr.list_price > 0), h.total
    from hits h order by h.item_name;
end $$;
revoke all on function public.shop_catalog(text, text, text, text, text, int, int) from public;
grant execute on function public.shop_catalog(text, text, text, text, text, int, int) to anon, authenticated;

-- filter choices among the items with photos (each list narrowed by the other two choices)
create or replace function public.shop_filters(p_slug text, p_category text default null, p_item text default null, p_brand text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.shop_business(p_slug);
        ca text := nullif(btrim(coalesce(p_category, '')), ''); it text := nullif(btrim(coalesce(p_item, '')), ''); br text := nullif(btrim(coalesce(p_brand, '')), '');
begin
  if b is null then return null; end if;
  return (
    with base as (
      select btrim(i.category) c, btrim(i.generic_item) g, btrim(i.brand) r from public.finance_procurement_items i
       where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null)
    select jsonb_build_object(
      'categories', coalesce((select jsonb_agg(distinct c order by c) from base where nullif(c, '') is not null
                               and (it is null or lower(g) = lower(it)) and (br is null or lower(r) = lower(br))), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(distinct g order by g) from base where nullif(g, '') is not null
                          and (ca is null or lower(c) = lower(ca)) and (br is null or lower(r) = lower(br))), '[]'::jsonb),
      'brands', coalesce((select jsonb_agg(distinct r order by r) from base where nullif(r, '') is not null
                           and (ca is null or lower(c) = lower(ca)) and (it is null or lower(g) = lower(it))), '[]'::jsonb)));
end $$;
revoke all on function public.shop_filters(text, text, text, text) from public;
grant execute on function public.shop_filters(text, text, text, text) to anon, authenticated;

create or replace function public.shop_item(p_slug text, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.shop_business(p_slug);
begin
  if b is null then return null; end if;
  return (
    select jsonb_build_object('id', i.id, 'name', i.item_name, 'category', i.category, 'generic_item', i.generic_item, 'brand', i.brand, 'unit', i.unit,
             'description', i.description, 'specification', i.specification, 'item_type', i.item_type,
             'photos', to_jsonb(array_remove(array[i.photo_path, i.photo_path_2, i.photo_path_3], null)),
             'price', (select pr.list_price from public.storefront_item_price(i.id, b) pr where pr.list_price > 0))
      from public.finance_procurement_items i
     where i.id = p_item and i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null);
end $$;
revoke all on function public.shop_item(text, uuid) from public;
grant execute on function public.shop_item(text, uuid) to anon, authenticated;
