-- Build 137 — public shop: three layouts (A classic storefront, B bold hero, C app style), chosen per store in
-- Sales → Online Shop (owner, 2026-10-17); a Facebook page link ("Like us on Facebook"); front-page sections the
-- store turns on / off: announcements, a promotion, a featured product and a product slideshow. The slideshow is a
-- Category / Item / Brand choice, any part left blank (e.g. Car Aircon / Blower Motor / Toyota = all Toyota blower
-- motors; Car Aircon / – / Toyota = all Toyota car aircon parts; – / Blower Motor / – = all blower motors).
-- "Request for quotation" is a page that sends the request by Messenger / Viber / text (nothing stored).

alter table public.shop_settings add column if not exists layout text not null default 'A';
alter table public.shop_settings drop constraint if exists shop_settings_layout_check;
alter table public.shop_settings add constraint shop_settings_layout_check check (layout in ('A', 'B', 'C'));
alter table public.shop_settings add column if not exists facebook_url text;
alter table public.shop_settings add column if not exists show_announcements boolean not null default true;
alter table public.shop_settings add column if not exists show_promo boolean not null default true;
alter table public.shop_settings add column if not exists show_featured boolean not null default true;
alter table public.shop_settings add column if not exists show_slideshow boolean not null default true;
alter table public.shop_settings add column if not exists featured_item_id uuid references public.finance_procurement_items(id);
alter table public.shop_settings add column if not exists slideshow_category text;
alter table public.shop_settings add column if not exists slideshow_item text;
alter table public.shop_settings add column if not exists slideshow_brand text;
alter table public.shop_settings add column if not exists slideshow_title text;

-- announcements and promotions (one table: kind)
create table if not exists public.shop_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  kind text not null check (kind in ('announcement', 'promo')),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text check (body is null or length(body) <= 600),
  starts_on date,
  ends_on date,
  item_id uuid references public.finance_procurement_items(id),   -- promo: the product whose photo shows
  link_category text,                                               -- promo: "Shop the promo" opens this category
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists shop_posts_business on public.shop_posts(business_id, kind, starts_on desc);
alter table public.shop_posts enable row level security;
drop policy if exists shop_posts_read on public.shop_posts;
create policy shop_posts_read on public.shop_posts for select
  using (public.is_super_admin() or business_id = public.current_business_id());
grant select on public.shop_posts to authenticated;

create or replace function public.shop_can_edit(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or (public.is_business_admin() and p_business = public.current_business_id());
$$;
revoke all on function public.shop_can_edit(uuid) from public;

create or replace function public.shop_post_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_b uuid := coalesce((p->>'business_id')::uuid, public.current_business_id()); v_id uuid := nullif(p->>'id', '')::uuid;
        v_kind text := p->>'kind'; v_title text := nullif(btrim(coalesce(p->>'title', '')), ''); v_old public.shop_posts;
begin
  if not public.shop_can_edit(v_b) then raise exception 'Only the store''s Business Admin or the Super Admin edits the shop''s announcements and promotions.'; end if;
  if v_kind not in ('announcement', 'promo') then raise exception 'Choose Announcement or Promotion.'; end if;
  if v_title is null then raise exception 'Enter a title.'; end if;
  if v_id is not null then
    select * into v_old from public.shop_posts where id = v_id;
    if not found or v_old.business_id <> v_b then raise exception 'Post not found in this store.'; end if;
    update public.shop_posts set kind = v_kind, title = left(v_title, 120), body = nullif(left(btrim(coalesce(p->>'body', '')), 600), ''),
           starts_on = nullif(p->>'starts_on', '')::date, ends_on = nullif(p->>'ends_on', '')::date,
           item_id = nullif(p->>'item_id', '')::uuid, link_category = nullif(btrim(coalesce(p->>'link_category', '')), ''),
           active = coalesce((p->>'active')::boolean, active), updated_at = now()
     where id = v_id;
  else
    insert into public.shop_posts(business_id, kind, title, body, starts_on, ends_on, item_id, link_category, active, created_by)
    values (v_b, v_kind, left(v_title, 120), nullif(left(btrim(coalesce(p->>'body', '')), 600), ''), nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date,
            nullif(p->>'item_id', '')::uuid, nullif(btrim(coalesce(p->>'link_category', '')), ''), coalesce((p->>'active')::boolean, true), auth.uid())
    returning id into v_id;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'shop_posts', v_id, 'edited', p);
  return v_id;
end $$;
revoke all on function public.shop_post_save(jsonb) from public;
grant execute on function public.shop_post_save(jsonb) to authenticated;

