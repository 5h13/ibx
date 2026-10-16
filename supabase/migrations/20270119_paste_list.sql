-- Build 119 — "Paste list": a client's item list (Messenger / Viber) pasted into the quotation form or the
-- agent app is matched line by line to the catalog.
--
-- catalog_paste_match(lines, business): for each pasted line (quantity already taken off by the app),
-- the 5 best catalog items, ranked by how many of the line's words they contain:
--   * a word with a digit (part number such as 9a96, 35uf) counts most (5), any other word 2,
--     +1 when it starts a word in the item (so "exp" fits "EXPANSION");
--   * searched in name, code, generic item, brand, description, category and specification;
--   * filler words (pcs, x, po, pls, boss, hi, quote, magkano, salamat …) are ignored; each word reports whether it matched.
--   A phrase picked before for the same store (catalog_paste_aliases) comes first, marked "remembered".
-- p_items (optional) limits the match to those catalog items, e.g. the items on a PO when receiving.
-- catalog_paste_remember(business, pairs): stores the user's picks (phrase → item) per store.

create table if not exists public.catalog_paste_aliases (
  business_id uuid not null references public.businesses(id),
  phrase text not null,
  item_id uuid not null references public.finance_procurement_items(id) on delete cascade,
  uses int not null default 1,
  created_by uuid references public.users(id),
  last_used_at timestamptz not null default now(),
  primary key (business_id, phrase)
);
alter table public.catalog_paste_aliases enable row level security;
revoke all on public.catalog_paste_aliases from authenticated, anon;   -- through the functions below only

create or replace function public.catalog_paste_phrase(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.catalog_paste_words(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct w), '{}') from regexp_split_to_table(public.catalog_paste_phrase(p), '\s+') w
   where length(w) >= 2 and w not in ('pcs','pc','pz','x','po','pls','pa','ng','ang','sa','na','boss','sir','maam','qty','unit','units','set','sets','and','the','for',
                   'hi','hello','good','morning','afternoon','evening','quote','quotation','price','presyo','magkano','salamat','thanks','thank','you',
                   'please','paquote','ok','okay','yung','nung','din','rin','lang','kayo','meron','may','ba',
                   'total','subtotal','amount','vat','description','delivery','receipt','received','by','date','no','invoice','sold','to',
                   'address','terms','page','prepared','checked','approved','signature')
$$;

drop function if exists public.catalog_paste_match(jsonb, uuid);
create or replace function public.catalog_paste_match(p_lines jsonb, p_business uuid default null, p_items uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := coalesce(p_business, public.pricing_business_id(), public.current_business_id());
  ln record; v_words text[]; v_phrase text; v_out jsonb := '[]'::jsonb; v_cands jsonb; v_alias uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 200 then raise exception 'Paste at most 200 lines at a time.'; end if;
  for ln in select ord, value as raw from jsonb_array_elements_text(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(value, ord) loop
    v_phrase := public.catalog_paste_phrase(ln.raw);
    v_words := public.catalog_paste_words(ln.raw);
    v_alias := (select a.item_id from public.catalog_paste_aliases a join public.finance_procurement_items i on i.id = a.item_id and i.active
                 where a.business_id = b and a.phrase = v_phrase and (p_items is null or a.item_id = any(p_items)));
    if cardinality(v_words) = 0 and v_alias is null then
      v_out := v_out || jsonb_build_object('line', ln.ord, 'text', ln.raw, 'words', '[]'::jsonb, 'candidates', '[]'::jsonb);
      continue;
    end if;
    select coalesce(jsonb_agg(c order by (c->>'remembered')::boolean desc, (c->>'score')::int desc, c->>'item_name'), '[]'::jsonb) into v_cands
      from (
        select jsonb_build_object('item_id', x.id, 'item_code', x.item_code, 'item_name', x.item_name, 'unit', x.unit, 'brand', x.brand,
                 'score', x.score, 'matched', x.matched, 'missed', x.missed, 'remembered', coalesce(x.id = v_alias, false)) as c
          from (
            select i.id, i.item_code, i.item_name, i.unit, i.brand,
                   sum(case when position(w in h.hay) > 0
                            then (case when w ~ '[0-9]' then 5 else 2 end) + (case when h.hay ~ ('(^|[^a-z0-9])' || w) then 1 else 0 end)
                            else 0 end)::int as score,
                   coalesce(jsonb_agg(w) filter (where position(w in h.hay) > 0), '[]'::jsonb) as matched,
                   coalesce(jsonb_agg(w) filter (where position(w in h.hay) = 0), '[]'::jsonb) as missed
              from public.finance_procurement_items i
              cross join lateral (select lower(concat_ws(' ', i.item_name, i.item_code, i.generic_item, i.brand, i.description, i.category, i.specification)) as hay) h
              cross join unnest(case when cardinality(v_words) > 0 then v_words else array[''] end) w
             where i.active and (p_items is null or i.id = any(p_items))
               and (i.id = v_alias or (cardinality(v_words) > 0 and exists (select 1 from unnest(v_words) w2 where position(w2 in h.hay) > 0)))
             group by i.id, i.item_code, i.item_name, i.unit, i.brand
             order by coalesce(i.id = v_alias, false) desc, 6 desc, i.item_name
             limit 5
          ) x
      ) s(c);
    v_out := v_out || jsonb_build_object('line', ln.ord, 'text', ln.raw, 'words', to_jsonb(v_words), 'candidates', v_cands);
  end loop;
  return v_out;
end $$;
grant execute on function public.catalog_paste_match(jsonb, uuid, uuid[]) to authenticated;

create or replace function public.catalog_paste_remember(p_business uuid, p_pairs jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare b uuid := coalesce(p_business, public.pricing_business_id(), public.current_business_id()); r record; n int := 0; v_phrase text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.businesses where id = b) then raise exception 'Store not found.'; end if;
  for r in select * from jsonb_to_recordset(coalesce(p_pairs, '[]'::jsonb)) as x(phrase text, item_id uuid) loop
    v_phrase := public.catalog_paste_phrase(r.phrase);
    continue when v_phrase = '' or r.item_id is null or not exists (select 1 from public.finance_procurement_items where id = r.item_id);
    insert into public.catalog_paste_aliases(business_id, phrase, item_id, created_by)
    values (b, v_phrase, r.item_id, auth.uid())
    on conflict (business_id, phrase) do update set item_id = excluded.item_id, uses = catalog_paste_aliases.uses + 1, last_used_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.catalog_paste_remember(uuid, jsonb) to authenticated;
