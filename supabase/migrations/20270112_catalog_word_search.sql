-- Build 107 — catalogue search by words, in any order, partial words allowed.
--   "blower inno" now finds "BLOWER MOTOR, TOYOTA INNOVA": every word typed must appear somewhere in the item's
--   name, code, generic item, brand, description or category (any case; commas and slashes ignored).
--   Used by the agent app catalogue, the Storefront / procurement product search and the Price Review page.

create or replace function public.catalog_words_match(p_hay text, p_q text) returns boolean
language sql immutable set search_path = public as $$
  select not exists (
    select 1 from regexp_split_to_table(lower(btrim(regexp_replace(coalesce(p_q, ''), '[,;/|]+', ' ', 'g'))), '\s+') w
     where w <> '' and position(w in lower(coalesce(p_hay, ''))) = 0);
$$;

do $$
declare f regprocedure; d text; n text;
begin
  foreach f in array array['public.catalog_product_search_for(uuid,text,text,text,text,boolean,integer,integer)'::regprocedure,
                           'public.catalog_product_search(text,text,text,text,boolean,integer,integer)'::regprocedure] loop
    d := pg_get_functiondef(f);
    if position('catalog_words_match' in d) > 0 then continue; end if;   -- already changed
    n := regexp_replace(d, $re$\(q is null or i\.item_name ilike .*?i\.category ilike '%' \|\| q \|\| '%'\)$re$,
                        $rp$(q is null or public.catalog_words_match(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.description, i.category), q))$rp$);
    if n = d then raise exception 'catalog search: pattern not found in %', f; end if;
    execute n;
  end loop;
  d := pg_get_functiondef('public.price_review_items(text,text,text,uuid,integer,integer)'::regprocedure);
  if position('catalog_words_match' in d) = 0 then
    n := regexp_replace(d, $re$\(q is null or i\.item_name ilike .*?coalesce\(i\.brand, ''\) ilike '%' \|\| q \|\| '%'\)$re$,
                        $rp$(q is null or public.catalog_words_match(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand), q))$rp$);
    if n = d then raise exception 'price review search: pattern not found'; end if;
    execute n;
  end if;
end $$;