create or replace function public.shop_post_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_b uuid;
begin
  select business_id into v_b from public.shop_posts where id = p_id;
  if v_b is null then raise exception 'Post not found.'; end if;
  if not public.shop_can_edit(v_b) then raise exception 'Only the store''s Business Admin or the Super Admin removes posts.'; end if;
  delete from public.shop_posts where id = p_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'shop_posts', p_id, 'deleted', '{}'::jsonb);
end $$;
revoke all on function public.shop_post_delete(uuid) from public;
grant execute on function public.shop_post_delete(uuid) to authenticated;

-- settings: the new keys (layout, Facebook, sections, featured product, slideshow)
create or replace function public.shop_settings_save(p_business uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.shop_settings; v_msg text; v_viber text; v_fb text;
begin
  if not public.shop_can_edit(p_business) then
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
  v_fb := nullif(btrim(coalesce(p->>'facebook_url', v_old.facebook_url, '')), '');
  if v_fb is not null and v_fb !~* '^https://((www|m|web)\.)?facebook\.com/[^ ]+$' then
    raise exception 'Facebook page: paste the page''s link, e.g. https://www.facebook.com/Pili.Aire/';
  end if;
  if p ? 'layout' and coalesce(p->>'layout', '') not in ('A', 'B', 'C') then raise exception 'Choose layout A, B or C.'; end if;
  if nullif(p->>'featured_item_id', '') is not null and not exists (
       select 1 from public.finance_procurement_items i where i.id = (p->>'featured_item_id')::uuid and i.active
          and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null) then
    raise exception 'The featured product must be an active catalog item with a photo.';
  end if;
  update public.shop_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    in_5h13 = coalesce((p->>'in_5h13')::boolean, in_5h13),
    slug = coalesce(nullif(lower(btrim(p->>'slug')), ''), slug),
    messenger_url = case when p ? 'messenger_url' then v_msg else messenger_url end,
    viber_number = case when p ? 'viber_number' then v_viber else viber_number end,
    facebook_url = case when p ? 'facebook_url' then v_fb else facebook_url end,
    tagline = case when p ? 'tagline' then nullif(left(btrim(p->>'tagline'), 120), '') else tagline end,
    layout = coalesce(nullif(p->>'layout', ''), layout),
    show_announcements = coalesce((p->>'show_announcements')::boolean, show_announcements),
    show_promo = coalesce((p->>'show_promo')::boolean, show_promo),
    show_featured = coalesce((p->>'show_featured')::boolean, show_featured),
    show_slideshow = coalesce((p->>'show_slideshow')::boolean, show_slideshow),
    featured_item_id = case when p ? 'featured_item_id' then nullif(p->>'featured_item_id', '')::uuid else featured_item_id end,
    slideshow_category = case when p ? 'slideshow_category' then nullif(btrim(p->>'slideshow_category'), '') else slideshow_category end,
    slideshow_item = case when p ? 'slideshow_item' then nullif(btrim(p->>'slideshow_item'), '') else slideshow_item end,
    slideshow_brand = case when p ? 'slideshow_brand' then nullif(btrim(p->>'slideshow_brand'), '') else slideshow_brand end,
    slideshow_title = case when p ? 'slideshow_title' then nullif(left(btrim(p->>'slideshow_title'), 80), '') else slideshow_title end,
    updated_by = auth.uid(), updated_at = now()
  where business_id = p_business;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'shop_settings', p_business, 'edited', p);
end $$;
revoke all on function public.shop_settings_save(uuid, jsonb) from public;
grant execute on function public.shop_settings_save(uuid, jsonb) to authenticated;

-- the store's public details (now with the layout and the Facebook link)
create or replace function public.shop_store(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', s.slug, 'code', b.code, 'name', coalesce(nullif(btrim(b.trade_name), ''), b.legal_name),
           'logo_url', b.branding->>'logo_url', 'theme', b.branding->'theme', 'phone', b.phone, 'email', b.email, 'address', b.address,
           'messenger_url', s.messenger_url, 'viber_number', s.viber_number, 'facebook_url', s.facebook_url, 'tagline', s.tagline, 'layout', s.layout)
    from public.shop_settings s join public.businesses b on b.id = s.business_id
   where s.slug = lower(btrim(p_slug)) and s.enabled and b.is_active;
$$;
revoke all on function public.shop_store(text) from public;
grant execute on function public.shop_store(text) to anon, authenticated;

