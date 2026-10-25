-- Build 141 — Studio and photo touch-up (from 5h13Shops Builds 11–12.2), adapted to the ERP (owner, 2026-10-25).
-- The Studio makes pictures from the catalog on the user's own phone / computer (specs card, price lists, banners,
-- New arrivals / Back in stock); nothing is drawn on the server. A picture can be posted on the store's online shop
-- as the promotion or as an announcement. Decided: prices on pictures are the store's shop prices (never cost or
-- agent tiers); no store logo is stamped on catalog photos (they are shared by all stores; the Studio pictures carry
-- the store's own logo). Who: the store's Business Admin, Sales Manager, Sales and Marketing staff.

alter table public.shop_settings add column if not exists studio_font text not null default 'barlow';
alter table public.shop_settings drop constraint if exists shop_settings_studio_font_check;
alter table public.shop_settings add constraint shop_settings_studio_font_check check (studio_font in ('barlow', 'oswald', 'saira', 'archivo', 'roboto'));

-- a promotion or announcement can be a Studio picture (in the store's folder of the public logo bucket)
alter table public.shop_posts add column if not exists image_path text
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/studio-[0-9]+\.(png|jpg)$');
create or replace function public.shop_posts_image_guard() returns trigger language plpgsql as $$
begin
  if new.image_path is not null and split_part(new.image_path, '/', 1) <> new.business_id::text then
    raise exception 'This picture belongs to another store.';
  end if;
  return new;
end $$;
drop trigger if exists shop_posts_image_guard on public.shop_posts;
create trigger shop_posts_image_guard before insert or update of image_path, business_id on public.shop_posts
  for each row execute function public.shop_posts_image_guard();

-- who may use the Studio (and post its pictures on the shop): the shop's staff, plus Marketing
create or replace function public.studio_access(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_business is not null and (public.shop_staff(p_business)
      or (p_business = public.current_business_id() and public.has_section_access('marketing')));
$$;
revoke all on function public.studio_access(uuid) from public;
grant execute on function public.studio_access(uuid) to authenticated;

-- the Studio's products: active catalog items with a photo, at the store's shop price, Available / By order
create or replace function public.studio_products()
returns table(id uuid, code text, name text, category text, price numeric, available boolean, specification text,
              photo_path text, photo_path_2 text, photo_path_3 text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare b uuid := public.current_business_id();
begin
  if not public.studio_access(b) then raise exception 'The Studio is for the store''s sales and marketing people.'; end if;
  return query
  select i.id, i.item_code, i.item_name, coalesce(nullif(btrim(i.category), ''), 'Other'),
         (select pr.list_price from public.storefront_item_price(i.id, b) pr where pr.list_price > 0),
         case when i.item_type = 'service' then true else public.shop_in_stock(b, i.id) end,
         i.specification, i.photo_path, i.photo_path_2, i.photo_path_3, i.created_at, i.updated_at
    from public.finance_procurement_items i
   where i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null
   order by i.item_name;
end $$;
revoke all on function public.studio_products() from public;
grant execute on function public.studio_products() to authenticated;

create or replace function public.studio_font_save(p_font text)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.current_business_id();
begin
  if not public.studio_access(b) then raise exception 'The Studio is for the store''s sales and marketing people.'; end if;
  if p_font not in ('barlow', 'oswald', 'saira', 'archivo', 'roboto') then raise exception 'Choose a font.'; end if;
  update public.shop_settings set studio_font = p_font, updated_at = now() where business_id = b;
end $$;
revoke all on function public.studio_font_save(text) from public;
grant execute on function public.studio_font_save(text) to authenticated;

-- post a Studio picture (already uploaded to the store's folder by the server) as the promotion or an announcement
create or replace function public.studio_post(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.current_business_id(); v_kind text := coalesce(p->>'kind', 'promo'); v_id uuid; v_item uuid; v_ends date;
begin
  if not public.studio_access(b) then raise exception 'Only the store''s sales and marketing people post Studio pictures.'; end if;
  if v_kind not in ('promo', 'announcement') then raise exception 'Post it as the promotion or an announcement.'; end if;
  if coalesce(p->>'image_path', '') = '' then raise exception 'The picture is missing. Try again.'; end if;
  if nullif(p->>'ends_on', '') is not null then
    v_ends := (p->>'ends_on')::date;
    if v_ends < (now() at time zone 'Asia/Manila')::date then raise exception 'The end date has passed.'; end if;
  end if;
  if v_kind = 'promo' and nullif(p->>'item_id', '') is not null then
    select id into v_item from public.finance_procurement_items where id = (p->>'item_id')::uuid and active;
  end if;
  insert into public.shop_posts(business_id, kind, title, ends_on, item_id, image_path, active, created_by)
  values (b, v_kind, left(coalesce(nullif(btrim(p->>'title'), ''), case v_kind when 'promo' then 'Promotion' else 'Announcement' end), 120),
          v_ends, v_item, p->>'image_path', true, auth.uid())
  returning id into v_id;
  -- the section shows on the shop's front page
  update public.shop_settings set show_promo = show_promo or v_kind = 'promo', show_announcements = show_announcements or v_kind = 'announcement'
   where business_id = b;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'shop_posts', v_id, 'studio_posted', jsonb_build_object('kind', v_kind));
  return v_id;
end $$;
revoke all on function public.studio_post(jsonb) from public;
grant execute on function public.studio_post(jsonb) to authenticated;

-- the shop's front page: promotions and announcements also return their Studio picture
create or replace function public.shop_home(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.shop_business(p_slug); s public.shop_settings; v_today date := (now() at time zone 'Asia/Manila')::date;
        ca text; it text; br text;
begin
  if b is null then return null; end if;
  select * into s from public.shop_settings where business_id = b;
  ca := s.slideshow_category; it := s.slideshow_item; br := s.slideshow_brand;
  return jsonb_build_object(
    'promo', case when s.show_promo then (
        select jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'ends_on', p.ends_on, 'link_category', p.link_category,
                 'image_path', p.image_path,
                 'item', case when p.item_id is not null then public.shop_card(b, p.item_id) end)
          from public.shop_posts p
         where p.business_id = b and p.kind = 'promo' and p.active
           and (p.starts_on is null or p.starts_on <= v_today) and (p.ends_on is null or p.ends_on >= v_today)
         order by p.starts_on desc nulls last, p.created_at desc limit 1) end,
    'announcements', case when s.show_announcements then coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'image_path', p.image_path,
                                            'date', coalesce(p.starts_on, p.created_at::date)) order by coalesce(p.starts_on, p.created_at::date) desc, p.created_at desc)
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
