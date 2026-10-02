-- Proof helpers (owner runs this once per database): act as a user with RLS on,
-- assert, and expect a statement to fail with a given message.
create schema if not exists proof;
grant usage on schema proof to public;
create or replace function proof.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.uid', p::text, false); execute 'set role authenticated'; end $$;
create or replace function proof.as_owner() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.uid', '', false); end $$;
create or replace function proof.ok(c boolean, label text) returns text language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', label; end if; raise notice 'PASS %', label; return 'PASS ' || label; end $$;
create or replace function proof.fails(stmt text, expect text, label text) returns text language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'PASS % (refused: %)', label, sqlerrm; return 'PASS ' || label; end if;
    raise exception 'FAIL: % — wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL: % — statement succeeded', label;
end $$;
create table if not exists proof.v(k text primary key, v text);
grant all on proof.v to public;
create or replace function proof.set(k text, v text) returns text language sql as $$ insert into proof.v values (k, v) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function proof.get(k text) returns text language sql stable as $$ select v from proof.v where k = $1 $$;
grant execute on all functions in schema proof to public;
-- read-only probes that bypass grants (owner rights), for checks made while acting as a user
create or replace function proof.price(p_item uuid, p_business uuid) returns numeric language sql stable security definer set search_path = public as
$$ select list_price from public.storefront_item_price(p_item, p_business) $$;
create or replace function proof.on_hand(p_business uuid, p_item uuid, p_location uuid) returns numeric language sql stable security definer set search_path = public as
$$ select public.q77_on_hand(p_business, p_item, p_location) $$;
grant execute on all functions in schema proof to public;
