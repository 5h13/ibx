-- Build 139 — the shop's look and controls from 5h13Shops (Builds 3, 10), adapted to the ERP (owner, 2026-10-25).
-- 1. Banner photo behind the shop header, with "keep in view" (top / middle / bottom).
-- 2. WhatsApp number per shop (WhatsApp links fill in the buyer's message; Messenger / Viber do not).
-- 3. Staff preview: the store's own shop staff see their shop while it is switched off (with a Preview strip) and a
--    "Manage shop" button; visitors still see nothing until the Super Admin opens it.
-- 4. Requests saved in the ERP: a buyer sends a question or a request for quotation, chooses how the store should
--    contact them, gets a request number and a private status page. The store answers from its Inbox
--    (Sales Manager app and Sales → Shop Inbox). Logo, colours and contacts stay the store's (System → Businesses).

alter table public.shop_settings
  add column if not exists banner_path text check (banner_path is null or banner_path ~ '^[0-9a-f-]{36}/shop-banner-[0-9a-f-]{36}\.(jpg|png|webp)$'),
  add column if not exists banner_focus text not null default 'center' check (banner_focus in ('top', 'center', 'bottom')),
  add column if not exists whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+?[0-9]{10,15}$');

-- the banner file must be in the store's own folder
create or replace function public.shop_settings_banner_guard() returns trigger language plpgsql as $$
begin
  if new.banner_path is not null and split_part(new.banner_path, '/', 1) <> new.business_id::text then
    raise exception 'The banner photo must be in the store''s own folder.';
  end if;
  return new;
end $$;
drop trigger if exists shop_settings_banner_guard on public.shop_settings;
create trigger shop_settings_banner_guard before insert or update of banner_path on public.shop_settings
  for each row execute function public.shop_settings_banner_guard();

-- who works the store's shop: its Business Admin, Sales approvers (Sales Manager) and staff with Sales access;
-- the Super Admin for any store
create or replace function public.shop_staff(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.is_super_admin()
      or (p_business = public.current_business_id() and (public.manager_access() or public.has_section_access('sales'))));
$$;
revoke all on function public.shop_staff(uuid) from public;
grant execute on function public.shop_staff(uuid) to authenticated;

-- a shop is reachable when it is open — or, while it is off, by its own staff (preview)
create or replace function public.shop_business(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select s.business_id from public.shop_settings s join public.businesses b on b.id = s.business_id
   where s.slug = lower(btrim(p_slug)) and b.is_active and (s.enabled or public.shop_staff(s.business_id));
$$;
revoke all on function public.shop_business(text) from public;

create or replace function public.shop_store(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', s.slug, 'code', b.code, 'name', coalesce(nullif(btrim(b.trade_name), ''), b.legal_name),
           'logo_url', b.branding->>'logo_url', 'theme', b.branding->'theme', 'phone', b.phone, 'email', b.email, 'address', b.address,
           'messenger_url', s.messenger_url, 'viber_number', s.viber_number, 'whatsapp_number', s.whatsapp_number,
           'facebook_url', s.facebook_url, 'tagline', s.tagline, 'layout', s.layout,
           'banner_path', s.banner_path, 'banner_focus', s.banner_focus,
           'preview', not s.enabled, 'manage', public.shop_staff(s.business_id))
    from public.shop_settings s join public.businesses b on b.id = s.business_id
   where s.business_id = public.shop_business(p_slug);
$$;
revoke all on function public.shop_store(text) from public;
grant execute on function public.shop_store(text) to anon, authenticated;

-- the item page also needs the item code (it goes into every message and request)
create or replace function public.shop_item(p_slug text, p_item uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.shop_business(p_slug);
begin
  if b is null then return null; end if;
  return (
    select jsonb_build_object('id', i.id, 'code', i.item_code, 'name', i.item_name, 'category', i.category, 'generic_item', i.generic_item, 'brand', i.brand, 'unit', i.unit,
             'description', i.description, 'specification', i.specification, 'item_type', i.item_type,
             'photos', to_jsonb(array_remove(array[i.photo_path, i.photo_path_2, i.photo_path_3], null)),
             'price', (select pr.list_price from public.storefront_item_price(i.id, b) pr where pr.list_price > 0),
             'available', case when i.item_type = 'service' then null else public.shop_in_stock(b, i.id) end)
      from public.finance_procurement_items i
     where i.id = p_item and i.active and coalesce(i.photo_path, i.photo_path_2, i.photo_path_3) is not null);
end $$;
revoke all on function public.shop_item(text, uuid) from public;
grant execute on function public.shop_item(text, uuid) to anon, authenticated;

-- settings: WhatsApp and the banner's "keep in view" (the banner file itself: shop_banner_set)
create or replace function public.shop_settings_save(p_business uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old public.shop_settings; v_msg text; v_viber text; v_fb text; v_wa text;
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
  v_wa := nullif(regexp_replace(coalesce(p->>'whatsapp_number', v_old.whatsapp_number, ''), '[^0-9+]', '', 'g'), '');
  if v_wa is not null and v_wa !~ '^\+?[0-9]{10,15}$' then
    raise exception 'WhatsApp number: enter a mobile number like 0917 123 4567.';
  end if;
  v_fb := nullif(btrim(coalesce(p->>'facebook_url', v_old.facebook_url, '')), '');
  if v_fb is not null and v_fb !~* '^https://((www|m|web)\.)?facebook\.com/[^ ]+$' then
    raise exception 'Facebook page: paste the page''s link, e.g. https://www.facebook.com/Pili.Aire/';
  end if;
  if p ? 'layout' and coalesce(p->>'layout', '') not in ('A', 'B', 'C') then raise exception 'Choose layout A, B or C.'; end if;
  if p ? 'banner_focus' and coalesce(p->>'banner_focus', '') not in ('top', 'center', 'bottom') then raise exception 'Keep in view: top, middle or bottom.'; end if;
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
    whatsapp_number = case when p ? 'whatsapp_number' then v_wa else whatsapp_number end,
    facebook_url = case when p ? 'facebook_url' then v_fb else facebook_url end,
    tagline = case when p ? 'tagline' then nullif(left(btrim(p->>'tagline'), 120), '') else tagline end,
    layout = coalesce(nullif(p->>'layout', ''), layout),
    banner_focus = coalesce(nullif(p->>'banner_focus', ''), banner_focus),
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

-- the banner photo (uploaded by the server after the same check); returns the old file to remove
create or replace function public.shop_banner_set(p_business uuid, p_path text)
returns text language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.shop_can_edit(p_business) then
    raise exception 'Only the store''s Business Admin or the Super Admin changes the shop banner.';
  end if;
  select banner_path into v_old from public.shop_settings where business_id = p_business;
  update public.shop_settings set banner_path = nullif(p_path, ''), updated_by = auth.uid(), updated_at = now() where business_id = p_business;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'shop_settings', p_business, case when nullif(p_path, '') is null then 'banner_removed' else 'banner_set' end, null);
  return v_old;
end $$;
revoke all on function public.shop_banner_set(uuid, text) from public;
grant execute on function public.shop_banner_set(uuid, text) to authenticated;

-- ------------------------------------------------------------------ requests --
create table if not exists public.shop_requests (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001),
  business_id uuid not null references public.businesses(id),
  kind text not null check (kind in ('ask', 'quote')),
  item_id uuid references public.finance_procurement_items(id),
  item_code text check (item_code is null or length(item_code) <= 40),
  title text not null check (length(title) between 1 and 200),
  buyer_name text not null check (length(btrim(buyer_name)) between 1 and 80),
  buyer_mobile text not null check (buyer_mobile ~ '^\+?[0-9]{7,15}$'),
  message text not null check (length(message) between 1 and 8000),
  total numeric(14, 2) check (total is null or total >= 0),
  contact_via text not null default 'text' check (contact_via in ('viber', 'whatsapp', 'text', 'call', 'messenger')),
  status text not null default 'new' check (status in ('new', 'seen', 'confirmed', 'unavailable', 'done')),
  reply_note text check (reply_note is null or length(reply_note) <= 500),
  token uuid not null default gen_random_uuid() unique,   -- the buyer's private status page
  answered_by uuid references public.users(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shop_requests_business on public.shop_requests (business_id, created_at desc);
create index if not exists shop_requests_mobile on public.shop_requests (business_id, buyer_mobile, created_at desc);
alter table public.shop_requests enable row level security;
drop policy if exists shop_requests_read on public.shop_requests;
create policy shop_requests_read on public.shop_requests for select to authenticated using (public.shop_staff(business_id));
revoke all on public.shop_requests from anon, authenticated;
grant select on public.shop_requests to authenticated;   -- changes go through shop_request_answer / shop_inbox_seen

-- the buyer sends a request. Limits: 5 per mobile per store in 10 minutes, 60 per store per hour.
create or replace function public.shop_send_request(p_slug text, p_kind text, p_title text, p_name text, p_mobile text,
                                                    p_message text, p_total numeric default null, p_item uuid default null,
                                                    p_contact text default 'text')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_b uuid := public.shop_business(p_slug); v_mobile text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
        v_code text; v_item uuid; r public.shop_requests; v_store text;
begin
  if v_b is null then raise exception 'This shop is not open.'; end if;
  if p_kind not in ('ask', 'quote') then raise exception 'This request could not be sent.'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Enter your name.'; end if;
  if v_mobile !~ '^\+?[0-9]{7,15}$' then raise exception 'Enter your mobile number, e.g. 0917 123 4567.'; end if;
  if length(btrim(coalesce(p_message, ''))) = 0 then raise exception 'This request is empty.'; end if;
  if coalesce(p_contact, '') not in ('viber', 'whatsapp', 'text', 'call', 'messenger') then p_contact := 'text'; end if;
  if (select count(*) from public.shop_requests where business_id = v_b and buyer_mobile = v_mobile and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'You have sent several requests just now. Please wait a few minutes, or message the store.';
  end if;
  if (select count(*) from public.shop_requests where business_id = v_b and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'The store is receiving many requests right now. Please message the store instead.';
  end if;
  if p_item is not null then
    select id, item_code into v_item, v_code from public.finance_procurement_items where id = p_item and active;
  end if;
  insert into public.shop_requests(business_id, kind, item_id, item_code, title, buyer_name, buyer_mobile, message, total, contact_via)
  values (v_b, p_kind, v_item, v_code, left(coalesce(nullif(btrim(p_title), ''), case p_kind when 'quote' then 'Request for quotation' else 'Question' end), 200),
          btrim(p_name), v_mobile, left(btrim(p_message), 8000),
          case when p_total is not null and p_total >= 0 then round(p_total, 2) end, p_contact)
  returning * into r;
  -- the store's people hear about it in the app (bell); email comes in Build 140
  select coalesce(nullif(btrim(trade_name), ''), legal_name) into v_store from public.businesses where id = v_b;
  insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
  select v_b, t.id, 'sales', 'shop_requests', r.id,
         'Shop · ' || case p_kind when 'quote' then 'Request for quotation' else 'Question' end || ' #' || r.number,
         r.title || ' — ' || r.buyer_name || ' (' || coalesce(v_store, '') || ')',
         case when t.manager then '/manager/inbox' else '/sales/shop-inbox' end, null
    from (select u.id, exists (select 1 from public.attention_recipients(v_b) a where a.user_id = u.id) as manager
            from public.users u
           where u.is_active and u.business_id = v_b
             and (u.role::text = 'business_admin'
                  or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                              where ua.user_id = u.id and s.code = 'sales'))) t;
  return jsonb_build_object('id', r.id, 'number', r.number, 'token', r.token);
end $$;
revoke all on function public.shop_send_request(text, text, text, text, text, text, numeric, uuid, text) from public;
grant execute on function public.shop_send_request(text, text, text, text, text, text, numeric, uuid, text) to anon, authenticated;

-- the buyer's status page: only that one request, by its private link
create or replace function public.shop_request_status(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', r.number, 'kind', r.kind, 'title', r.title, 'total', r.total, 'status', r.status,
           'reply_note', r.reply_note, 'contact_via', r.contact_via, 'buyer_name', r.buyer_name, 'message', r.message,
           'created_at', r.created_at, 'updated_at', r.updated_at, 'slug', s.slug)
    from public.shop_requests r join public.shop_settings s on s.business_id = r.business_id
   where r.token = p_token;
$$;
revoke all on function public.shop_request_status(uuid) from public;
grant execute on function public.shop_request_status(uuid) to anon, authenticated;

-- the Inbox: opening it marks new requests "seen"; answering sets Confirmed / Not available / Done with a note
create or replace function public.shop_inbox_seen()
returns int language plpgsql security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); n int;
begin
  if v_b is null or not public.shop_staff(v_b) then return 0; end if;
  update public.shop_requests set status = 'seen', updated_at = now() where business_id = v_b and status = 'new';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.shop_inbox_seen() from public;
grant execute on function public.shop_inbox_seen() to authenticated;

create or replace function public.shop_request_answer(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.shop_requests;
begin
  select * into r from public.shop_requests where id = p_id;
  if not found or not public.shop_staff(r.business_id) then raise exception 'Request not found.'; end if;
  if p_status not in ('seen', 'confirmed', 'unavailable', 'done') then raise exception 'Choose Confirmed, Not available or Done.'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'The note is too long (500 characters at most).'; end if;
  update public.shop_requests set status = p_status, reply_note = nullif(btrim(coalesce(p_note, '')), ''),
         answered_by = case when p_status = 'seen' then answered_by else auth.uid() end,
         answered_at = case when p_status = 'seen' then answered_at else now() end, updated_at = now()
   where id = p_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'shop_requests', p_id, 'answered', jsonb_build_object('status', p_status));
end $$;
revoke all on function public.shop_request_answer(uuid, text, text) from public;
grant execute on function public.shop_request_answer(uuid, text, text) to authenticated;

-- the count of new requests (badges)
create or replace function public.shop_inbox_count()
returns int language sql stable security definer set search_path = public as $$
  select case when public.shop_staff(public.current_business_id())
              then (select count(*)::int from public.shop_requests where business_id = public.current_business_id() and status = 'new')
              else 0 end;
$$;
revoke all on function public.shop_inbox_count() from public;
grant execute on function public.shop_inbox_count() to authenticated;