-- one product card's public fields
create or replace function public.shop_card(p_business uuid, p_item uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('item_id', i.id, 'item_name', i.item_name, 'category', i.category, 'brand', i.brand, 'unit', i.unit,
           'photo_path', coalesce(i.photo_path, i.photo_path_2, i.photo_path_3),
           'price', (select pr.list_price from public.storefront_item_price(i.id, p_business) pr where pr.list_price > 0),
           'available', case when i.item_type = 'service' then null else public.shop_in_stock(p_business, i.id) end)
    from public.finance_procurement_items i
   where i.id = p_item and i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null;
$$;
revoke all on function public.shop_card(uuid, uuid) from public;

-- the front page's sections (each only when switched on and filled)
create or replace function public.shop_home(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.shop_business(p_slug); s public.shop_settings; v_today date := (now() at time zone 'Asia/Manila')::date;
        ca text; it text; br text; esc text := '\';
begin
  if b is null then return null; end if;
  select * into s from public.shop_settings where business_id = b;
  ca := s.slideshow_category; it := s.slideshow_item; br := s.slideshow_brand;
  return jsonb_build_object(
    'promo', case when s.show_promo then (
        select jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'ends_on', p.ends_on, 'link_category', p.link_category,
                 'item', case when p.item_id is not null then public.shop_card(b, p.item_id) end)
          from public.shop_posts p
         where p.business_id = b and p.kind = 'promo' and p.active
           and (p.starts_on is null or p.starts_on <= v_today) and (p.ends_on is null or p.ends_on >= v_today)
         order by p.starts_on desc nulls last, p.created_at desc limit 1) end,
    'announcements', case when s.show_announcements then coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'date', coalesce(p.starts_on, p.created_at::date)) order by coalesce(p.starts_on, p.created_at::date) desc, p.created_at desc)
          from (select * from public.shop_posts p
                 where p.business_id = b and p.kind = 'announcement' and p.active
                   and (p.starts_on is null or p.starts_on <= v_today) and (p.ends_on is null or p.ends_on >= v_today)
                 order by coalesce(p.starts_on, p.created_at::date) desc, p.created_at desc limit 5) p), '[]'::jsonb) else '[]'::jsonb end,
    'featured', case when s.show_featured and s.featured_item_id is not null then public.shop_card(b, s.featured_item_id) end,
    'slideshow', case when s.show_slideshow and coalesce(ca, it, br) is not null then jsonb_build_object(
        'title', coalesce(s.slideshow_title, concat_ws(' ', br, coalesce(it, ca))),
        'category', ca, 'item', it, 'brand', br,
        'items', coalesce((select jsonb_agg(public.shop_card(b, x.id) order by x.item_name)
                             from (select i.id, i.item_name from public.finance_procurement_items i
                                    where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null
                                      and (ca is null or lower(btrim(i.category)) = lower(ca))
                                      and (it is null or lower(btrim(i.generic_item)) = lower(it))
                                      and (br is null or lower(btrim(i.brand)) = lower(br))
                                    order by i.item_name limit 20) x), '[]'::jsonb)) end);
end $$;
revoke all on function public.shop_home(text) from public;
grant execute on function public.shop_home(text) to anon, authenticated;

-- ------------------------------------------------ settings-screen helpers --
-- items with a photo, for choosing the featured / promo product
create or replace function public.shop_admin_items(p_q text)
returns table(item_id uuid, item_name text, category text, brand text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Access denied.'; end if;
  return query
  select i.id, i.item_name, i.category, i.brand from public.finance_procurement_items i
   where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null
     and (nullif(btrim(coalesce(p_q, '')), '') is null
          or public.catalog_words_match(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.category), left(btrim(p_q), 80)))
   order by i.item_name limit 20;
end $$;
revoke all on function public.shop_admin_items(text) from public;
grant execute on function public.shop_admin_items(text) to authenticated;

-- Category / Item / Brand choices for the slideshow (among items with photos), each narrowed by the others,
-- with how many products the current choice shows
create or replace function public.shop_admin_filters(p_category text default null, p_item text default null, p_brand text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ca text := nullif(btrim(coalesce(p_category, '')), ''); it text := nullif(btrim(coalesce(p_item, '')), ''); br text := nullif(btrim(coalesce(p_brand, '')), '');
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Access denied.'; end if;
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
                           and (ca is null or lower(c) = lower(ca)) and (it is null or lower(g) = lower(it))), '[]'::jsonb),
      'count', (select count(*) from base where (ca is null or lower(c) = lower(ca)) and (it is null or lower(g) = lower(it)) and (br is null or lower(r) = lower(br)))));
end $$;
revoke all on function public.shop_admin_filters(text, text, text) from public;
grant execute on function public.shop_admin_filters(text, text, text) to authenticated;
