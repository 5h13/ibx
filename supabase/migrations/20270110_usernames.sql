-- Build 104 — sign in with a username (or email); users without an email; nicknames.
--   * users.username: the login name. Default = first letter of the first name + "." + the surname written without
--     spaces (Alfredo Santiago → A.Santiago, Maria Dela Cruz → M.DelaCruz); a taken name gets a number (A.Santiago2).
--     Letters, numbers, dot, dash and underscore, 3–30 characters, unique whatever the case. Changeable in My Profile.
--     Special default (owner's request): Shiena Chavez / Shiena Lyn Chavez / Lyn Chavez → "5H13", greeted at sign-in.
--   * users.nickname: the name shown on screens (header, menus, agent app). Documents keep the full name.
--   * users.email_is_login_only: the account has no real email — the auth system still needs one, so the app gives
--     it a hidden address that is never shown or emailed. A real email added later in My Profile replaces it.
--   * users.first_name / last_name: kept so the username can be made correctly (two-word surnames).

alter table public.users add column if not exists username text;
alter table public.users add column if not exists nickname text;
alter table public.users add column if not exists first_name text;
alter table public.users add column if not exists last_name text;
alter table public.users add column if not exists email_is_login_only boolean not null default false;
alter table public.users add column if not exists welcome_name text;

-- letters only, accents folded (ñ → n), no spaces
create or replace function public.username_part(p text) returns text language sql immutable set search_path = public as $$
  select regexp_replace(translate(coalesce(p, ''), 'ÁÀÂÄÃáàâäãÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'), '[^A-Za-z0-9]', '', 'g');
$$;

create or replace function public.username_base(p_first text, p_last text) returns text language sql immutable set search_path = public as $$
  select case
    when lower(regexp_replace(btrim(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), '\s+', ' ', 'g'))
         in ('shiena chavez', 'shiena lyn chavez', 'lyn chavez') then '5H13'
    else nullif(upper(left(public.username_part(p_first), 1)), '') || '.' ||
         coalesce(nullif(public.username_part(initcap(coalesce(p_last, ''))), ''), 'User')
  end;
$$;

-- the next free username from a base (A.Santiago, A.Santiago2, …); a taken "5H13" falls back to the normal pattern
create or replace function public.username_next(p_first text, p_last text, p_exclude uuid default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare b text := public.username_base(p_first, p_last); c text; n int := 1;
begin
  if b is null or b = '.User' then b := 'User'; end if;
  if b = '5H13' and exists (select 1 from public.users where lower(username) = '5h13' and id is distinct from p_exclude) then
    b := coalesce(nullif(upper(left(public.username_part(p_first), 1)), '') || '.', '') || coalesce(nullif(public.username_part(initcap(coalesce(p_last, ''))), ''), 'User');
  end if;
  if length(b) < 3 then b := b || 'User'; end if;
  b := left(b, 27);
  c := b;
  while exists (select 1 from public.users where lower(username) = lower(c) and id is distinct from p_exclude) loop
    n := n + 1; c := b || n;
  end loop;
  return c;
end $$;
revoke all on function public.username_next(text, text, uuid) from public;
grant execute on function public.username_next(text, text, uuid) to authenticated;

-- split a full name for older accounts: first word / last word
create or replace function public.name_first(p text) returns text language sql immutable as $$ select split_part(btrim(coalesce(p, '')), ' ', 1) $$;
create or replace function public.name_last(p text) returns text language sql immutable as $$
  select case when position(' ' in btrim(coalesce(p, ''))) = 0 then '' else regexp_replace(btrim(p), '^.*\s', '') end $$;

-- new rows: username (and the 5H13 greeting) filled in when not given
create or replace function public.users_identity_defaults() returns trigger language plpgsql security definer set search_path = public as $$
declare f text := coalesce(nullif(btrim(new.first_name), ''), public.name_first(new.full_name));
        l text := coalesce(nullif(btrim(new.last_name), ''), public.name_last(new.full_name));
begin
  if new.username is null or btrim(new.username) = '' then
    new.username := public.username_next(f, l, new.id);
    if new.username = '5H13' then new.welcome_name := coalesce(new.welcome_name, '5H13'); end if;
  end if;
  new.username := btrim(new.username);
  new.nickname := nullif(btrim(coalesce(new.nickname, '')), '');
  return new;
end $$;
drop trigger if exists users_identity_defaults on public.users;
create trigger users_identity_defaults before insert or update of username, nickname on public.users
  for each row execute function public.users_identity_defaults();

-- existing accounts get their username now (oldest first, so the first person keeps the plain name)
do $$ declare r record; v text;
begin
  for r in select id, full_name, first_name, last_name, email from public.users where username is null order by created_at loop
    v := public.username_next(coalesce(nullif(r.first_name, ''), public.name_first(coalesce(nullif(r.full_name, ''), split_part(r.email, '@', 1)))),
                              coalesce(nullif(r.last_name, ''), public.name_last(coalesce(nullif(r.full_name, ''), split_part(r.email, '@', 1)))), r.id);
    update public.users set username = v, welcome_name = case when v = '5H13' then '5H13' else welcome_name end where id = r.id;
  end loop;
end $$;

alter table public.users alter column username set not null;
create unique index if not exists users_username_lower_key on public.users (lower(username));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_username_format') then
    alter table public.users add constraint users_username_format check (username ~ '^[A-Za-z0-9._-]{3,30}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_nickname_length') then
    alter table public.users add constraint users_nickname_length check (nickname is null or length(nickname) <= 40);
  end if;
end $$;

-- My Profile: change own username / nickname
create or replace function public.profile_update(p_username text, p_nickname text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_username, ''));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if v !~ '^[A-Za-z0-9._-]{3,30}$' then
    raise exception 'A username has 3 to 30 letters, numbers, dots, dashes or underscores (no spaces).';
  end if;
  if exists (select 1 from public.users where lower(username) = lower(v) and id <> auth.uid()) then
    raise exception 'The username "%" is already taken.', v;
  end if;
  if length(btrim(coalesce(p_nickname, ''))) > 40 then raise exception 'Keep the nickname to 40 characters.'; end if;
  update public.users set username = v, nickname = nullif(btrim(coalesce(p_nickname, '')), '') where id = auth.uid();
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'users', auth.uid(), 'profile_updated', jsonb_build_object('username', v, 'nickname', nullif(btrim(coalesce(p_nickname, '')), '')));
end $$;
revoke all on function public.profile_update(text, text) from public;
grant execute on function public.profile_update(text, text) to authenticated;

-- the form's username suggestion
create or replace function public.username_suggest(p_first text, p_last text) returns text
language sql stable security definer set search_path = public as $$ select public.username_next(p_first, p_last, null) $$;
revoke all on function public.username_suggest(text, text) from public;
grant execute on function public.username_suggest(text, text) to authenticated;

-- sign-in: the login email behind a username (service role only — the login page asks the server)
create or replace function public.login_email_for(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select email from public.users where lower(username) = lower(btrim(coalesce(p_username, ''))) and is_active limit 1;
$$;
revoke all on function public.login_email_for(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.login_email_for(text) from authenticated, anon; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.login_email_for(text) to service_role; end if;
end $$;
